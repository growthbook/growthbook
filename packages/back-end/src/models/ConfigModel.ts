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
  getAncestorSchemaKeys,
  stripAncestorOwnedFields,
  findSiblingSchemaConflicts,
  fieldsToJsonSchema,
  storedInvariantsToApi,
} from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import { isEqual, omit } from "lodash";
import { BadRequestError } from "back-end/src/util/errors";
import {
  resolvableValueChanged,
  assertConfigDeletable,
  assertConfigArchivable,
} from "back-end/src/services/constants";
import { configToResolvable } from "back-end/src/services/resolvableValues";
import {
  AsyncSnapshot,
  createAsyncSnapshot,
} from "back-end/src/util/asyncSnapshot";
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
  // Request-scoped snapshot of every config (the reconciliation feed). One
  // schema/lineage write reads the whole collection many times — normalize +
  // value validation + descendant dry-run + the cycle/composition hooks — all
  // against unchanged data. Memoize that fetch and invalidate on any write so
  // the post-write descendant reconcile still sees fresh data.
  private reconcileSnapshot: AsyncSnapshot<ConfigInterface[]> =
    createAsyncSnapshot(() =>
      this._find({}, { bypassReadPermissionChecks: true }),
    );

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
  private async assertNoCycle(doc: ConfigInterface): Promise<void> {
    const effectiveValue = withConfigExtends(doc.value, getConfigBaseKeys(doc));
    const cyclic = getCyclicConstantRefs(
      doc.key,
      effectiveValue,
      undefined,
      (await this.getAllForReconcile()).map(configToResolvable),
      "config",
    );
    if (cyclic.length) {
      throw new BadRequestError(
        `This config references ${cyclic.join(", ")}, which would create a reference cycle.`,
      );
    }
  }

  protected async beforeCreate(doc: ConfigInterface) {
    await this.assertNoCycle(doc);
    await this.assertValidComposition(doc);
  }

  protected async beforeUpdate(
    existing: ConfigInterface,
    updates: UpdateProps<ConfigInterface>,
    newDoc: ConfigInterface,
  ) {
    // Model-level backstop (handlers also check, for earlier/friendlier errors):
    // block archiving a config that's still referenced or has live descendants,
    // so no write path — including a future cascade — can orphan lineage.
    if (updates.archived === true && !existing.archived) {
      await assertConfigArchivable(this.context, existing);
    }
    if (
      updates.parent !== undefined ||
      updates.extends !== undefined ||
      updates.value !== undefined
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
      await this.assertValidComposition(newDoc);
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
  private async assertValidComposition(doc: ConfigInterface): Promise<void> {
    const baseKeys = getConfigBaseKeys(doc);
    if (!baseKeys.length) return;

    // Structural checks against the raw fields (getConfigBaseKeys already dedups
    // for resolution, so inspect the raw `extends` for duplicates/overlap).
    const extendsList = doc.extends ?? [];
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

    const all = await this.getAllForReconcile();
    const byKey = new Map(all.map((c) => [c.key, c]));
    // Use the proposed doc (its own bases), not the stored copy.
    byKey.set(doc.key, doc);

    const missing = baseKeys.filter((k) => !byKey.has(k));
    if (missing.length) {
      throw new BadRequestError(
        `Unknown config(s) in lineage: ${missing.join(", ")}.`,
      );
    }

    // Don't let a config inherit from an archived base — neither the `parent`
    // spine nor an `extends` mixin. An archived base is scrubbed from the SDK
    // payload (the child would resolve as if it were absent) while still
    // governing lineage/extensibility here, so block it on every write path
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
    this.reconcileSnapshot.invalidate();
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
    this.reconcileSnapshot.invalidate();
    if (
      updates.parent !== undefined ||
      updates.extends !== undefined ||
      updates.value !== undefined ||
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

    // Skip the webhook event when only `dateUpdated` changed.
    const previous = this.toApiInterface(existing);
    const current = this.toApiInterface(newDoc);
    if (
      !isEqual(omit(previous, ["dateUpdated"]), omit(current, ["dateUpdated"]))
    ) {
      await logConfigUpdatedEvent(this.context, previous, current);
    }
  }

  protected async afterDelete(doc: ConfigInterface) {
    this.reconcileSnapshot.invalidate();
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
  public getAllForReconcile(): Promise<ConfigInterface[]> {
    return this.reconcileSnapshot.get();
  }

  // Strip from a config's appended schema any field key already owned by a
  // published ancestor (closest base wins). Returns the reconciled schema, or
  // the input unchanged when there are no collisions. Call before every schema
  // write so a child can never re-declare an inherited field.
  public async normalizeSchemaAgainstAncestors(
    config: {
      key?: string;
      parent?: string;
      extends?: string[];
      value?: string;
    },
    schema: SimpleSchema | undefined,
  ): Promise<SimpleSchema | undefined> {
    if (!schema?.fields?.length) return schema;
    if (!getConfigBaseKeys(config).length) return schema;
    const all = await this.getAllForReconcile();
    const byKey = new Map(all.map((c) => [c.key, c]));
    const ancestorKeys = getAncestorSchemaKeys(config, byKey);
    const kept = stripAncestorOwnedFields(schema, ancestorKeys);
    return kept ? { ...schema, fields: kept } : schema;
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
      // Coalesce a legacy `null` (from an earlier clear bug) to undefined so the
      // optional-array API field validates.
      extends: config.extends ?? undefined,
      // Stored as a JSON string; the external API exposes it as native JSON.
      // Configs are environment-agnostic, so `environmentValues` is never exposed.
      value: config.value ? JSON.parse(config.value) : undefined,
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
