import { ConstantInterface } from "shared/types/constant";
import {
  Revision,
  getConstantRevisionChange,
  normalizeProposedChanges,
} from "shared/enterprise";
import {
  constantRequiresReview,
  constantResetReviewOnChange,
  constantAutopublishOnApproval,
} from "shared/util";
import {
  constantValidator,
  constantUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import {
  EntityRevisionAdapter,
  filterUpdatableChanges,
} from "back-end/src/revisions/EntityRevisionAdapter";
import {
  ArmAcknowledgments,
  buildArmAcknowledgments,
} from "back-end/src/services/armGuards";
import {
  captureConstantExperimentGuardAcknowledgment,
  constantChangeAffectsServedValue,
  constantRevisionAffectsServedValue,
  describeConstantConflictKeys,
  evaluateConstantExperimentGuardConflicts,
} from "back-end/src/services/experimentGuard";
import {
  captureConfigLockAcknowledgment,
  evaluateConfigLockConflicts,
} from "back-end/src/services/configLockGuard";
import {
  captureConstantSchemaBreakAcknowledgment,
  constantSchemaBreakViolations,
} from "back-end/src/services/schemaBreakGuard";
import {
  captureConstantArchiveDependentsAcknowledgment,
  collectConstantArchiveDependents,
  archiveDependentsGateMessage,
} from "back-end/src/services/archiveDependentsGuard";
import { assertConstantPublishGuards } from "back-end/src/services/publishGuards";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { schemaFailureGateOverride } from "back-end/src/revisions/publishGates";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";
import { logger } from "back-end/src/util/logger";

// Whitelist of fields the snapshot is allowed to carry, derived from the schema
// so the two can't drift. The snapshot validator runs in `.strict()` mode, so
// stray non-schema keys (e.g. MongoDB `_id`) would otherwise fail validation.
const SNAPSHOT_ALLOWED_KEYS = Object.keys(constantValidator.shape) as Array<
  keyof ConstantInterface
>;

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(constantUpdatableFieldsSchema.shape),
);

// User must be able to bypass approval in the constant's project (treats the
// unset case as the global "" project). Used both for the bypass-approval gate
// and for non-author revision deletion, since discarding someone else's
// in-flight revision is an admin-level action.
function canBypassApprovalForConstant(
  context: Context,
  snapshot: ConstantInterface,
): boolean {
  return context.permissions.canBypassApprovalChecks({
    project: snapshot.project || "",
  });
}

// canCreate and canUpdate both gate on the constant edit permission; extract so
// the two stay in sync.
function canEditConstant(
  context: Context,
  snapshot: ConstantInterface,
): boolean {
  return context.permissions.canUpdateConstant(snapshot, {});
}

// Constants inherit the feature `requireReviews` org settings (drop-in for
// feature config). Coarse, change-agnostic gate: does the org have any active
// review rule? Used for inbox/badge surfacing; the precise per-change decision
// lives in `isApprovalRequiredForRevision`.
function constantApprovalConfigured(context: Context): boolean {
  if (!context.hasPremiumFeature("require-approvals")) return false;
  const requireReviews = context.org.settings?.requireReviews;
  if (typeof requireReviews === "boolean") return requireReviews;
  return (
    Array.isArray(requireReviews) &&
    requireReviews.some((r) => r.requireReviewOn)
  );
}

export const constantAdapter: EntityRevisionAdapter<ConstantInterface> = {
  getModel(context: Context) {
    return context.models.constants as {
      getById(id: string): Promise<ConstantInterface | null>;
    };
  },

  buildSnapshot(entity: ConstantInterface): ConstantInterface {
    // Pick only schema-defined keys and drop nullish optional fields. This
    // strips MongoDB internals (`_id`) so the `.strict()` snapshot validator passes.
    const source = entity as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const key of SNAPSHOT_ALLOWED_KEYS) {
      const value = source[key];
      if (value === null || value === undefined) continue;
      snapshot[key] = value;
    }
    return snapshot as unknown as ConstantInterface;
  },

  isRevisionRequired(context: Context): boolean {
    return constantApprovalConfigured(context);
  },

  getUpdatableFields(): ReadonlySet<string> {
    return UPDATABLE_FIELDS;
  },

  canRead(context: Context, snapshot: ConstantInterface): boolean {
    return context.permissions.canReadVisibilityScopedResource(snapshot);
  },

  canCreate(context: Context, snapshot: ConstantInterface): boolean {
    return canEditConstant(context, snapshot);
  },

  canUpdate(context: Context, snapshot: ConstantInterface): boolean {
    return canEditConstant(context, snapshot);
  },

  // Gates non-author deletion of a revision document (authors can always delete
  // their own — see RevisionModel.canDelete). Restricted to users who can
  // bypass approval, since discarding another user's in-flight revision is an
  // admin-level action.
  canDelete(context: Context, snapshot: ConstantInterface): boolean {
    return canBypassApprovalForConstant(context, snapshot);
  },

  isApprovalRequired(context: Context): boolean {
    return constantApprovalConfigured(context);
  },

  // Precise, change-aware gate using the feature `requireReviews` model: a
  // `value` change requires review (affects all environments); a per-environment
  // override requires review only when that environment is in scope; a
  // metadata-only change follows the rule's `featureRequireMetadataReview`.
  isApprovalRequiredForRevision(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    const snapshot = revision.target.snapshot as ConstantInterface;
    return constantRequiresReview(
      { project: snapshot.project },
      getConstantRevisionChange(snapshot, revision.target.proposedChanges),
      context.org.settings,
    );
  },

  canBypassApproval(context: Context, snapshot: ConstantInterface): boolean {
    return canBypassApprovalForConstant(context, snapshot);
  },

  // Constants borrow the feature `requireReviews` model (not `approvalFlows`),
  // so reset-on-change and autopublish-on-approval are derived from the matched
  // review rule rather than the default approval-flow toggles.
  shouldResetReviewOnChange(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    const snapshot = revision.target.snapshot as ConstantInterface;
    const { valueChanged, changedEnvironments } = getConstantRevisionChange(
      snapshot,
      revision.target.proposedChanges,
    );
    return constantResetReviewOnChange(
      { project: snapshot.project },
      { valueChanged, changedEnvironments },
      context.org.settings,
    );
  },

  isAutopublishOnApprovalEnabled(
    context: Context,
    snapshot: ConstantInterface,
  ): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    return constantAutopublishOnApproval(
      { project: snapshot.project },
      context.org.settings,
    );
  },

  async applyChanges(
    context: Context,
    entity: ConstantInterface,
    changes: Record<string, unknown>,
    // `isRevert` is intentionally NOT used to bypass validation. ConstantModel's
    // cycle check (beforeUpdate → assertNoCycle) runs on every write, reverts
    // included: restoring an old value that would reconstruct a reference cycle
    // against the *current* graph is correctly rejected (a stored cycle leaks
    // raw `@const:` placeholders into the payload). Unlike the saved-group
    // adapter's stale-attribute skip, there's no revert-safe validation to opt
    // out of here — so the flag is accepted for interface conformance only.
    options?: { isRevert?: boolean },
  ): Promise<void> {
    void options;
    const filteredChanges = filterUpdatableChanges(
      changes,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );

    if (Object.keys(filteredChanges).length === 0) return;

    await context.models.constants.update(
      entity,
      filteredChanges as Parameters<typeof context.models.constants.update>[1],
    );
  },

  // Snapshot the deferred-publish guard fingerprints when arming (schedule /
  // auto-publish-on-approval); each guard throws (bypassably) on unacknowledged
  // live conflicts. Mirrors the config adapter.
  async captureArmAcknowledgment(
    context: Context,
    entity: ConstantInterface,
    proposedChanges: unknown,
  ): Promise<ArmAcknowledgments | undefined> {
    const valueAffecting = constantRevisionAffectsServedValue(proposedChanges);
    // The base + per-environment values this schedule would publish, for the
    // schema-break fingerprint (must match what the deferred fire re-checks).
    const proposedSnapshot = applyPatchToSnapshot(
      entity as unknown as Record<string, unknown>,
      normalizeProposedChanges(proposedChanges),
    ) as {
      value?: string;
      environmentValues?: Record<string, string>;
      archived?: boolean;
    };
    const proposedValue = proposedSnapshot.value ?? entity.value;
    const proposedEnvironmentValues =
      proposedSnapshot.environmentValues ?? entity.environmentValues;
    // Model an archive transition ONLY when this revision flips `archived` —
    // symmetric with the deferred fire's `"archived" in filteredChanges` (which
    // filterUpdatableChanges includes only when it differs from the entity), so
    // arm capture and fire compute the identical archive-break set. Normalized to
    // a boolean so an absent-vs-false representation difference never spuriously
    // reads as a transition.
    const proposedArchived =
      !!proposedSnapshot.archived !== !!entity.archived
        ? !!proposedSnapshot.archived
        : undefined;
    return buildArmAcknowledgments({
      experiment: await captureConstantExperimentGuardAcknowledgment(
        context,
        entity,
        proposedChanges,
      ),
      "config-lock": valueAffecting
        ? await captureConfigLockAcknowledgment(context, {
            source: "constant",
            key: entity.key,
            project: entity.project,
          })
        : undefined,
      "schema-break": valueAffecting
        ? await captureConstantSchemaBreakAcknowledgment(
            context,
            { key: entity.key, project: entity.project },
            proposedValue,
            proposedEnvironmentValues,
            proposedArchived,
          )
        : undefined,
      // Archive-dependents fingerprint — only for the archive direction (an
      // unarchive restores values and never breaks a dependent).
      "archive-dependents":
        proposedArchived === true
          ? await captureConstantArchiveDependentsAcknowledgment(context, {
              id: entity.id,
              key: entity.key,
              project: entity.project,
            })
          : undefined,
    });
  },

  // Publish-guard evaluation for the REST publish handler's aggregated 422
  // (see EntityRevisionAdapter.collectPublishGates). Mirrors the config
  // adapter: same evaluators as assertConstantPublishGuards, and on the REST
  // publish path this plus the handler's evaluatePublishGates IS the guard
  // enforcement. Every active conflict is returned as a gate regardless of the
  // caller's authority, so the handler can classify it as blocking or bypassed;
  // a synchronous override is still logged here, matching the asserts' logging.
  async collectPublishGates(
    context: Context,
    entity: ConstantInterface,
    revision: Revision,
    desiredState: Record<string, unknown>,
  ): Promise<PublishGate[]> {
    void revision;
    const filteredChanges = filterUpdatableChanges(
      desiredState,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );
    // Metadata-only publishes can't rewrite any served value.
    if (!constantChangeAffectsServedValue(Object.keys(filteredChanges))) {
      return [];
    }

    const override =
      context.ignoreWarnings || canBypassApprovalForConstant(context, entity);
    const gates: PublishGate[] = [];

    const experimentConflicts = [
      ...(await evaluateConstantExperimentGuardConflicts(context, entity)),
    ].sort();
    if (experimentConflicts.length) {
      if (override) {
        logger.info(
          {
            constantKey: entity.key,
            userId: context.userId,
            conflictKeys: experimentConflicts,
          },
          "Constant experiment guard overridden on a direct publish",
        );
      }
      gates.push({
        type: "experiment-guard",
        severity: "warning",
        messages: [
          `Publishing this constant rewrites the live value served to a running experiment (${describeConstantConflictKeys(
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
        source: "constant",
        key: entity.key,
        project: entity.project,
      })),
    ].sort();
    if (lockConflicts.length) {
      if (override) {
        logger.info(
          {
            source: "constant",
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
          `Publishing this constant changes the resolved value of locked config(s): ${lockConflicts.join(
            ", ",
          )}.`,
        ],
        override: "ignoreWarnings",
        requiresPermission: null,
        resolution: null,
      });
    }

    // Without a proposed base value there's nothing to resolve-and-check; fail
    // open like assertConstantSchemaBreakGuard (soft advisory, not a gate). An
    // archive-only revision still has a defined value (falls back to the
    // entity's), so the transition (proposedArchived) is checked here too.
    const proposedValue =
      (filteredChanges.value as string | undefined) ?? entity.value;
    const proposedArchived =
      "archived" in filteredChanges ? !!filteredChanges.archived : undefined;
    const schemaBreaks =
      proposedValue === undefined
        ? []
        : await constantSchemaBreakViolations(
            context,
            { key: entity.key, project: entity.project },
            proposedValue,
            "environmentValues" in filteredChanges
              ? (filteredChanges.environmentValues as
                  | Record<string, string>
                  | undefined)
              : entity.environmentValues,
            proposedArchived,
          );
    if (schemaBreaks.length) {
      if (override) {
        logger.info(
          {
            constantKey: entity.key,
            userId: context.userId,
            violations: schemaBreaks,
          },
          "Schema-break guard overridden on a direct publish",
        );
      }
      gates.push({
        type: "schema-validation",
        severity: "warning",
        messages: [
          "Breaks a dependent config or feature value:",
          ...schemaBreaks,
        ],
        ...schemaFailureGateOverride(
          context.org.settings?.blockPublishOnSchemaError !== false,
        ),
        resolution: null,
      });
    }

    // Archiving a constant still referenced by features or constants/configs is a
    // soft, acknowledgeable warning (bypassable by ignoreWarnings alone). Only the
    // archive direction is guarded.
    if (proposedArchived === true && !entity.archived) {
      const dependents = await collectConstantArchiveDependents(
        context,
        entity.id,
      );
      if (dependents.ids.length) {
        if (override) {
          logger.info(
            {
              constantKey: entity.key,
              userId: context.userId,
              dependents: dependents.ids,
            },
            "Archive-dependents guard overridden on a direct publish",
          );
        }
        gates.push({
          type: "archive-dependents",
          severity: "warning",
          messages: [archiveDependentsGateMessage("constant", dependents)],
          override: "ignoreWarnings",
          requiresPermission: null,
          resolution: null,
        });
      }
    }

    return gates;
  },

  // Pre-merge gate for deferred publishes (scheduled poller, auto-publish-on-
  // approval). Warns when this value change would reach a running experiment
  // through a guarded config; the deferred fire re-confirms against the arm-time
  // acknowledgment. Metadata-only changes skip the check.
  async assertPublishable(
    context: Context,
    entity: ConstantInterface,
    desiredState: Record<string, unknown>,
    revision: Revision,
    options?: { isRevert?: boolean; deferred?: boolean },
  ): Promise<void> {
    const filteredChanges = filterUpdatableChanges(
      desiredState,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );
    if (constantChangeAffectsServedValue(Object.keys(filteredChanges))) {
      await assertConstantPublishGuards(
        context,
        entity,
        revision,
        { armed: !!options?.deferred },
        (filteredChanges.value as string | undefined) ?? entity.value,
        "environmentValues" in filteredChanges
          ? (filteredChanges.environmentValues as
              | Record<string, string>
              | undefined)
          : entity.environmentValues,
        // Model an archive/unarchive transition only when this revision flips
        // `archived` (mirrors the arm-time capture's derivation for symmetry).
        "archived" in filteredChanges ? !!filteredChanges.archived : undefined,
      );
    }
  },
};
