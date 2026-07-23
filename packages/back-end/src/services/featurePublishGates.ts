import {
  autoMerge,
  checkIfRevisionNeedsReview,
  draftDiffersFromLive,
  evaluatePublishGovernance,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  getEnvsFromRampSchedule,
  getLiveChangesSinceBase,
  liveRevisionFromFeature,
  MergeResultChanges,
} from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { EventUser } from "shared/types/events/event-types";
import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";
import { computeProposedFeatureForValidation } from "back-end/src/models/FeatureModel";
import { computeRevisionPublishChanges } from "back-end/src/models/FeatureRevisionModel";
import {
  collectFeatureValueErrorsForPublish,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
import {
  assertConfigBackedDefaultHasNoOverrides,
  collectConfigBackedFeatureValueErrors,
} from "back-end/src/services/configValidation";
import {
  collectValidateFeatureHookResults,
  collectValidateFeatureRevisionHookResults,
} from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  collectFeatureArchiveDependents,
  archiveDependentsGateMessage,
} from "back-end/src/services/archiveDependentsGuard";
import { getEnvironments } from "back-end/src/util/organization.util";
import { MergeConflictError } from "back-end/src/util/errors";
import {
  PublishGate,
  hookResultsToGates,
  makeBlockingGate,
  schemaFailureGateOverride,
} from "back-end/src/revisions/publishGates";

type Context = ReqContext | ApiReqContext;

// Merge planning + publish-gate collection for a feature revision — the ONE
// implementation shared by the interactive REST publish handler
// (api/features/postFeatureRevisionPublish.ts) and the bulk publisher's
// feature adapter (revisions/bulkPublish/featureBulkAdapter.ts). Bulk-only
// gates (ramp actions/locks, sibling schedule locks) live in the adapter.

export type FeatureMergePlan = {
  environmentIds: string[];
  mergeResult: MergeResultChanges;
  filledLiveRules: FeatureRevisionInterface["rules"];
  /** Content differs from live, OR a pending ramp activates on this publish. */
  hasChanges: boolean;
  /** A ramp schedule is armed to activate when this revision publishes. */
  hasLinkedPendingRamp: boolean;
  requiresReview: boolean;
  rebaseRequired: boolean;
  /** The governance explanation when rebaseRequired (for error copy). */
  rebaseBlockReason: string | null;
};

export async function planFeatureRevisionMerge({
  context,
  feature,
  revision,
}: {
  context: Context;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
}): Promise<FeatureMergePlan> {
  const allEnvironments = getEnvironments(context.org);
  const environmentIds = filterEnvironmentsByFeature(
    allEnvironments,
    feature,
  ).map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });

  const merged = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    {},
  );
  if (!merged.success) {
    throw new MergeConflictError(
      "Merge conflicts exist — rebase before publishing",
      merged.conflicts,
    );
  }

  const rebaseGovernance = context.org.settings?.requireRebaseBeforePublish
    ? evaluatePublishGovernance({
        revisionStatus: revision.status,
        baseVersion: revision.baseVersion,
        liveVersion: feature.version,
        mergeSuccess: merged.success,
        liveChanges: getLiveChangesSinceBase(
          liveRevisionFromFeature(live, feature),
          fillRevisionFromFeature(base, feature),
          environmentIds,
        ),
        approvedBaseVersion: revision.approvedBaseVersion ?? null,
        requireRebaseBeforePublish: true,
      })
    : null;

  const filledLive = {
    ...live,
    ...liveRevisionFromFeature(live, feature),
  };
  // Post-unification `rules` is a flat `FeatureRule[]`. `merged.result.rules`
  // is either absent (no rule change) or the authoritative merged array — no
  // per-env object merging needed. rampActions live on the draft revision;
  // autoMerge doesn't carry them through MergeResultChanges, so re-attach them
  // so checkIfRevisionNeedsReview can inspect the ramp-schedule changes.
  const effectiveRevision = {
    ...filledLive,
    ...merged.result,
    rampActions: revision.rampActions,
  };

  // For ramp `update` actions, the live schedule's step patches may include
  // environments that the new draft removes. Build a map so the review check
  // can union old+new environments and catch the "removing env" direction.
  const liveRampScheduleEnvs = new Map<string, string[] | "all">();
  for (const action of revision.rampActions ?? []) {
    if (action.mode !== "update") continue;
    const liveSchedule = await context.models.rampSchedules.getById(
      action.rampScheduleId,
    );
    if (liveSchedule) {
      liveRampScheduleEnvs.set(
        action.rampScheduleId,
        getEnvsFromRampSchedule(liveSchedule),
      );
    }
  }

  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: filledLive,
    revision: effectiveRevision,
    allEnvironments: environmentIds,
    settings: context.org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
    liveRampScheduleEnvs,
  });

  const hasLinkedPendingRamp =
    (
      await context.models.rampSchedules.findByActivatingRevision(
        feature.id,
        revision.version,
      )
    ).length > 0;

  return {
    environmentIds,
    mergeResult: merged.result,
    filledLiveRules: filledLive.rules,
    hasChanges:
      draftDiffersFromLive(revision, live, feature, environmentIds) ||
      hasLinkedPendingRamp,
    hasLinkedPendingRamp,
    requiresReview,
    rebaseRequired: !!rebaseGovernance?.rebaseRequired,
    rebaseBlockReason: rebaseGovernance?.rebaseRequired
      ? rebaseGovernance.blockReason
      : null,
  };
}

/**
 * The interactive publish handler's gate set: stale-base, approval-required,
 * and (when `includeValidationGates`) publish-time value validation, custom
 * hooks, and archive-dependents. Throws on a config-backed default carrying
 * its own override patch — a structural payload error no override clears
 * (the bulk adapter catches it and reports it as a no-override gate).
 */
export async function collectFeaturePublishGates({
  context,
  feature,
  revision,
  plan,
  comment,
  publisher,
  includeValidationGates,
}: {
  /**
   * The validation context: the caller's request context on the interactive
   * path, the overlay scan context (hypothetical multi-entity end-state) on
   * the bulk path.
   */
  context: Context;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  plan: FeatureMergePlan;
  comment?: string;
  /**
   * The identity the publish will stamp as publishedBy — hooks judge it. The
   * bulk path must pass the CALLER's auditUser here (its validation context
   * is an identity-less scan context).
   */
  publisher?: EventUser;
  /**
   * Interactive publishes surface value + hook failures as gates (and skip
   * the throwing re-run in publishRevision). Armed/scheduled publishes leave
   * this false and keep the original throwing checks, whose block-vs-suppress
   * behavior relies on the background context's always-true ignoreWarnings.
   */
  includeValidationGates: boolean;
}): Promise<PublishGate[]> {
  const gates: PublishGate[] = [];
  const version = revision.version;

  if (plan.rebaseRequired) {
    gates.push(
      makeBlockingGate({
        type: "stale-base",
        messages: ["This revision was created against an older version."],
        override: "ignoreWarnings",
        requiresPermission: "bypassApprovalChecks",
        resolution: {
          action: "rebase",
          method: "POST",
          path: `/features/${feature.id}/revisions/${version}/rebase`,
        },
      }),
    );
  }
  if (plan.requiresReview && revision.status !== "approved") {
    gates.push(
      makeBlockingGate({
        type: "approval-required",
        messages: [
          `Requires approval before publishing (status: "${revision.status}").`,
        ],
        requiresPermission: "bypassApprovalChecks",
        resolution: {
          action: "request-review",
          method: "POST",
          path: `/features/${feature.id}/revisions/${version}/request-review`,
        },
      }),
    );
  }

  if (!includeValidationGates) return gates;

  const { proposedFeature, defaultToCheck, rulesToCheck } =
    computeProposedFeatureForValidation(
      context,
      feature,
      revision,
      plan.mergeResult,
    );

  // Structural payload guard: a config-backed default carrying its own override
  // patch breaks the SDK payload (the override ships verbatim, the backing
  // config is dropped). Not a demotable schema error — always throws; no
  // override clears it.
  assertConfigBackedDefaultHasNoOverrides(proposedFeature, defaultToCheck);

  // Schema-family failures: the feature's own JSON-schema value errors (checked
  // against the full merged values) plus the config-backed schema/invariant net
  // (only the changed subset, matching prevalidatePublishRevision). One gate,
  // override chosen by the org's blockPublishOnSchemaError setting: block ->
  // validation-class (skipSchemaValidation); warn -> acknowledge-class.
  const schemaErrors = [
    ...collectFeatureValueErrorsForPublish(feature, {
      defaultValue: plan.mergeResult.defaultValue,
      rules: plan.mergeResult.rules,
    }),
    ...(defaultToCheck !== undefined || rulesToCheck.length
      ? await collectConfigBackedFeatureValueErrors(context, proposedFeature, {
          defaultValue: defaultToCheck,
          rules: rulesToCheck,
        })
      : []),
  ];
  if (schemaErrors.length) {
    gates.push({
      type: "schema-validation",
      severity: "warning",
      messages: ["Invalid feature value:", ...schemaErrors],
      ...schemaFailureGateOverride(
        context.org.settings?.blockPublishOnSchemaError !== false,
      ),
      resolution: null,
    });
  }

  // Custom validation hooks: a hard error (a hook threw) is validation-class
  // (skipHooks); a warning is acknowledge-class (ignoreWarnings). Run both
  // hook types here so prevalidatePublishRevision (skipped when gated)
  // doesn't re-execute them. `original` is the live feature/revision so
  // incrementalChangesOnly hooks can suppress pre-existing outcomes.
  const featureHookResults = await collectValidateFeatureHookResults({
    context,
    feature: proposedFeature,
    original: feature,
  });
  const revisionHookResults = await collectValidateFeatureRevisionHookResults({
    context,
    // Symmetric with the feature hook above: pass the proposed (merged) feature
    // so a revision hook inspecting feature.tags/rules/etc. sees the staged
    // change under validation, not the stored pre-change feature.
    feature: proposedFeature,
    revision: {
      ...revision,
      ...computeRevisionPublishChanges(
        revision,
        publisher ?? context.auditUser,
        comment ?? "",
      ),
    },
    original: revision,
  });
  const hookHardErrors = [
    ...featureHookResults.hardErrors,
    ...revisionHookResults.hardErrors,
  ];
  const hookWarnings = [
    ...featureHookResults.warnings,
    ...revisionHookResults.warnings,
  ];
  gates.push(
    ...hookResultsToGates({
      hardErrors: hookHardErrors,
      warnings: hookWarnings,
    }),
  );

  // Archiving a feature that live features/experiments still reference as a
  // prerequisite is an acknowledge-class warning — emitted as a gate so the
  // publish returns one uniform 422 shape.
  if (plan.mergeResult.archived === true && !feature.archived) {
    const dependents = await collectFeatureArchiveDependents(
      context,
      feature.id,
    );
    if (dependents.ids.length) {
      gates.push({
        type: "archive-dependents",
        severity: "warning",
        messages: [archiveDependentsGateMessage("feature flag", dependents)],
        override: "ignoreWarnings",
        requiresPermission: null,
        resolution: null,
      });
    }
  }

  return gates;
}
