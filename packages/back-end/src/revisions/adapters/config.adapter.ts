import { ConfigInterface } from "shared/types/config";
import {
  Revision,
  getConstantRevisionChange,
  normalizeProposedChanges,
} from "shared/enterprise";
import {
  configRequiresReview,
  configResetReviewOnChange,
  constantAutopublishOnApproval,
  formatAncestorFieldConflictMessage,
} from "shared/util";
import {
  configValidator,
  configUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import {
  EntityRevisionAdapter,
  filterUpdatableChanges,
} from "back-end/src/revisions/EntityRevisionAdapter";
import {
  reconcileConfigDescendants,
  assertConfigDescendantsReconcilable,
  assertConfigSchemaChangeSafeForDescendants,
  collectConfigSchemaChangeImpactGates,
} from "back-end/src/services/configReconcile";
import {
  assertConfigInvariantsValid,
  assertConfigValueValidForPublish,
} from "back-end/src/services/configValidation";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import {
  ArmAcknowledgments,
  buildArmAcknowledgments,
} from "back-end/src/services/armGuards";
import {
  captureConfigExperimentGuardAcknowledgment,
  configChangeAffectsServedValue,
  configRevisionAffectsServedValue,
  describeConfigConflictKeys,
  evaluateConfigExperimentGuardConflicts,
} from "back-end/src/services/experimentGuard";
import {
  captureConfigLockAcknowledgment,
  evaluateConfigLockConflicts,
} from "back-end/src/services/configLockGuard";
import {
  captureConfigSchemaBreakAcknowledgment,
  configArchiveSchemaBreakViolations,
  evaluateConfigOwnSchemaBreakConflicts,
} from "back-end/src/services/schemaBreakGuard";
import {
  captureConfigArchiveDependentsAcknowledgment,
  collectConfigArchiveDependents,
  archiveDependentsGateMessage,
} from "back-end/src/services/archiveDependentsGuard";
import { assertConfigPublishGuards } from "back-end/src/services/publishGuards";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import {
  gateOr5xx,
  makeBlockingGate,
  schemaFailureGateOverride,
} from "back-end/src/revisions/publishGates";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { normalizeConfigChangesAgainstAncestors } from "./configSchemaNormalize";

// Mirrors constant.adapter.ts (see it for rationale); only model + permissions differ.
// scopedOverrides (the env/project variant selection list) writes IMMEDIATELY,
// never through a revision, so it stays out of the snapshot — a draft carrying a
// stale copy must not be a write source. `scopedConfig` (the derived flavor
// marker) is kept IN the snapshot read-only: it's never in `getUpdatableFields`
// (configUpdatableFieldsSchema), so `buildMergeDesiredState` can't write it back,
// but the approval check needs a flavor's environment scope at its (synchronous)
// decision point to require review only for the environments the flavor targets.
const SNAPSHOT_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "scopedOverrides",
]);
const SNAPSHOT_ALLOWED_KEYS = (
  Object.keys(configValidator.shape) as Array<keyof ConfigInterface>
).filter((k) => !SNAPSHOT_EXCLUDED_KEYS.has(k));

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(configUpdatableFieldsSchema.shape),
);

function canBypassApprovalForConfig(
  context: Context,
  snapshot: ConfigInterface,
): boolean {
  return context.permissions.canBypassApprovalChecks({
    project: snapshot.project || "",
  });
}

function canEditConfig(context: Context, snapshot: ConfigInterface): boolean {
  return context.permissions.canUpdateConfig(snapshot, {});
}

function configApprovalConfigured(context: Context): boolean {
  if (!context.hasPremiumFeature("require-approvals")) return false;
  const requireReviews = context.org.settings?.requireReviews;
  if (typeof requireReviews === "boolean") return requireReviews;
  return (
    Array.isArray(requireReviews) &&
    requireReviews.some((r) => r.requireReviewOn)
  );
}

export const configAdapter: EntityRevisionAdapter<ConfigInterface> = {
  getModel(context: Context) {
    return context.models.configs as {
      getById(id: string): Promise<ConfigInterface | null>;
    };
  },

  buildSnapshot(entity: ConfigInterface): ConfigInterface {
    const source = entity as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const key of SNAPSHOT_ALLOWED_KEYS) {
      const value = source[key];
      if (value === null || value === undefined) continue;
      snapshot[key] = value;
    }
    return snapshot as unknown as ConfigInterface;
  },

  isRevisionRequired(context: Context): boolean {
    return configApprovalConfigured(context);
  },

  getUpdatableFields(): ReadonlySet<string> {
    return UPDATABLE_FIELDS;
  },

  canRead(context: Context, snapshot: ConfigInterface): boolean {
    return context.permissions.canReadSingleProjectResource(snapshot.project);
  },

  canCreate(context: Context, snapshot: ConfigInterface): boolean {
    return canEditConfig(context, snapshot);
  },

  canUpdate(context: Context, snapshot: ConfigInterface): boolean {
    return canEditConfig(context, snapshot);
  },

  canDelete(context: Context, snapshot: ConfigInterface): boolean {
    return canBypassApprovalForConfig(context, snapshot);
  },

  isApprovalRequired(context: Context): boolean {
    return configApprovalConfigured(context);
  },

  isApprovalRequiredForRevision(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    const snapshot = revision.target.snapshot as ConfigInterface;
    // A flavor's value applies only to its scoped environments, so review is
    // required per those environments (null = a base config → value change is
    // all-environments, like a feature defaultValue).
    const flavorEnvironments = snapshot.scopedConfig
      ? (snapshot.scopedConfig.environments ?? [])
      : null;
    return configRequiresReview(
      { project: snapshot.project },
      getConstantRevisionChange(snapshot, revision.target.proposedChanges),
      flavorEnvironments,
      context.org.settings,
    );
  },

  canBypassApproval(context: Context, snapshot: ConfigInterface): boolean {
    return canBypassApprovalForConfig(context, snapshot);
  },

  shouldResetReviewOnChange(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    const snapshot = revision.target.snapshot as ConfigInterface;
    const { valueChanged, changedEnvironments } = getConstantRevisionChange(
      snapshot,
      revision.target.proposedChanges,
    );
    const flavorEnvironments = snapshot.scopedConfig
      ? (snapshot.scopedConfig.environments ?? [])
      : null;
    return configResetReviewOnChange(
      { project: snapshot.project },
      { valueChanged, changedEnvironments },
      flavorEnvironments,
      context.org.settings,
    );
  },

  isAutopublishOnApprovalEnabled(
    context: Context,
    snapshot: ConfigInterface,
  ): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    return constantAutopublishOnApproval(
      { project: snapshot.project },
      context.org.settings,
    );
  },

  async applyChanges(
    context: Context,
    entity: ConfigInterface,
    changes: Record<string, unknown>,
    options?: { isRevert?: boolean },
  ): Promise<void> {
    // Guard asserts are skipped when (a) restoring a pre-image (isRevert — a
    // revert to known-good published state must not be vetoed by guards
    // judging mid-restore state) or (b) a bulk-publish commit is applying
    // (bulkPublishId set — every guard already ran as a plan gate against the
    // release's combined end-state; re-running against the mid-commit mix
    // would spuriously fail plan-clean releases).
    const skipGuardAsserts =
      !!options?.isRevert || !!context.bulkPublishApplying;
    const filteredChanges = filterUpdatableChanges(
      changes,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );

    if (Object.keys(filteredChanges).length === 0) return;

    // Publish-time "base wins" reconciliation: strip any contract-identical
    // field this config declares whose key a published ancestor now owns
    // (ancestors may have changed since the draft was authored); a
    // contract-DIFFERING re-declaration is rejected instead — its intent can't
    // be preserved by a strip. A lineage change (parent/extends) shifts which
    // keys the bases own, so the config's own schema is re-normalized even
    // when this revision didn't touch `schema`.
    const { changes: normalizedChanges, conflicting } =
      await normalizeConfigChangesAgainstAncestors(
        entity,
        filteredChanges,
        (config, schema) =>
          context.models.configs.normalizeSchemaAgainstAncestors(
            config,
            schema,
          ),
      );
    if (conflicting.length) {
      // A restore must not be vetoed: the normalized schema (collision keys
      // stripped, base wins) is still the closest reachable pre-image state.
      if (options?.isRevert) {
        logger.warn(
          { configKey: entity.key, conflicting },
          "Config restore stripped ancestor-conflicting schema fields",
        );
      } else {
        throw new BadRequestError(
          formatAncestorFieldConflictMessage(conflicting),
        );
      }
    }

    const touchesLineageOrSchema =
      normalizedChanges.schema !== undefined ||
      normalizedChanges.parent !== undefined ||
      "extends" in normalizedChanges;

    if (touchesLineageOrSchema) {
      const proposedRoot = {
        ...entity,
        ...normalizedChanges,
      } as ConfigInterface;
      // Hard fail-fast BEFORE the root write: a sibling two-owner conflict
      // can't be strip-resolved, and the post-write cascade would otherwise
      // throw AFTER the root is persisted — a partial write. Skipped ONLY in a
      // bulk commit, where the plan gate validates the combined end-state and
      // compensation undoes a throw; NEVER on a revert (isRevert), which has
      // no compensation to roll the root write back.
      if (!context.bulkPublishApplying) {
        await assertConfigDescendantsReconcilable(context, proposedRoot);
      }
      // Soft governance warning (removes/retypes fields descendants use) — a
      // revert to known-good state or a plan-gated bulk publish must not be
      // re-blocked here.
      if (!skipGuardAsserts) {
        await assertConfigSchemaChangeSafeForDescendants(context, proposedRoot);
      }
    }

    // Enforce cross-field invariants here — the chokepoint every publish path
    // (direct, scheduled, autopublish-on-approval) flows through — against the
    // revision's proposed (draft) state.
    if (!skipGuardAsserts) {
      await assertConfigInvariantsValid(
        context,
        {
          key: entity.key,
          name: entity.name,
          value:
            (normalizedChanges.value as string | undefined) ?? entity.value,
          // Honor an explicit schema clear (null): validate against no schema,
          // not the old one — `?? entity.schema` would resurrect the removed
          // invariants.
          schema:
            "schema" in normalizedChanges
              ? (normalizedChanges.schema as ConfigInterface["schema"])
              : entity.schema,
          parent:
            (normalizedChanges.parent as string | undefined) ?? entity.parent,
          extends:
            "extends" in normalizedChanges
              ? (normalizedChanges.extends as string[] | undefined)
              : entity.extends,
        },
        (normalizedChanges.value as string | undefined) ?? entity.value,
      );
    }

    await context.models.configs.update(
      entity,
      normalizedChanges as Parameters<typeof context.models.configs.update>[1],
    );

    // Cascade the change down to descendants when the schema or lineage changed.
    if (touchesLineageOrSchema) {
      await reconcileConfigDescendants(context, entity.key);
    }
  },

  // Self-heal path: a retry after applyChanges wrote the root but failed before
  // (or during) the descendant cascade arrives here with no net change, so
  // applyChanges — and its cascade — would never run. Replay the reconcile
  // (idempotent) whenever the revision touched schema or lineage.
  async beforeNoOpMerge(
    context: Context,
    entity: ConfigInterface,
    revision: Revision,
  ): Promise<void> {
    const touchesLineageOrSchema = normalizeProposedChanges(
      revision.target.proposedChanges,
    ).some((op) =>
      ["schema", "parent", "extends"].includes(op.path.split("/")[1]),
    );
    if (!touchesLineageOrSchema) return;
    await reconcileConfigDescendants(context, entity.key);
  },

  // Arming a scheduled publish on a locked config would just fail at every
  // poller tick — reject up front (the REST schedule handler does the same).
  assertSchedulable(context: Context, entity: ConfigInterface): void {
    assertConfigNotLocked(entity);
  },

  // Snapshot the deferred-publish guard fingerprints when arming; each guard
  // throws (bypassably) if its live conflicts aren't acknowledged.
  async captureArmAcknowledgment(
    context: Context,
    entity: ConfigInterface,
    proposedChanges: unknown,
  ): Promise<ArmAcknowledgments | undefined> {
    const valueAffecting = configRevisionAffectsServedValue(proposedChanges);
    // The config state this schedule would publish, for the schema-break
    // fingerprint (its own resolved value across envs).
    const proposedConfig = {
      ...entity,
      ...applyPatchToSnapshot(
        entity as unknown as Record<string, unknown>,
        normalizeProposedChanges(proposedChanges),
      ),
    } as ConfigInterface;
    // Model an archive transition ONLY when this revision flips `archived` —
    // symmetric with the deferred fire's `"archived" in filteredChanges`, so the
    // "schema-break" fingerprint captured here (own + archive breaks, unioned by
    // captureConfigSchemaBreakAcknowledgment) matches what the fire re-checks.
    const proposedArchived =
      !!proposedConfig.archived !== !!entity.archived
        ? !!proposedConfig.archived
        : undefined;
    return buildArmAcknowledgments({
      experiment: await captureConfigExperimentGuardAcknowledgment(
        context,
        entity,
        proposedChanges,
      ),
      "config-lock": valueAffecting
        ? await captureConfigLockAcknowledgment(context, {
            source: "config",
            key: entity.key,
            project: entity.project,
          })
        : undefined,
      "schema-break": valueAffecting
        ? await captureConfigSchemaBreakAcknowledgment(
            context,
            {
              key: entity.key,
              project: entity.project,
              value: proposedConfig.value,
              schema: proposedConfig.schema,
              parent: proposedConfig.parent,
              extends: proposedConfig.extends,
              extensible: proposedConfig.extensible,
            },
            proposedArchived,
          )
        : undefined,
      // Archive-dependents fingerprint — captured only for the archive direction
      // (an unarchive restores values and never breaks a dependent). Independent
      // of valueAffecting: a metadata-only revision that flips `archived` still
      // scrubs the config from every dependent's resolved value.
      "archive-dependents":
        proposedArchived === true
          ? await captureConfigArchiveDependentsAcknowledgment(context, {
              id: entity.id,
              key: entity.key,
              project: entity.project,
              value: proposedConfig.value,
              parent: proposedConfig.parent,
              extends: proposedConfig.extends,
            })
          : undefined,
    });
  },

  // Publish-guard evaluation for the REST publish handler's aggregated 422
  // (see EntityRevisionAdapter.collectPublishGates). Runs the same evaluators
  // assertConfigPublishGuards uses; on the REST publish path this plus the
  // handler's evaluatePublishGates IS the guard enforcement (the handler runs no
  // sequential asserts). Every active conflict is returned as a gate regardless
  // of the caller's authority, so the handler can classify it as blocking or
  // bypassed; a synchronous override (a live ignoreWarnings or bypass-approval
  // permission) is still logged here, matching the asserts' override logging.
  async collectPublishGates(
    context: Context,
    entity: ConfigInterface,
    revision: Revision,
    desiredState: Record<string, unknown>,
  ): Promise<PublishGate[]> {
    void revision;
    const filteredChanges = filterUpdatableChanges(
      desiredState,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );
    // A metadata-only publish can't rewrite any served value, so none of these
    // guards apply (matches the asserts' gating).
    if (!configChangeAffectsServedValue(Object.keys(filteredChanges))) {
      return [];
    }

    const override =
      context.ignoreWarnings || canBypassApprovalForConfig(context, entity);
    const gates: PublishGate[] = [];

    const experimentConflicts = [
      ...(await evaluateConfigExperimentGuardConflicts(context, entity)),
    ].sort();
    if (experimentConflicts.length) {
      if (override) {
        logger.info(
          {
            configId: entity.id,
            userId: context.userId,
            conflictKeys: experimentConflicts,
          },
          "Config experiment guard overridden on a direct publish",
        );
      }
      gates.push({
        type: "experiment-guard",
        severity: "warning",
        messages: [
          `Publishing this config rewrites the live value served to a running experiment (${describeConfigConflictKeys(
            experimentConflicts,
          )}).`,
        ],
        override: "ignoreWarnings",
        requiresPermission: null,
        resolution: null,
      });
    }

    const lockConflicts = [
      ...(await evaluateConfigLockConflicts(context, {
        source: "config",
        key: entity.key,
        project: entity.project,
      })),
    ].sort();
    if (lockConflicts.length) {
      if (override) {
        logger.info(
          {
            source: "config",
            key: entity.key,
            userId: context.userId,
            conflictKeys: lockConflicts,
          },
          "Config-lock guard overridden on a direct publish",
        );
      }
      gates.push({
        type: "dependent-config-locked",
        severity: "warning",
        messages: [
          `Publishing this config changes the resolved value of locked config(s): ${lockConflicts.join(
            ", ",
          )}.`,
        ],
        override: "ignoreWarnings",
        requiresPermission: null,
        resolution: null,
      });
    }

    // Presence-aware for the clearable fields (schema/parent/extends), matching
    // assertPublishable: `?? entity` would resurrect a cleared value.
    const schemaBreaks = await evaluateConfigOwnSchemaBreakConflicts(context, {
      key: entity.key,
      project: entity.project,
      value: (filteredChanges.value as string | undefined) ?? entity.value,
      schema:
        "schema" in filteredChanges
          ? (filteredChanges.schema as ConfigInterface["schema"])
          : entity.schema,
      parent:
        "parent" in filteredChanges
          ? (filteredChanges.parent as string | undefined)
          : entity.parent,
      extends:
        "extends" in filteredChanges
          ? (filteredChanges.extends as string[] | undefined)
          : entity.extends,
      extensible:
        (filteredChanges.extensible as boolean | undefined) ??
        entity.extensible,
    });
    if (schemaBreaks.length) {
      if (override) {
        logger.info(
          {
            configKey: entity.key,
            userId: context.userId,
            violations: schemaBreaks,
          },
          "Schema-break guard overridden on a direct publish",
        );
      }
      gates.push({
        type: "schema-validation",
        severity: "warning",
        messages: ["Invalid config value:", ...schemaBreaks],
        ...schemaFailureGateOverride(
          context.org.settings?.blockPublishOnSchemaError !== false,
        ),
        resolution: null,
      });
    }

    // A schema/lineage change that removes, retypes, or takes over fields
    // descendants still use — the gate form of
    // assertConfigSchemaChangeSafeForDescendants, evaluated on the same
    // normalized proposed root the apply would write.
    if (
      "schema" in filteredChanges ||
      filteredChanges.parent !== undefined ||
      "extends" in filteredChanges
    ) {
      const { changes: normalizedChanges, conflicting } =
        await normalizeConfigChangesAgainstAncestors(
          entity,
          filteredChanges,
          (config, schema) =>
            context.models.configs.normalizeSchemaAgainstAncestors(
              config,
              schema,
            ),
        );
      const proposedRoot = {
        ...entity,
        ...normalizedChanges,
      } as ConfigInterface;
      // Structural conflicts the apply would otherwise only throw on at commit
      // (a 500 + rollback churn) — surfaced here as blocking, unbypassable
      // gates so a plan/dryRun reports a clean 422 against the combined
      // end-state. Neither is strip-resolvable, so no override flag clears them.
      if (conflicting.length) {
        gates.push(
          makeBlockingGate({
            type: "ancestor-conflict",
            messages: [formatAncestorFieldConflictMessage(conflicting)],
          }),
        );
      }
      try {
        await assertConfigDescendantsReconcilable(context, proposedRoot);
      } catch (e) {
        // Only a 4xx-class reconcilability rejection is a real blocking gate;
        // an infra/5xx failure of the descendant scan must surface as itself,
        // not congeal into a permanent, unfixable descendant-conflict gate.
        gates.push(
          gateOr5xx(e, (message) =>
            makeBlockingGate({
              type: "descendant-conflict",
              messages: [message],
            }),
          ),
        );
      }
      gates.push(
        ...(await collectConfigSchemaChangeImpactGates(context, proposedRoot)),
      );
    }

    // Lineage/value reference-cycle gate (against the overlay end-state, so a
    // cycle formed only by the combined proposals of several release items is
    // caught): an @config: / parent / extends cycle can't publish — it would
    // leak raw placeholders into payloads. Unbypassable. Mirrors the
    // ConfigModel.beforeUpdate assert, which stands down during a bulk commit.
    if (
      "value" in filteredChanges ||
      filteredChanges.parent !== undefined ||
      "extends" in filteredChanges
    ) {
      const cyclic = await context.models.configs.findReferenceCycle({
        ...entity,
        ...filteredChanges,
      } as ConfigInterface);
      if (cyclic.length) {
        gates.push(
          makeBlockingGate({
            type: "reference-cycle",
            messages: [
              `This config references ${cyclic.join(
                ", ",
              )}, which would create a reference cycle.`,
            ],
          }),
        );
      }
    }

    // An archive/unarchive flip scrubs (or restores) this config's contribution
    // to every dependent's resolved value, which can break their schemas even
    // though the config's own value is untouched. Modeled only when this revision
    // flips `archived` — symmetric with assertConfigArchiveSchemaBreakGuard on
    // the deferred/assert path. Emitted as its own "schema-break" gate so the
    // message names the transition, not the config's own resolved value.
    const proposedArchived =
      "archived" in filteredChanges ? !!filteredChanges.archived : undefined;
    if (
      proposedArchived !== undefined &&
      !!entity.archived !== proposedArchived
    ) {
      const archiveBreaks = await configArchiveSchemaBreakViolations(
        context,
        { key: entity.key, project: entity.project },
        proposedArchived,
      );
      if (archiveBreaks.length) {
        if (override) {
          logger.info(
            {
              configKey: entity.key,
              userId: context.userId,
              violations: archiveBreaks,
            },
            "Schema-break guard overridden on a direct publish",
          );
        }
        gates.push({
          type: "schema-validation",
          severity: "warning",
          messages: [
            `${
              proposedArchived ? "Archiving" : "Unarchiving"
            } this config breaks a dependent config or feature value:`,
            ...archiveBreaks,
          ],
          ...schemaFailureGateOverride(
            context.org.settings?.blockPublishOnSchemaError !== false,
          ),
          resolution: null,
        });
      }
    }

    // Archiving a config with live dependents (lineage children, or features/
    // configs referencing it) is a soft, acknowledgeable warning — bypassable by
    // ignoreWarnings alone (no elevated permission). Emitted only for the archive
    // direction; the message is elevated when live feature flags consume it.
    if (proposedArchived === true && !entity.archived) {
      const dependents = await collectConfigArchiveDependents(context, {
        id: entity.id,
        key: entity.key,
        // Presence-aware proposed value/lineage — a combined archive + value/
        // lineage change must fingerprint the state being published, matching the
        // arm/fire path in assertConfigPublishGuards.
        value:
          "value" in filteredChanges
            ? (filteredChanges.value as string | undefined)
            : entity.value,
        parent:
          "parent" in filteredChanges
            ? (filteredChanges.parent as string | undefined)
            : entity.parent,
        extends:
          "extends" in filteredChanges
            ? (filteredChanges.extends as string[] | undefined)
            : entity.extends,
      });
      if (dependents.ids.length) {
        if (override) {
          logger.info(
            {
              configKey: entity.key,
              userId: context.userId,
              dependents: dependents.ids,
            },
            "Archive-dependents guard overridden on a direct publish",
          );
        }
        gates.push({
          type: "archive-dependents",
          severity: "warning",
          messages: [archiveDependentsGateMessage("config", dependents)],
          override: "ignoreWarnings",
          requiresPermission: null,
          resolution: null,
        });
      }
    }

    return gates;
  },

  // Pre-merge gate (see EntityRevisionAdapter.assertPublishable): runs the full
  // publish-time validation against the proposed state BEFORE the revision is
  // marked merged, so a failing publish errors and leaves the draft open instead
  // of stranding it "merged". Mirrors the REST publish handler's pre-merge checks
  // (postConfigRevisionPublish). assertConfigValueValidForPublish also enforces
  // the cross-field invariants.
  async assertPublishable(
    context: Context,
    entity: ConfigInterface,
    desiredState: Record<string, unknown>,
    revision: Revision,
    options?: { isRevert?: boolean; deferred?: boolean },
  ): Promise<void> {
    // Pre-merge lock gate for the shared publishRevision action (auto-publish on
    // approval, scheduled-publish poller). Throwing here — before the merge is
    // claimed — leaves the draft open instead of stranding it "merged".
    assertConfigNotLocked(entity);

    const filteredChanges = filterUpdatableChanges(
      desiredState,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );
    if (Object.keys(filteredChanges).length === 0) return;

    // Experiment guard. `deferred` reflects THIS invocation (poller /
    // auto-publish-on-approval), not whether the revision has auto-publish armed —
    // so a manual "publish now" of an armed revision still gets the live override.
    // Skipped for a metadata-only publish (no served value changes → can't
    // disrupt an experiment), matching the direct-update path.
    if (configChangeAffectsServedValue(Object.keys(filteredChanges))) {
      await assertConfigPublishGuards(
        context,
        entity,
        revision,
        { armed: !!options?.deferred },
        {
          value: (filteredChanges.value as string | undefined) ?? entity.value,
          // Presence-aware for the clearable fields: `?? entity` can't tell
          // "unchanged" from "cleared" (schema clears to null, parent/extends to
          // ""/[]), which would resurrect the pre-clear value and desync this
          // fire from the arm-time capture (applyPatchToSnapshot) — bricking the
          // deferred publish with a terminal guard error.
          schema:
            "schema" in filteredChanges
              ? (filteredChanges.schema as ConfigInterface["schema"])
              : entity.schema,
          parent:
            "parent" in filteredChanges
              ? (filteredChanges.parent as string | undefined)
              : entity.parent,
          extends:
            "extends" in filteredChanges
              ? (filteredChanges.extends as string[] | undefined)
              : entity.extends,
          extensible:
            (filteredChanges.extensible as boolean | undefined) ??
            entity.extensible,
        },
        // Model an archive/unarchive transition only when this revision flips
        // `archived` (mirrors the arm-time capture). assertConfigPublishGuards
        // then runs assertConfigArchiveSchemaBreakGuard against dependents, and —
        // on a deferred fire — re-checks it against the unioned arm-time
        // "schema-break" fingerprint captured in captureArmAcknowledgment.
        "archived" in filteredChanges ? !!filteredChanges.archived : undefined,
      );
    }

    // Normalize BEFORE the descendant dry-run (otherwise it sees an
    // un-normalized root that still declares an ancestor-owned key and reports
    // a spurious sibling conflict at a composing descendant), rejecting
    // contract-differing re-declarations pre-merge like applyChanges does.
    const { changes: normalizedChanges, conflicting } =
      await normalizeConfigChangesAgainstAncestors(
        entity,
        filteredChanges,
        (config, schema) =>
          context.models.configs.normalizeSchemaAgainstAncestors(
            config,
            schema,
          ),
      );
    if (conflicting.length) {
      throw new BadRequestError(
        formatAncestorFieldConflictMessage(conflicting),
      );
    }

    const touchesLineageOrSchema =
      normalizedChanges.schema !== undefined ||
      normalizedChanges.parent !== undefined ||
      "extends" in normalizedChanges;

    if (touchesLineageOrSchema) {
      const proposedRoot = {
        ...entity,
        ...normalizedChanges,
      } as ConfigInterface;
      await assertConfigDescendantsReconcilable(context, proposedRoot);
      // On a deferred merge a tripped descendant warning is terminal (parks the
      // revision + fires publishFailed) instead of silently skipped — the
      // request-less context's forced ignoreWarnings isn't user intent.
      await assertConfigSchemaChangeSafeForDescendants(context, proposedRoot, {
        deferred: !!options?.deferred,
      });
    }

    const postValue =
      (normalizedChanges.value as string | undefined) ?? entity.value;
    await assertConfigValueValidForPublish(
      context,
      {
        key: entity.key,
        name: entity.name,
        value: postValue,
        // Honor an explicit schema clear (null): a schema-less revert publishes
        // against no schema rather than the schema it's removing.
        schema:
          "schema" in normalizedChanges
            ? (normalizedChanges.schema as ConfigInterface["schema"])
            : entity.schema,
        parent:
          (normalizedChanges.parent as string | undefined) ?? entity.parent,
        extends:
          "extends" in normalizedChanges
            ? (normalizedChanges.extends as string[] | undefined)
            : entity.extends,
        extensible: entity.extensible,
      },
      { value: postValue },
      revision,
      { deferred: !!options?.deferred },
    );
  },
};
