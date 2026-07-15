import { isEqual, omit } from "lodash";
import { Revision } from "shared/enterprise";
import {
  updateConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import {
  stripConfigExtends,
  apiInvariantsToStored,
  formatAncestorFieldConflictMessage,
  ancestorCollisionWarnings,
  findUndeclaredInvariantRuleFields,
  undeclaredRuleFieldWarnings,
} from "shared/util";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canUseRestApiBypassSetting } from "back-end/src/api/features/reviewBypass";
import {
  buildPatchOps,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import {
  reconcileConfigDescendants,
  assertConfigDescendantsReconcilable,
  assertConfigSchemaChangeSafeForDescendants,
} from "back-end/src/services/configReconcile";
import {
  assertConfigValueValidForPublish,
  getEffectiveConfigSchema,
} from "back-end/src/services/configValidation";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import { assertConfigPublishGuards } from "back-end/src/services/publishGuards";
import { assertScopedOverridesExperimentGuard } from "back-end/src/services/experimentGuard";
import {
  assertScopedOverridesValid,
  assertScopedOverridesChangeAllowed,
  syncScopedConfigMarkers,
} from "back-end/src/services/constants";
import { runValidateConfigHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { resolveConfigSchemaSource } from "./validations";

export const updateConfig = createApiRequestHandler(updateConfigValidator)(
  async (req) => {
    const { key } = req.params;
    const { name, description, project, owner, schema, extensible } = req.body;
    const extendsKeys = req.body.extends;
    const bypassApproval = req.body.bypassApproval === true;
    // Value arrives as a native JSON object; stored/validated as a JSON string.
    const value =
      req.body.value !== undefined ? JSON.stringify(req.body.value) : undefined;

    // `warnings` surface any lossy degradation from the schema conversion.
    const {
      schema: resolvedSchema,
      warnings,
      projection,
    } = resolveConfigSchemaSource({
      source: schema,
    });

    const config = await req.context.models.configs.getByKey(key);
    if (!config) {
      throw new NotFoundError(`Unable to locate the config: ${key}`);
    }

    if (
      !req.context.permissions.canUpdateConfig(config, {
        project: project ?? config.project,
      })
    ) {
      req.context.permissions.throwPermissionError();
    }

    // Experiment-guard toggle: a config-level setting (not a revision field),
    // asymmetric like lock/unlock (OFF needs bypassApprovalChecks). Check the
    // permission now but DEFER the write (commitGuardToggle) until after the
    // value publish succeeds, so a failed publish can't leave it half-applied.
    const guardToggle =
      req.body.experimentGuard !== undefined &&
      req.body.experimentGuard !== !!config.experimentGuard
        ? req.body.experimentGuard
        : undefined;
    if (
      guardToggle === false &&
      !req.context.permissions.canBypassApprovalChecks({
        project: config.project || "",
      })
    ) {
      req.context.permissions.throwPermissionError();
    }
    const commitGuardToggle = async (): Promise<Partial<ConfigInterface>> => {
      if (guardToggle === undefined) return {};
      await req.context.models.configs.dangerousUpdateBypassPermission(config, {
        experimentGuard: guardToggle,
      });
      return { experimentGuard: guardToggle };
    };

    // Strip any stray `$extends` from the value; lineage lives on `parent`/`extends`.
    const normalizedValue =
      value !== undefined ? stripConfigExtends(value) : undefined;
    const incomingParent = req.body.parent;

    const fieldsToUpdate: Partial<
      Omit<
        ConfigInterface,
        "id" | "organization" | "dateCreated" | "dateUpdated"
      >
    > = {};

    if (name !== undefined && name !== config.name) {
      fieldsToUpdate.name = name;
    }
    if (owner !== undefined && owner !== config.owner) {
      fieldsToUpdate.owner = owner;
    }
    if (description !== undefined && description !== config.description) {
      fieldsToUpdate.description = description;
    }
    if (project !== undefined && project !== config.project) {
      if (project) {
        await req.context.models.projects.ensureProjectsExist([project]);
      }
      fieldsToUpdate.project = project;
    }
    const parentChanged =
      incomingParent !== undefined &&
      (incomingParent || "") !== (config.parent || "");
    if (parentChanged) {
      // Persist a clear as "" not undefined: undefined is dropped by the patch
      // layer and would silently no-op the detach.
      fieldsToUpdate.parent = incomingParent || "";
    }
    const extendsChanged =
      extendsKeys !== undefined && !isEqual(extendsKeys, config.extends ?? []);
    if (extendsChanged) {
      // Store as-is (incl. `[]` to clear); `undefined` would be dropped and no-op the clear.
      fieldsToUpdate.extends = extendsKeys;
    }
    if (value !== undefined) {
      // A `@config:` ref in the value is rejected; lineage lives on `parent`/`extends`.
      validateResolvableValue({
        type: "json",
        value,
        label: "value",
        refSource: "config",
      });
      if (normalizedValue !== config.value) {
        fieldsToUpdate.value = normalizedValue;
      }
    }
    // The env/project variant selection is structural — written outside the
    // revision flow (matches the internal PUT /configs/:id/scoped-overrides).
    // Validate now, but DEFER the write until the rest of the request has
    // passed its gates, so a later rejection doesn't leave a half-applied mix.
    let commitScopedOverrides: (() => Promise<void>) | null = null;
    if (
      req.body.scopedOverrides !== undefined &&
      !isEqual(req.body.scopedOverrides, config.scopedOverrides ?? [])
    ) {
      const nextOverrides = req.body.scopedOverrides;
      assertConfigNotLocked(config);
      await assertScopedOverridesValid(
        req.context,
        {
          key: config.key,
          project: config.project,
          scopedOverrides: nextOverrides,
        },
        config.scopedOverrides ?? [],
      );
      await assertScopedOverridesChangeAllowed(
        req.context,
        config,
        config.scopedOverrides ?? [],
        nextOverrides,
      );
      await assertScopedOverridesExperimentGuard(
        req.context,
        config,
        config.scopedOverrides ?? [],
        nextOverrides,
      );
      commitScopedOverrides = async () => {
        await req.context.models.configs.dangerousUpdateBypassPermission(
          config,
          { scopedOverrides: nextOverrides },
        );
        await syncScopedConfigMarkers(
          req.context,
          config.key,
          config.scopedOverrides ?? [],
          nextOverrides,
        );
      };
    }
    // Fold validation rules into the schema to persist:
    //  - `invariants` sent → they replace (an empty array clears them);
    //  - schema sent without `invariants` → keep the config's existing rules
    //    (the JSON Schema source can't carry them, so don't drop them);
    //  - neither → no schema change from this.
    const storedInvariants = (() => {
      try {
        return req.body.invariants
          ? apiInvariantsToStored(req.body.invariants)
          : undefined;
      } catch (e) {
        throw new BadRequestError(e instanceof Error ? e.message : String(e));
      }
    })();
    let nextSchema = resolvedSchema;
    if (storedInvariants !== undefined) {
      const base = resolvedSchema ??
        config.schema ?? { type: "object" as const, fields: [] };
      if (storedInvariants.length) {
        nextSchema = { ...base, invariants: storedInvariants };
      } else {
        nextSchema = omit(base, "invariants");
      }
    } else if (
      resolvedSchema !== undefined &&
      config.schema?.invariants?.length
    ) {
      nextSchema = { ...resolvedSchema, invariants: config.schema.invariants };
    }
    if (nextSchema !== undefined && !isEqual(nextSchema, config.schema)) {
      fieldsToUpdate.schema = nextSchema;
    }
    if (extensible !== undefined && extensible !== config.extensible) {
      fieldsToUpdate.extensible = extensible;
    }
    if (req.body.source && projection) {
      fieldsToUpdate.renderProjections = {
        ...config.renderProjections,
        [req.body.source]: projection,
      };
    }

    // "Base wins": a parent/mixin change shifts which fields the bases own, so
    // re-normalize the config's own schema even when the caller didn't send one.
    const effectiveParent = parentChanged ? incomingParent : config.parent;
    const effectiveExtends = extendsChanged
      ? (fieldsToUpdate.extends as string[] | undefined)
      : config.extends;
    const schemaToNormalize = fieldsToUpdate.schema ?? config.schema;
    if (
      (fieldsToUpdate.schema || parentChanged || extendsChanged) &&
      schemaToNormalize
    ) {
      const {
        schema: normalized,
        identical,
        conflicting,
      } = await req.context.models.configs.normalizeSchemaAgainstAncestors(
        {
          key: config.key,
          parent: effectiveParent || undefined,
          extends: effectiveExtends,
          value: fieldsToUpdate.value ?? config.value,
        },
        schemaToNormalize,
      );
      // Re-declaring an ancestor-owned field with a different definition can't
      // be honored (base wins) — reject rather than silently drop the intent.
      if (conflicting.length) {
        throw new BadRequestError(
          formatAncestorFieldConflictMessage(conflicting),
        );
      }
      warnings.push(...ancestorCollisionWarnings(identical));
      // Compare against the schema about to be persisted, not `config.schema`,
      // so a normalization change (e.g. stripped ancestor fields) is persisted.
      if (!isEqual(normalized, schemaToNormalize)) {
        fieldsToUpdate.schema = normalized;
      }
    }

    // Warn (never block) when a rule references a field the effective schema
    // doesn't declare — it would just read null at evaluation time. Runs on the
    // post-update state so a schema edit that un-declares a field an existing
    // rule references warns too.
    {
      const postSchema = fieldsToUpdate.schema ?? config.schema;
      if (postSchema?.invariants?.length) {
        const { fields: effectiveFields } = await getEffectiveConfigSchema(
          req.context,
          {
            key: config.key,
            name: config.name,
            value: fieldsToUpdate.value ?? config.value,
            schema: postSchema,
            parent: effectiveParent || undefined,
            extends: effectiveExtends,
          },
        );
        warnings.push(
          ...undeclaredRuleFieldWarnings(
            findUndeclaredInvariantRuleFields(
              postSchema.invariants,
              effectiveFields.map((f) => f.key),
            ),
          ),
        );
      }
    }

    // Cycle rejection is enforced in ConfigModel (covers every write path).

    if (Object.keys(fieldsToUpdate).length === 0) {
      // No value change to fail, so the deferred writes are atomic on their own.
      await commitScopedOverrides?.();
      const guardFields = await commitGuardToggle();
      return {
        config: await resolveOwnerEmail(
          req.context.models.configs.toApiInterface({
            ...config,
            ...guardFields,
          }),
          req.context,
        ),
        ...(warnings.length ? { warnings } : {}),
      };
    }

    // Customer validateConfig hooks gate updates too (matching the feature
    // analog and the create path); `original` carries the stored state so
    // incremental hooks can diff.
    await runValidateConfigHooks({
      context: req.context,
      config: {
        key: config.key,
        name: fieldsToUpdate.name ?? config.name,
        project: fieldsToUpdate.project ?? config.project ?? "",
        value: fieldsToUpdate.value ?? config.value,
        schema: fieldsToUpdate.schema ?? config.schema,
        parent: effectiveParent || undefined,
        extends: effectiveExtends,
        extensible: fieldsToUpdate.extensible ?? config.extensible,
      },
      original: {
        key: config.key,
        name: config.name,
        project: config.project ?? "",
        value: config.value,
        schema: config.schema,
        parent: config.parent || undefined,
        extends: config.extends,
        extensible: config.extensible,
      },
    });

    // A direct update publishes immediately, so block it while locked (a no-op
    // update short-circuits above and is unaffected). Unlock to publish changes.
    assertConfigNotLocked(config);

    // Re-validate the value against the effective schema if anything affecting
    // conformance changed.
    if (
      fieldsToUpdate.value !== undefined ||
      fieldsToUpdate.schema !== undefined ||
      fieldsToUpdate.extensible !== undefined ||
      parentChanged ||
      extendsChanged
    ) {
      const postValue = fieldsToUpdate.value ?? config.value;
      // Deferred-publish guards (direct publish → armed:false).
      await assertConfigPublishGuards(
        req.context,
        config,
        { armAcknowledgments: undefined },
        { armed: false },
      );
      // Direct REST update publishes live, so run the full publish gate
      // (schema + required fields + cross-field invariants + custom hooks),
      // matching every other config publish path. No `revision` arg: this is a
      // bypass/direct write with no review cycle.
      await assertConfigValueValidForPublish(
        req.context,
        {
          key: config.key,
          name: config.name,
          value: postValue,
          schema: fieldsToUpdate.schema ?? config.schema,
          parent: effectiveParent || undefined,
          extends: effectiveExtends,
          extensible: fieldsToUpdate.extensible ?? config.extensible,
        },
        { value: postValue },
      );
    }

    // A schema/parent/mixin change shifts the subtree's ancestry, so descendants
    // must be re-reconciled.
    const needsDescendantReconcile =
      fieldsToUpdate.schema !== undefined || parentChanged || extendsChanged;

    // Dry run BEFORE any write so an unresolvable descendant conflict rejects
    // without committing the root (see assertConfigDescendantsReconcilable for
    // the accepted residual race), then soft-warn when the change removes or
    // retypes fields descendants still use (?ignoreWarnings=true proceeds).
    if (needsDescendantReconcile) {
      const proposedRoot = {
        ...config,
        ...fieldsToUpdate,
      } as ConfigInterface;
      await assertConfigDescendantsReconcilable(req.context, proposedRoot);
      await assertConfigSchemaChangeSafeForDescendants(
        req.context,
        proposedRoot,
      );
    }

    // Change-aware approval gate: value/schema changes require review under
    // requireReviews; metadata-only may be exempt.
    const adapter = getAdapter("config");
    const patchOps = buildPatchOps(fieldsToUpdate as Record<string, unknown>);
    const approvalRequired = adapter.isApprovalRequiredForRevision
      ? adapter.isApprovalRequiredForRevision(req.context, {
          target: { snapshot: config, proposedChanges: patchOps },
        } as unknown as Revision)
      : adapter.isApprovalRequired(req.context);

    if (approvalRequired) {
      if (!bypassApproval) {
        throw new BadRequestError(
          "This organization requires approvals for this config. " +
            `Use \`POST /configs-revisions/${config.key}\` to open a draft, ` +
            'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
        );
      }
      const canBypass =
        canUseRestApiBypassSetting(req) ||
        adapter.canBypassApproval(
          req.context,
          config as unknown as Record<string, unknown>,
        );
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }

      // Record the already-merged revision FIRST, then apply it to the live
      // entity, rolling the revision back if the apply fails.
      await ensureLiveRevisionExists(
        req.context,
        "config",
        config as unknown as Record<string, unknown> & {
          id: string;
          owner?: string;
          dateCreated?: Date;
        },
      );
      const merged = await req.context.models.revisions.createMerged({
        type: "config",
        id: config.id,
        snapshot: config as unknown as Record<string, unknown>,
        proposedChanges: patchOps,
        bypass: true,
      });
      let updated: Partial<ConfigInterface>;
      try {
        updated = await req.context.models.configs.update(
          config,
          fieldsToUpdate as Parameters<
            typeof req.context.models.configs.update
          >[1],
        );
        // A schema/parent change can introduce a field a descendant already
        // declares; cascade "base wins" down the subtree. Kept inside the
        // rollback try (matching postConfigRevisionRevert) so a failed cascade
        // rolls back the merged revision too — else a "published" revision and
        // the root write persist with stale descendants and no webhook.
        if (needsDescendantReconcile) {
          await reconcileConfigDescendants(req.context, config.key);
        }
      } catch (e) {
        try {
          await req.context.models.revisions.deleteById(merged.id);
        } catch {
          // ignore — surface the original update error
        }
        throw e;
      }
      await dispatchConfigRevisionEvent(req.context, merged, {
        type: "published",
      });
      // Publish committed — now apply the deferred writes (atomic ordering).
      await commitScopedOverrides?.();
      const guardFields = await commitGuardToggle();
      return {
        config: await resolveOwnerEmail(
          req.context.models.configs.toApiInterface({
            ...config,
            ...updated,
            ...guardFields,
          }),
          req.context,
        ),
        ...(warnings.length ? { warnings } : {}),
      };
    }

    const updated = await req.context.models.configs.update(
      config,
      fieldsToUpdate as Parameters<typeof req.context.models.configs.update>[1],
    );
    if (needsDescendantReconcile) {
      await reconcileConfigDescendants(req.context, config.key);
    }
    // Publish committed — now apply the deferred writes (atomic ordering).
    await commitScopedOverrides?.();
    const guardFields = await commitGuardToggle();
    return {
      config: await resolveOwnerEmail(
        req.context.models.configs.toApiInterface({
          ...config,
          ...updated,
          ...guardFields,
        }),
        req.context,
      ),
      ...(warnings.length ? { warnings } : {}),
    };
  },
);
