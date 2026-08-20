import {
  autoMerge,
  getRevisionReviewRequirement,
  draftDiffersFromLive,
  evaluatePublishGovernance,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  getEnvsFromRampSchedule,
  getLiveChangesSinceBase,
  liveRevisionFromFeature,
  MergeResultChanges,
  getReviewAuthorityFootprint,
  governingReviewProjectsForFeature,
} from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import {
  assessApprovalCoverage,
  assessRequiredApproverTeams,
  bypassApprovalPermission,
} from "shared/permissions";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { EventUser } from "shared/types/events/event-types";
import { getEnvironments } from "back-end/src/util/organization.util";
import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";
import {
  collectHoldoutChangeGates,
  computeProposedFeatureForValidation,
} from "back-end/src/models/FeatureModel";
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
  uncoveredApprovers: string[];
  hasCoveringApproval: boolean;
  requiredApproverTeams: {
    satisfied: boolean;
    unmet: { id: string; name: string }[][];
  };
  rebaseRequired: boolean;
  /** The governance explanation when rebaseRequired (for error copy). */
  rebaseBlockReason: string | null;
};

export type RevisionApprovalState = {
  requiresReview: boolean;
  uncoveredApprovers: string[];
  hasCoveringApproval: boolean;
  requiredApproverTeams: {
    satisfied: boolean;
    unmet: { id: string; name: string }[][];
  };
  /** Approved, covered, and every named team has signed. */
  satisfied: boolean;
};

// The set every feature publish/review decision expands "all" markers against:
// org environments filtered to the feature. One definition, no drift.
export function featurePublishEnvironmentIds(
  org: Context["org"],
  feature: FeatureInterface,
): string[] {
  return filterEnvironmentsByFeature(getEnvironments(org), feature).map(
    (e) => e.id,
  );
}

// The approval half of a publish decision, without the merge or ramp lookups a
// full plan needs. Every publish flow — manual or automatic — asks this.
export function assessRevisionApproval({
  context,
  feature,
  revision,
  effectiveRevision,
  filledLive,
  base,
  liveRampScheduleEnvs,
}: {
  context: Context;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  effectiveRevision: FeatureRevisionInterface;
  filledLive: FeatureRevisionInterface;
  base: FeatureRevisionInterface;
  liveRampScheduleEnvs?: Map<string, string[] | "all">;
}): RevisionApprovalState {
  // Derived, not caller-supplied: the autostart path once passed the org's
  // full list and judged review against environments the feature cannot serve.
  const environmentIds = featurePublishEnvironmentIds(context.org, feature);
  const reviewRequirement = getRevisionReviewRequirement({
    feature,
    baseRevision: filledLive,
    revision: effectiveRevision,
    orgEnvironments: getEnvironments(context.org),
    settings: context.org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
    liveRampScheduleEnvs,
  });
  const requiresReview = reviewRequirement.required;

  // Re-check standing approvals against what the draft changes NOW, using each
  // approver's current permissions. Status was materialized at approval time.
  const reviewFootprint = getReviewAuthorityFootprint({
    revision: effectiveRevision,
    bases: [filledLive, base],
    allEnvironments: environmentIds,
    settings: context.org.settings,
    governingProjects: governingReviewProjectsForFeature({
      feature,
      revision: effectiveRevision,
      settings: context.org.settings,
    }),
    liveRampScheduleEnvs,
  });
  const { hasCoveringApproval, uncoveredApprovers } = assessApprovalCoverage({
    org: context.org,
    teams: context.teams,
    model: "feature",
    projects: feature.project ? [feature.project] : [],
    footprint: reviewFootprint,
    approvers: (revision.reviews ?? [])
      .filter((r) => r.status === "approved")
      .map((r) => r.userId)
      .filter((id): id is string => !!id)
      .map((id) => ({
        id,
        roleInfo: context.org.members.find((m) => m.id === id) ?? null,
      })),
  });

  const coveringApproverIds = (revision.reviews ?? [])
    .filter((r) => r.status === "approved")
    .map((r) => r.userId)
    .filter((id): id is string => !!id)
    .filter((id) => !uncoveredApprovers.includes(id));
  const requiredTeams = assessRequiredApproverTeams({
    rules: reviewRequirement.rules,
    coveringApproverIds,
    org: context.org,
    teams: context.teams,
  });

  const satisfied =
    !requiresReview ||
    (revision.status === "approved" &&
      hasCoveringApproval &&
      requiredTeams.satisfied);

  return {
    requiresReview,
    uncoveredApprovers,
    hasCoveringApproval,
    requiredApproverTeams: requiredTeams,
    satisfied,
  };
}

export async function planFeatureRevisionMerge({
  context,
  feature,
  revision,
}: {
  context: Context;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
}): Promise<FeatureMergePlan> {
  const environmentIds = featurePublishEnvironmentIds(context.org, feature);

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

  const {
    requiresReview,
    uncoveredApprovers,
    hasCoveringApproval,
    requiredApproverTeams: requiredTeams,
  } = assessRevisionApproval({
    context,
    feature,
    revision,
    effectiveRevision,
    filledLive,
    base,
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
    uncoveredApprovers,
    hasCoveringApproval,
    requiredApproverTeams: requiredTeams,
    rebaseRequired: !!rebaseGovernance?.rebaseRequired,
    rebaseBlockReason: rebaseGovernance?.rebaseRequired
      ? rebaseGovernance.blockReason
      : null,
  };
}

// The interactive publish handler's gate set: stale-base, approval-required,
// holdout transition, and (when `includeValidationGates`) publish-time value
// validation, custom hooks, and archive-dependents. Throws on a config-backed
// default carrying its own override patch — a structural payload error no
// override clears (the bulk adapter catches it and reports it as a no-override
// gate).
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
  // Interactive publishes surface value + hook failures as gates (and skip
  // the throwing re-run in publishRevision). Armed/scheduled publishes leave
  // this false and keep the original throwing checks, whose block-vs-suppress
  // behavior relies on the background context's always-true ignoreWarnings.
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
        requiresPermission: bypassApprovalPermission("feature"),
        resolution: {
          action: "rebase",
          method: "POST",
          path: `/features/${feature.id}/revisions/${version}/rebase`,
        },
      }),
    );
  }
  const approvedAndCovered =
    revision.status === "approved" && plan.hasCoveringApproval;
  if (plan.requiresReview && !approvedAndCovered) {
    gates.push(
      makeBlockingGate({
        type: "approval-required",
        messages: [
          revision.status === "approved" && plan.uncoveredApprovers.length
            ? `This draft now changes environments its approvers cannot approve. Needs approval from someone with review rights across everything it changes.`
            : `Requires approval before publishing (status: "${revision.status}").`,
        ],
        requiresPermission: bypassApprovalPermission("feature"),
        resolution: {
          action: "request-review",
          method: "POST",
          path: `/features/${feature.id}/revisions/${version}/request-review`,
        },
      }),
    );
  }

  // Separate gate: a properly approved draft can still miss the named team.
  if (plan.requiresReview && !plan.requiredApproverTeams.satisfied) {
    gates.push(
      makeBlockingGate({
        type: "required-approvers-missing",
        messages: plan.requiredApproverTeams.unmet.map(
          (teams) =>
            `Requires approval from ${teams.map((t) => t.name).join(" or ")}.`,
        ),
        requiresPermission: bypassApprovalPermission("feature"),
        resolution: {
          action: "request-review",
          method: "POST",
          path: `/features/${feature.id}/revisions/${version}/request-review`,
        },
      }),
    );
  }

  // Above the validation-gate cutoff on purpose: surfaces that skip validation
  // gates still must not reach the linkage writes with a bad holdout transition.
  gates.push(
    ...(await collectHoldoutChangeGates({
      context,
      feature,
      mergeResult: plan.mergeResult,
      isRevert: !!revision.revertedFrom,
    })),
  );

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
        bypassApprovalPermission("feature"),
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
    feature,
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
    ...hookResultsToGates(
      {
        hardErrors: hookHardErrors,
        warnings: hookWarnings,
      },
      bypassApprovalPermission("feature"),
    ),
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
