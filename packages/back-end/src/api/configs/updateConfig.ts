import { isEqual, omit } from "lodash";
import { Revision } from "shared/enterprise";
import {
  updateConfigValidator,
  validateResolvableValue,
} from "shared/validators";
import { ConfigInterface } from "shared/types/config";
import {
  scopedOverridesFootprint,
  stripConfigExtends,
  apiInvariantsToStored,
  formatAncestorFieldConflictMessage,
  ancestorCollisionWarnings,
  findUndeclaredInvariantRuleFields,
  undeclaredRuleFieldWarnings,
} from "shared/util";
import { ApiReqContext } from "back-end/types/api";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import { landDirectChange } from "back-end/src/revisions/revertActions";
import { logger } from "back-end/src/util/logger";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { runGuardedWrite } from "back-end/src/revisions/landingSequence";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";
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
import {
  assertScopedOverridesExperimentGuard,
  configChangeAffectsServedValue,
} from "back-end/src/services/experimentGuard";
import {
  assertScopedOverridesValid,
  assertScopedOverridesChangeAllowed,
  syncScopedConfigMarkers,
} from "back-end/src/services/constants";
import { runValidateConfigHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { configPublishEnvironments } from "back-end/src/revisions/revisionPublishEnvironments";
import { resolveConfigSchemaSource } from "./validations";

/**
 * Put scoped overrides back after a combined request fails downstream of them —
 * but only while they still hold what we wrote; a third request that changed
 * them since owns them now. The compare is just the early exit: the CAS guard
 * on `live` is what makes the write safe.
 */
async function revertScopedOverridesTo(
  context: ApiReqContext,
  config: ConfigInterface,
  previousOverrides: NonNullable<ConfigInterface["scopedOverrides"]>,
  nextOverrides: NonNullable<ConfigInterface["scopedOverrides"]>,
): Promise<void> {
  const live = await context.models.configs.getById(config.id);
  if (!live) return;
  if (!isEqual(live.scopedOverrides ?? [], nextOverrides)) return;
  try {
    await context.models.configs.updateIfUnchanged(
      live,
      { scopedOverrides: previousOverrides },
      undefined,
      { dangerouslyBypassCanUpdate: true },
    );
  } catch (e) {
    if (!(e instanceof CasConflictError)) throw e;
    // A lost race may have touched only unrelated fields, leaving OUR
    // overrides live. Re-read and retry; give up only once the overrides
    // themselves have moved to another owner.
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await context.models.configs.getById(config.id);
      if (!fresh) return;
      if (!isEqual(fresh.scopedOverrides ?? [], nextOverrides)) return;
      try {
        await context.models.configs.updateIfUnchanged(
          fresh,
          { scopedOverrides: previousOverrides },
          undefined,
          { dangerouslyBypassCanUpdate: true },
        );
        break;
      } catch (retryErr) {
        if (!(retryErr instanceof CasConflictError)) throw retryErr;
        if (attempt === 2) throw retryErr;
      }
    }
  }
  await syncScopedConfigMarkers(
    context,
    config.key,
    nextOverrides,
    previousOverrides,
  );
}

/**
 * Undo a committed scoped-override write when a later step of the same request
 * fails, and rethrow. If the undo itself fails, say so ON the error — reporting a
 * clean failure over durable state is the one outcome the caller cannot recover from.
 */
async function rollbackScopedOverridesOnFailure(
  configId: string,
  revert: (() => Promise<void>) | null,
  e: unknown,
): Promise<never> {
  if (revert) {
    try {
      await revert();
    } catch (revertErr) {
      logger.error(
        revertErr,
        `Config ${configId}: update failed and its scoped overrides could not be rolled back`,
      );
      if (e instanceof Error) {
        e.message +=
          " (the scoped overrides from this request were applied and could NOT be rolled back — reconcile them by hand)";
      }
    }
  }
  throw e;
}

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
      throw new NotFoundError(`Unable to locate the Config: ${key}`);
    }

    // Authoring gate; the landing gate is below. A move is checked on both
    // sides — you need authoring rights in the project you're taking it out of
    // and the one you're putting it into.
    if (
      !req.context.permissions.canRevisionAction("config", "draft", config) ||
      !req.context.permissions.canRevisionAction("config", "draft", {
        projects: [project ?? config.project ?? ""],
      })
    ) {
      req.context.permissions.throwPermissionError();
    }

    // Experiment-guard toggle: a config-level setting (not a revision field),
    // asymmetric like lock/unlock (OFF needs FlagsBypassApprovals). Check the
    // permission now but DEFER the write (commitGuardToggle) until after the
    // value publish succeeds, so a failed publish can't leave it half-applied.
    const guardToggle =
      req.body.experimentGuard !== undefined &&
      req.body.experimentGuard !== !!config.experimentGuard
        ? req.body.experimentGuard
        : undefined;
    // Same gates as the internal twin: enabling the guard is a served-behavior
    // change, so it takes env-scoped publish; turning it OFF removes a
    // protection and stays bypass-tier.
    if (
      guardToggle === true &&
      !req.context.permissions.canRevisionAction(
        "config",
        "publish",
        config,
        configPublishEnvironments(req.context, config),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
    if (
      guardToggle === false &&
      !req.context.permissions.canBypassFlagApprovalChecks(
        {
          project: config.project || "",
        },
        "config",
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
    if (guardToggle !== undefined) {
      // A locked config is frozen — its protections included. Unlock first
      // (same permission as turning the guard off) to change the guard. A
      // guard-only update short-circuits below, so the general lock gate on
      // publishing changes never runs for it.
      assertConfigNotLocked(config);
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
    // `onWritten` fires the instant the overrides are durable and hands back
    // their undo — installed there rather than on the commit's return because
    // the marker sync is a second write that can fail before the return.
    let commitScopedOverrides:
      | ((
          onWritten: (revert: () => Promise<void>) => void,
        ) => Promise<Partial<ConfigInterface>>)
      | null = null;
    if (
      req.body.scopedOverrides !== undefined &&
      !isEqual(req.body.scopedOverrides, config.scopedOverrides ?? [])
    ) {
      const nextOverrides = req.body.scopedOverrides;
      // Served behavior, so this takes publish authority (like the internal
      // setConfigScopedOverrides twin); an overrides-only request
      // short-circuits before the value path's check. Measured over the
      // current AND proposed entries, not the Config's own scope — a base
      // Config declares none, and an empty footprint would let a dev-limited
      // publisher add a production override.
      if (
        !req.context.permissions.canRevisionAction(
          "config",
          "publish",
          config,
          scopedOverridesFootprint({
            current: config.scopedOverrides,
            proposed: nextOverrides,
            allEnvironments: getEnvironmentIdsFromOrg(req.context.org),
          }),
        )
      ) {
        req.context.permissions.throwPermissionError();
      }
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
      const previousOverrides = config.scopedOverrides ?? [];
      commitScopedOverrides = async (onWritten) => {
        // Guarded on the handler-entry read, so two combined requests cannot
        // SPLICE — one request's overrides landing with the other's value while
        // both report success. The loser 409s here before committing anything.
        // canUpdate is bypassed because this write's authority is the publish
        // check above, not manage.
        const written = await runGuardedWrite("config", config.id, () =>
          req.context.models.configs.updateIfUnchanged(
            config,
            { scopedOverrides: nextOverrides },
            undefined,
            { dangerouslyBypassCanUpdate: true },
          ),
        );
        onWritten(() =>
          revertScopedOverridesTo(
            req.context,
            config,
            previousOverrides,
            nextOverrides,
          ),
        );
        await syncScopedConfigMarkers(
          req.context,
          config.key,
          previousOverrides,
          nextOverrides,
        );
        return written;
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
      // No value change to land, but the deferred writes are still more than one
      // write: the overrides commit's marker sync and the guard toggle can each
      // fail with the overrides already durable. Same rollback as the landing path.
      let revertOverridesOnly: (() => Promise<void>) | null = null;
      const { committedOverrides, guardFields } = await (async () => ({
        committedOverrides:
          (await commitScopedOverrides?.((revert) => {
            revertOverridesOnly = revert;
          })) ?? {},
        guardFields: await commitGuardToggle(),
      }))().catch((e) =>
        rollbackScopedOverridesOnFailure(config.id, revertOverridesOnly, e),
      );
      return {
        config: await resolveOwnerEmail(
          req.context.models.configs.toApiInterface({
            ...config,
            ...committedOverrides,
            ...guardFields,
          }),
          req.context,
        ),
        ...(warnings.length ? { warnings } : {}),
      };
    }

    // This endpoint always lands the change live (there's no draft mode), so it
    // needs publish authority on top of edit — same rule as the internal PUT.
    // Open a draft via POST /configs-revisions/:key without it.
    if (
      !req.context.permissions.canRevisionAction(
        "config",
        "publish",
        config,
        configPublishEnvironments(req.context, config),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }

    // A direct update publishes immediately, so block it while locked (a no-op
    // update short-circuits above and is unaffected). Unlock to publish changes.
    assertConfigNotLocked(config);

    // Deferred-publish guards (direct publish → armed:false). Gated on the
    // served-value classification, not the conformance one below — a
    // project-only move scrubs the ref for cross-project consumers, so it must
    // clear the guards even though the value itself didn't change.
    if (configChangeAffectsServedValue(Object.keys(fieldsToUpdate))) {
      await assertConfigPublishGuards(
        req.context,
        config,
        { armAcknowledgments: undefined },
        { armed: false },
        {
          value: fieldsToUpdate.value ?? config.value,
          schema: fieldsToUpdate.schema ?? config.schema,
          parent: effectiveParent || undefined,
          extends: effectiveExtends,
          extensible: fieldsToUpdate.extensible ?? config.extensible,
        },
      );
    }

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
      // Direct REST update publishes live, so run the full publish gate (schema +
      // required fields + cross-field invariants), matching every other config
      // publish path. No `revision` arg: this is a bypass/direct write with no
      // review cycle.
      //
      // `skipHooks`: the custom hooks run once, below, after every
      // authorization — running them here would execute customer sandbox code
      // before the move-destination and approval-bypass checks.
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
        undefined,
        { skipHooks: true },
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

    // Landing a move takes publish in the destination too.
    if (
      !holdsMoveDestination({
        permissions: req.context.permissions,
        model: "config",
        action: "publish",
        existing: config,
        proposed: { ...config, ...(project === undefined ? {} : { project }) },
        environments: configPublishEnvironments(req.context, config),
      })
    ) {
      req.context.permissions.throwPermissionError();
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

    // A successful publish must name the gates it skipped; this route enforces
    // approval outside the gate pipeline, so it reports the outcome itself.
    const bypassedGates: BypassedGate[] = [];
    if (approvalRequired) {
      if (!bypassApproval) {
        throw new BadRequestError(
          "This organization requires approvals for this Config. " +
            `Use \`POST /configs-revisions/${config.key}\` to open a draft, ` +
            'or pass `{ "bypassApproval": true }` if you have the bypass permission.',
        );
      }
      const viaRestSetting = canUseRestApiBypassSetting(req);
      const canBypass =
        viaRestSetting ||
        adapter.canBypassApproval(
          req.context,
          config as unknown as Record<string, unknown>,
        );
      if (!canBypass) {
        req.context.permissions.throwPermissionError();
      }
      bypassedGates.push({
        type: "approval-required",
        outcome: "bypassed",
        via: viaRestSetting
          ? "restApiBypassesReviews"
          : "bypassApprovalPermission",
      });
    }

    // Customer validateConfig hooks gate updates too (matching the feature
    // analog and the create path); `original` carries the stored state so
    // incremental hooks can diff. Runs after every authorization: hooks execute
    // customer sandbox code, which an unauthorized request must not drive.
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

    // Scoped overrides commit BEFORE the landing: they stand alone as user
    // intent (their own endpoint writes them independently), and a landing
    // that then loses its race leaves them applied for a retry to complete.
    //
    // The landing's pre-image is the doc the commit RETURNED — not a re-read.
    // The commit advances the config's token, and a re-read could observe a
    // third request's overrides landing in between; chaining to our own
    // write's token makes any interleaver a clean 409.
    let landingConfig = config;
    // Set when the overrides were committed, so a landing failure can put them
    // back.
    let revertScopedOverrides: (() => Promise<void>) | null = null;

    // Descendant writes the cascade makes on this landing's behalf; restored
    // after the root, since a descendant restored while the root still declares the
    // field is re-stripped by ancestor normalization.
    const cascadeWrites: {
      before: Record<string, unknown> & { id: string };
      written: Record<string, unknown>;
    }[] = [];

    // Everything from the overrides commit to the end of the landing runs
    // under one compensation path — the commit's marker sync and
    // `ensureLiveRevisionExists` can each fail with the overrides already
    // durable.
    const landed = await (async () => {
      if (commitScopedOverrides) {
        landingConfig = {
          ...config,
          ...(await commitScopedOverrides((revert) => {
            revertScopedOverrides = revert;
          })),
        };
      }

      // One landing path whether or not approval was bypassed: every direct
      // update is recorded and guarded. History first, then live state — a merged
      // record with no live change is removable; the reverse is unrepairable.
      await ensureLiveRevisionExists(
        req.context,
        "config",
        landingConfig as unknown as Record<string, unknown> & {
          id: string;
          owner?: string;
          dateCreated?: Date;
        },
      );
      return landDirectChange({
        context: req.context,
        entityType: "config",
        entity: landingConfig as unknown as Record<string, unknown> & {
          id: string;
        },
        patchOps,
        // Marks a skipped approval requirement; an org without one skips nothing.
        bypass: approvalRequired,
        // The root write and the descendant cascade are two steps, so a
        // failure in the second has a partial change to put back; the
        // adapter's afterRestorePreImage re-reconciles descendants.
        changes: fieldsToUpdate as Record<string, unknown>,
        cascade: () => cascadeWrites,
        write: async (report) => {
          // Guarded on the pre-image the landing was re-based onto — the
          // overrides commit advanced the config's token, so guarding on the
          // earlier read loses to our own write. Reports from INSIDE the
          // write, before audit and the afterUpdate hooks, so a cascade
          // failure below still sees the root write as persisted.
          const written = await runGuardedWrite("config", config.id, () =>
            req.context.models.configs.updateIfUnchanged(
              landingConfig,
              fieldsToUpdate as Parameters<
                typeof req.context.models.configs.update
              >[1],
              undefined,
              {
                onWritten: (doc) => report(doc as Record<string, unknown>),
              },
            ),
          );
          // A schema/parent change can introduce a field a descendant already
          // declares; cascade "base wins" down the subtree. Inside the write so a
          // failed cascade rolls the merged revision back too — otherwise a
          // "published" revision and the root write persist with stale
          // descendants and no webhook.
          if (needsDescendantReconcile) {
            await reconcileConfigDescendants(req.context, config.key, (w) =>
              cascadeWrites.push({
                before: w.before as unknown as Record<string, unknown> & {
                  id: string;
                },
                written: w.written,
              }),
            );
          }
          return written;
        },
      });
    })().catch((e) =>
      // A failure anywhere in here would otherwise leave the committed
      // overrides live with the value unpublished.
      rollbackScopedOverridesOnFailure(config.id, revertScopedOverrides, e),
    );
    const { merged, result: updated } = landed;
    await dispatchConfigRevisionEvent(req.context, merged, {
      type: "published",
    });
    // The guard toggle stays AFTER the landing: enabling the experiment guard
    // first would put our own value write behind the protection it just switched
    // on. A failure here must not surface as an error that hides the committed
    // publish — the publish stands, and the unapplied toggle becomes a warning.
    const postPublishWarnings: string[] = [];
    let guardFields: Partial<ConfigInterface> = {};
    try {
      guardFields = await commitGuardToggle();
    } catch (e) {
      logger.error(
        e,
        `Config ${config.id} published but its experiment-guard change failed to apply`,
      );
      postPublishWarnings.push(
        "The value was published, but the experiment-guard change could not be applied. Retry the guard change on its own.",
      );
    }
    return {
      config: await resolveOwnerEmail(
        req.context.models.configs.toApiInterface({
          ...landingConfig,
          ...updated,
          ...guardFields,
        }),
        req.context,
      ),
      ...(warnings.length ? { warnings } : {}),
      ...(postPublishWarnings.length ? { postPublishWarnings } : {}),
      ...(bypassedGates.length ? { bypassedGates } : {}),
    };
  },
);
