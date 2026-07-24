import { ConfigInterface, ConfigWithoutValue } from "shared/types/config";
import { SimpleSchema } from "shared/types/feature";
import {
  ApiConfig,
  configValidator,
  getCyclicConstantRefs,
} from "shared/validators";
import {
  getConfigBaseKeys,
  withConfigExtends,
  findBasePrecedenceInversions,
  getAncestorSchemaFieldOwners,
  classifyAncestorOwnedFields,
  AncestorFieldCollision,
  findSiblingSchemaConflicts,
  fieldsToJsonSchema,
  storedInvariantsToApi,
  isConfigLocked,
} from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import { isEqual, omit } from "lodash";
import { BadRequestError } from "back-end/src/util/errors";
import { overlayDocsById } from "back-end/src/util/scanOverlay.util";
import {
  resolvableValueChanged,
  assertConfigDeletable,
  pruneScopedOverridesReferencing,
  syncScopedConfigMarkers,
} from "back-end/src/services/constants";
import { assertConfigArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { configToResolvable } from "back-end/src/services/resolvableValues";
import { emitOrDeferBulkPublishEvent } from "back-end/src/events/bulkPublishCorrelation";
import {
  logConfigCreatedEvent,
  logConfigUpdatedEvent,
  logConfigDeletedEvent,
} from "back-end/src/services/configEvents";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: configValidator,
  collectionName: "configs",
  idPrefix: "cfg_",
  auditLog: {
    entity: "config",
    createEvent: "config.created",
    updateEvent: "config.updated",
    deleteEvent: "config.deleted",
  },
  globallyUniquePrimaryKeys: true,
  // `key` is the `@const:<key>` reference handle; unique per org.
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        key: 1,
      },
      unique: true,
    },
  ],
});

export class ConfigModel extends BaseClass {
  // Request-scoped memoized snapshot of every config (the reconciliation feed).
  // One schema/lineage write reads the whole collection many times — normalize +
  // value validation + descendant dry-run + the cycle/composition hooks — all
  // against unchanged data. `getAllForReconcile` loads it once; every write
  // invalidates it so the post-write descendant reconcile still sees fresh data.
  private reconcileSnapshot: Promise<ConfigInterface[]> | null = null;

  protected canRead(doc: ConfigInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: ConfigInterface): boolean {
    return this.context.permissions.canCreateConfig(doc);
  }

  protected canUpdate(
    existing: ConfigInterface,
    _updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ): boolean {
    return this.context.permissions.canUpdateConfig(existing, newDoc);
  }

  protected canDelete(doc: ConfigInterface): boolean {
    return this.context.permissions.canDeleteConfig(doc);
  }

  // Reject cyclic lineage. Every base (`parent` + `extends`) is synthesized into
  // `$extends` (`@config:` refs) so a base→…→self cycle through any composition
  // edge is caught at write time. Config cycles are confined to the config
  // namespace (a config's lineage references only configs; its `@const:` value
  // refs point at constants, which can never reference back), so scope to it.
  //
  // Use the UNFILTERED config list (lineage is an org-global graph): a permission
  // -filtered read would hide a config in a project the writer can't see and let
  // a cross-project cycle through it slip past.
  // The lineage/`@config:` keys a proposed config would form a reference cycle
  // through, resolved against this context's (possibly overlaid) config graph —
  // empty when acyclic. Public so the bulk publisher can raise it as a plan
  // gate against the combined end-state; `assertNoCycle` throws on it.
  public async findReferenceCycle(doc: ConfigInterface): Promise<string[]> {
    const effectiveValue = withConfigExtends(doc.value, getConfigBaseKeys(doc));
    return getCyclicConstantRefs(
      doc.key,
      effectiveValue,
      undefined,
      (await this.getAllForReconcile()).map(configToResolvable),
      "config",
    );
  }

  private async assertNoCycle(doc: ConfigInterface): Promise<void> {
    const cyclic = await this.findReferenceCycle(doc);
    if (cyclic.length) {
      throw new BadRequestError(
        `This config references ${cyclic.join(", ")}, which would create a reference cycle.`,
      );
    }
  }

  protected async beforeCreate(doc: ConfigInterface) {
    await this.assertNoCycle(doc);
    await this.assertValidComposition(doc, {
      lineageChanged: true,
      priorBaseKeys: [],
    });
  }

  protected async beforeUpdate(
    existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ) {
    // Model-level backstop (handlers also check, for earlier/friendlier errors):
    // archiving a config with live dependents (references or lineage children) is
    // a uniform SOFT warning, bypassable by ignoreWarnings — background jobs (the
    // deferred fire) always ignore warnings, so an armed archive publish already
    // re-checked its fingerprint at assertPublishable passes here. A direct write
    // without ignoreWarnings still surfaces the warning on any write path.
    // A bulk-publish commit already evaluated this guard as a plan gate against
    // the release's combined end-state; re-running it here would judge the
    // mid-commit mix (a sibling that removes the last dependent may not have
    // applied yet) and spuriously fail the release.
    if (
      updates.archived === true &&
      !existing.archived &&
      !this.context.bulkPublishApplying
    ) {
      await assertConfigArchiveDependentsGuard(
        this.context,
        {
          id: existing.id,
          key: existing.key,
          project: existing.project,
          // Fingerprint the POST-update value/lineage (newDoc), matching the
          // handler-layer guard — a revision that archives AND reparents/empties
          // in one write would otherwise collect dependents against the stale
          // live state and spuriously over-block.
          value: newDoc.value,
          parent: newDoc.parent,
          extends: newDoc.extends,
        },
        { armed: false },
      );
    }
    // Lineage/value reference-cycle detection: skipped while a bulk commit is
    // applying (the cycle gate validated the acyclic END-state at plan; the
    // sequential apply can transiently form a cycle the end-state doesn't have).
    if (
      (updates.parent !== undefined ||
        updates.extends !== undefined ||
        updates.value !== undefined) &&
      !this.context.bulkPublishApplying
    ) {
      await this.assertNoCycle(newDoc);
    }
    // A lineage change (parent/extends) or a schema change can make two sibling
    // bases own the same field key — a structural composition error.
    if (
      updates.parent !== undefined ||
      updates.extends !== undefined ||
      updates.schema !== undefined
    ) {
      await this.assertValidComposition(newDoc, {
        lineageChanged:
          updates.parent !== undefined || updates.extends !== undefined,
        priorBaseKeys: getConfigBaseKeys(existing),
      });
    }
  }

  // Validate a config's composition (its `parent` spine + `extends` mixins):
  //  - structural: no self-reference, no duplicate bases, `extends` disjoint
  //    from `parent`, and every base key resolves to a known config;
  //  - schema: no two sibling bases (branches with no ancestor/descendant
  //    relationship) declare the same field key — there's no "base wins" winner
  //    among siblings, so it's a hard error.
  // Structural (not gated by skipSchemaValidation; it's lineage integrity, not
  // value-vs-schema conformance).
  // `lineageChanged` = this write actually changes `parent`/`extends`. The
  // lineage-integrity checks (structural, missing/precedence, archived-base)
  // depend only on lineage, so they're skipped on a schema-only write — notably
  // the "base wins" descendant cascade, which rewrites a descendant's schema
  // without touching its lineage. Re-running them there would spuriously reject a
  // config whose base was archived out-of-band and abort an unrelated ancestor
  // publish mid-cascade ("base became archived" is already handled by
  // assertConfigArchivable on the base's own archive). The sibling-conflict
  // schema check below always runs (a schema change can newly create one).
  private async assertValidComposition(
    doc: ConfigInterface,
    {
      lineageChanged,
      priorBaseKeys,
    }: { lineageChanged: boolean; priorBaseKeys: string[] },
  ): Promise<void> {
    const baseKeys = getConfigBaseKeys(doc);
    if (!baseKeys.length) return;

    const extendsList = doc.extends ?? [];
    if (lineageChanged) {
      // Structural checks against the raw fields (getConfigBaseKeys already dedups
      // for resolution, so inspect the raw `extends` for duplicates/overlap).
      if (extendsList.includes(doc.key) || doc.parent === doc.key) {
        throw new BadRequestError("A config cannot extend itself.");
      }
      if (doc.parent && extendsList.includes(doc.parent)) {
        throw new BadRequestError(
          `"${doc.parent}" is already the parent; remove it from "extends".`,
        );
      }
      const dupes = extendsList.filter((k, i) => extendsList.indexOf(k) !== i);
      if (dupes.length) {
        throw new BadRequestError(
          `Duplicate "extends" entries: ${[...new Set(dupes)].join(", ")}.`,
        );
      }
    }

    const all = await this.getAllForReconcile();
    const byKey = new Map(all.map((c) => [c.key, c]));
    // Use the proposed doc (its own bases), not the stored copy.
    byKey.set(doc.key, doc);

    if (lineageChanged) {
      const missing = baseKeys.filter((k) => !byKey.has(k));
      if (missing.length) {
        throw new BadRequestError(
          `Unknown config(s) in lineage: ${missing.join(", ")}.`,
        );
      }

      // A base you can't read must not be composable: resolving this config
      // would expose that base's field values (and its existence). Gate only
      // NEWLY-referenced bases so an existing lineage set up with access stays
      // editable; a global (project-less) base is readable by everyone.
      const prior = new Set(priorBaseKeys);
      const unreadable = baseKeys.filter(
        (k) =>
          !prior.has(k) &&
          !this.context.permissions.canReadSingleProjectResource(
            byKey.get(k)?.project || "",
          ),
      );
      if (unreadable.length) {
        throw new BadRequestError(
          `Cannot compose config(s) you don't have access to: ${unreadable.join(
            ", ",
          )}.`,
        );
      }

      // A base listed after one of its own descendants would resolve with
      // opposite precedence in the lineage chain vs. the SDK payload.
      const inversions = findBasePrecedenceInversions(doc, byKey);
      if (inversions.length) {
        const detail = inversions
          .map(
            (c) =>
              `"${c.ancestor}" is an ancestor of "${c.earlier}" but is listed after it`,
          )
          .join("; ");
        throw new BadRequestError(
          `Conflicting base order: ${detail}. A base's ancestor cannot appear ` +
            `later in the lineage — remove the redundant entry (it is already ` +
            `inherited) or reorder "extends".`,
        );
      }

      // Don't let a config inherit from an archived base — neither the `parent`
      // spine nor an `extends` mixin. An archived base is scrubbed from the SDK
      // payload (the child would resolve as if it were absent) while still
      // governing lineage/extensibility here, so block it on every lineage write
      // (the UI also hides archived configs as candidates).
      if (doc.parent && byKey.get(doc.parent)?.archived) {
        throw new BadRequestError(
          `Cannot inherit from archived parent "${doc.parent}". ` +
            `Unarchive it or choose a different parent.`,
        );
      }
      const archivedMixins = extendsList.filter((k) => byKey.get(k)?.archived);
      if (archivedMixins.length) {
        throw new BadRequestError(
          `Cannot extend archived config(s): ${archivedMixins.join(", ")}. ` +
            `Unarchive them or remove them from "extends".`,
        );
      }
    }

    const conflicts = findSiblingSchemaConflicts(doc, byKey);
    if (conflicts.length) {
      const detail = conflicts
        .map((c) => `"${c.key}" (declared by ${c.owners.join(" and ")})`)
        .join(", ");
      throw new BadRequestError(
        `This config's bases declare the same field on separate branches, so ` +
          `there is no single owner: ${detail}. Each effective field must be ` +
          `owned by exactly one config — remove the duplicate declaration from ` +
          `one of the bases or drop one of the conflicting bases.`,
      );
    }
  }

  // Model-level backstop (handlers also check): block deleting a config that's
  // still referenced or has live descendants inheriting from it.
  protected async beforeDelete(doc: ConfigInterface) {
    await assertConfigDeletable(this.context, doc);
  }

  protected async afterCreate(doc: ConfigInterface) {
    this.invalidateReconcileSnapshot();
    // A new config can satisfy a `@config:` ref that a feature already embeds
    // (e.g. an imported/dangling reference), so refresh the SDK payload.
    resolvableValueChanged(this.context, "updated", "config", doc.key).catch(
      (e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on config create",
        );
      },
    );
    await logConfigCreatedEvent(this.context, this.toApiInterface(doc));
  }

  // Refresh SDK payloads when a change alters the resolved value.
  protected async afterUpdate(
    existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ) {
    this.invalidateReconcileSnapshot();
    if (
      updates.parent !== undefined ||
      updates.extends !== undefined ||
      updates.value !== undefined ||
      updates.scopedOverrides !== undefined ||
      updates.project !== undefined ||
      updates.archived !== undefined
    ) {
      resolvableValueChanged(
        this.context,
        "updated",
        "config",
        newDoc.key,
      ).catch((e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on config update",
        );
      });
    }

    // Skip the webhook event when only `dateUpdated` changed. During a
    // bulk-publish commit the emission defers to the post-commit flush.
    const previous = this.toApiInterface(existing);
    const current = this.toApiInterface(newDoc);
    if (
      !isEqual(omit(previous, ["dateUpdated"]), omit(current, ["dateUpdated"]))
    ) {
      await emitOrDeferBulkPublishEvent(this.context, () =>
        logConfigUpdatedEvent(this.context, previous, current),
      );
    }
  }

  protected async afterDelete(doc: ConfigInterface) {
    this.invalidateReconcileSnapshot();
    // Drop any parent's scopedOverrides entry that pointed at this config, so a
    // deleted flavor never dangles on its parent's selection list. Runs after
    // the snapshot invalidate so it reads post-delete state.
    await pruneScopedOverridesReferencing(this.context, doc.key);
    // And the inverse: clear the scopedConfig marker on flavors this config
    // selected, so a deleted base doesn't leave them marked (and approval-
    // scoped) for a parent that no longer exists.
    if (doc.scopedOverrides?.length) {
      await syncScopedConfigMarkers(
        this.context,
        doc.key,
        doc.scopedOverrides,
        [],
      );
    }
    resolvableValueChanged(this.context, "deleted", "config", doc.key).catch(
      (e) => {
        this.context.logger.error(
          e,
          "Error refreshing SDK Payload on config delete",
        );
      },
    );
    await logConfigDeletedEvent(this.context, this.toApiInterface(doc));
  }

  public getByKey(key: string) {
    return this._findOne({ key });
  }

  // Every config in the org, ignoring per-config read permissions. Used by the
  // schema-reconciliation pass, which must see the whole lineage (ancestors and
  // descendants may live in projects the acting user can't read) to enforce
  // "base wins" on field collisions.
  // Loads once and returns the same in-flight/resolved promise to every caller
  // until a write invalidates it. A rejected load isn't cached, so a later call
  // retries.
  public getAllForReconcile(): Promise<ConfigInterface[]> {
    if (this.reconcileSnapshot === null) {
      const load = this._find({}, { bypassReadPermissionChecks: true })
        .then((docs) => this.applyScanOverlay(docs))
        .catch((err) => {
          // Clear only our own failed load — a write may have invalidated it
          // and a newer healthy load may already be memoized.
          if (this.reconcileSnapshot === load) this.reconcileSnapshot = null;
          throw err;
        });
      this.reconcileSnapshot = load;
    }
    return this.reconcileSnapshot;
  }

  // Scan-overlay: substitute hypothetical entity states into every snapshot
  // read from this model instance. Used by the bulk publisher's overlay scan
  // context so validation/guards evaluate a proposed multi-entity end-state
  // instead of live DB state. Only ever set on a dedicated plan-scoped scan
  // context — never on a request context that performs writes.
  private scanOverlay: Map<string, ConfigInterface> | null = null;

  public setScanOverlay(docs: ConfigInterface[]): void {
    this.scanOverlay = new Map(docs.map((d) => [d.id, d]));
    this.invalidateReconcileSnapshot();
  }

  private applyScanOverlay(docs: ConfigInterface[]): ConfigInterface[] {
    return overlayDocsById(docs, this.scanOverlay);
  }

  private invalidateReconcileSnapshot(): void {
    this.reconcileSnapshot = null;
  }

  // Derive the permission-filtered read from the same memoized snapshot instead
  // of a second full-collection query (getResolvableValues and the reconcile
  // paths both run per request). Equivalent to the base _find pipeline: this
  // model has no sanitize override and no foreign refs, so filtering the
  // already-sanitized snapshot returns exactly what a direct query would.
  public async getAll(): Promise<ConfigInterface[]> {
    return this.filterByReadPermissions(await this.getAllForReconcile());
  }

  // Strip from a config's appended schema any field key already owned by a
  // published ancestor (closest base wins), reporting each collision split by
  // whether the re-declaration matches the owner's contract. The model only
  // computes; policy lives at the call sites — contract-differing collisions
  // reject on user-authored write paths (mirroring the $extends fix), identical
  // ones surface as warnings. Call before every schema write so a child can
  // never persist a re-declared inherited field.
  public async normalizeSchemaAgainstAncestors(
    config: {
      key?: string;
      parent?: string;
      extends?: string[];
      value?: string;
    },
    schema: SimpleSchema | undefined,
  ): Promise<{
    schema: SimpleSchema | undefined;
    identical: AncestorFieldCollision[];
    conflicting: AncestorFieldCollision[];
  }> {
    if (!schema?.fields?.length || !getConfigBaseKeys(config).length) {
      return { schema, identical: [], conflicting: [] };
    }
    const all = await this.getAllForReconcile();
    const byKey = new Map(all.map((c) => [c.key, c]));
    const owners = getAncestorSchemaFieldOwners(config, byKey);
    const { kept, identical, conflicting } = classifyAncestorOwnedFields(
      schema,
      owners,
    );
    return {
      schema: kept ? { ...schema, fields: kept } : schema,
      identical,
      conflicting,
    };
  }

  // Project a config into its external REST shape. `ownerEmail` is left blank
  // here and filled in by `resolveOwnerEmail(s)` in the handler (a batched user
  // lookup), mirroring the constant serializer. `$extends` never appears in the
  // stored `value`, so it's safe to surface verbatim.
  public toApiInterface(config: ConfigInterface): ApiConfig {
    return {
      id: config.id,
      key: config.key,
      name: config.name,
      owner: config.owner,
      ownerEmail: "",
      parent: config.parent,
      extends: config.extends,
      // Stored as a JSON string; the external API exposes it as native JSON.
      value: config.value ? JSON.parse(config.value) : undefined,
      // Ordered env/project variant selection (flavor configs). Omitted when the
      // config has none.
      scopedOverrides: config.scopedOverrides?.length
        ? config.scopedOverrides
        : undefined,
      // Read-only flavor marker: makes an env/project-scoped override obvious in
      // the API without reverse-scanning parents. Stamped from the parent's
      // scopedOverrides; omitted for a normal (non-flavor) config.
      scopedConfig: config.scopedConfig ?? undefined,
      description: config.description,
      project: config.project,
      archived: config.archived,
      // Expose the schema as the canonical JSON Schema envelope; SimpleSchema is
      // internal-only. `value` is the JSON Schema document (parsed from the
      // converter's string form).
      schema: config.schema
        ? {
            type: "json-schema",
            value: JSON.parse(
              fieldsToJsonSchema(config.schema.fields, {
                type: config.schema.type,
                additionalProperties: config.schema.additionalProperties,
              }),
            ),
          }
        : undefined,
      extensible: config.extensible,
      // Cross-field validation rules, with `rule` as the canonical JSONLogic
      // object. Omitted when the config has none.
      invariants: storedInvariantsToApi(config.schema?.invariants),
      // Lock / reproducibility pin. `lockedRevision` is the immutable pinned
      // revision; fetch it via GET /configs-revisions/:key/:version for builds.
      locked: isConfigLocked(config),
      lockedRevision: config.lock
        ? { id: config.lock.revisionId, version: config.lock.version }
        : undefined,
      lockedBy: config.lock?.lockedBy,
      dateLocked: config.lock?.dateLocked?.toISOString(),
      experimentGuard: config.experimentGuard,
      dateCreated: config.dateCreated.toISOString(),
      dateUpdated: config.dateUpdated.toISOString(),
    };
  }

  // Value-omitted projection for the definitions context (values can be large).
  public async getAllWithoutValues(): Promise<ConfigWithoutValue[]> {
    const configs = await this._find({}, { projection: { value: 0 } });
    return configs as ConfigWithoutValue[];
  }

  // On project delete, unset it on scoped configs (becomes global). Bypasses the
  // per-config update permission (system cascade) but still fires afterUpdate.
  public async removeProjectIdFromAll(projectId: string) {
    const affected = await this._find({ project: projectId });
    for (const config of affected) {
      await this.dangerousUpdateBypassPermission(config, { project: "" });
    }
  }
}
