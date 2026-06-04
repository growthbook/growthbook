import { postFeatureRevisionPublishValidator } from "shared/validators";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  draftDiffersFromLive,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  getEnvsFromRampSchedule,
  liveRevisionFromFeature,
} from "shared/util";
import type { ApiRequestLocals } from "back-end/types/api";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  getLiveAndBaseRevisionsForFeature,
  getMergeResultPublishEnvs,
  toApiRevision,
} from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export async function publishFeatureRevision(
  req: Pick<ApiRequestLocals, "context" | "organization" | "audit"> & {
    params: { id: string; version: number };
    body: { comment?: string };
  },
  canUseRestApiBypass: boolean,
) {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  if (revision.status === "published" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context: req.context,
    feature,
    revision,
  });

  const hasLinkedPendingRamp =
    (
      await req.context.models.rampSchedules.findByActivatingRevision(
        feature.id,
        revision.version,
      )
    ).length > 0;
  const hasChanges =
    draftDiffersFromLive(revision, live, feature, environmentIds) ||
    hasLinkedPendingRamp;
  if (!hasChanges) {
    throw new BadRequestError(
      "Cannot publish: no changes detected in this revision",
    );
  }

  // Review requirements are evaluated against the post-merge state.
  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    {},
  );

  if (!mergeResult.success) {
    throw new ConflictError(
      "Merge conflicts exist — rebase before publishing",
      mergeResult.conflicts,
    );
  }

  const filledLive = {
    ...live,
    ...liveRevisionFromFeature(live, feature),
  };
  // Post-unification `rules` is a flat `FeatureRule[]`. `mergeResult.result.rules`
  // is either absent (no rule change) or the authoritative merged array — no
  // per-env object merging needed. Spreading arrays into an object literal and
  // merging by numeric index here would silently corrupt downstream review /
  // permission checks that key off env names.
  const effectiveRevision = {
    ...filledLive,
    ...mergeResult.result,
    // rampActions live on the draft revision; autoMerge doesn't carry them
    // through MergeResultChanges, so we must re-attach them explicitly so
    // that checkIfRevisionNeedsReview can inspect the ramp-schedule changes.
    rampActions: revision.rampActions,
  };

  // For ramp `update` actions, the live schedule's step patches may include
  // environments that the new draft removes. Build a map so the review check
  // can union old+new environments and catch the "removing env" direction.
  const liveRampScheduleEnvs = new Map<string, string[] | "all">();
  for (const action of revision.rampActions ?? []) {
    if (action.mode !== "update") continue;
    const liveSchedule = await req.context.models.rampSchedules.getById(
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
    settings: req.organization.settings,
    requireApprovalsLicensed:
      req.context.hasPremiumFeature("require-approvals"),
    liveRampScheduleEnvs,
  });

  // Bypass via restApiBypassesReviews (API keys/PATs only — JWT-backed REST
  // calls should behave like dashboard actions) or bypassApprovalChecks.
  const canBypass =
    canUseRestApiBypass ||
    req.context.permissions.canBypassApprovalChecks(feature);

  if (requiresReview && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this project.",
    );
  }

  const envsToCheck = await getMergeResultPublishEnvs({
    context: req.context,
    feature,
    filledLiveRules: filledLive.rules,
    result: mergeResult.result,
    environmentIds,
  });
  if (!req.context.permissions.canPublishFeature(feature, envsToCheck)) {
    req.context.permissions.throwPermissionError();
  }

  const updatedFeature = await publishRevision({
    context: req.context,
    feature,
    revision,
    result: mergeResult.result,
    comment: req.body.comment ?? "",
    // bypassLockdown intentionally mirrors canBypassApprovalChecks. The policy
    // choice: anyone who can skip the revision-review queue (admins and API keys
    // with restApiBypassesReviews) can also override a ramp lockdown. Lockdown is
    // a safety gate against accidental live-traffic changes, not a security
    // boundary — the same elevated trust that lets you skip review also lets you
    // push through a lockdown. If you need a stricter separation in the future,
    // introduce a dedicated canBypassRampLockdown() permission method here.
    bypassLockdown: canBypass,
  });

  if (
    mergeResult.result.metadata?.tags !== undefined &&
    Array.isArray(mergeResult.result.metadata.tags)
  ) {
    await addTagsDiff(
      req.organization.id,
      feature.tags || [],
      mergeResult.result.metadata.tags,
    );
  }

  await req.audit({
    event: "feature.publish",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: revision.version,
      comment: req.body.comment ?? "",
    }),
  });

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
  });
  const finalRevision = updated ?? revision;

  await dispatchFeatureRevisionEvent(
    req.context,
    updatedFeature,
    finalRevision,
    "revision.published",
    {},
  );

  return { feature, revision: finalRevision };
}

export const postFeatureRevisionPublish = createApiRequestHandler(
  postFeatureRevisionPublishValidator,
)(async (req) => {
  const { feature, revision } = await publishFeatureRevision(
    req,
    canUseRestApiBypassSetting(req),
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
