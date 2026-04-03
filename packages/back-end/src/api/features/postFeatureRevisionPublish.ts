import {
  autoMerge,
  checkIfRevisionNeedsReview,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
  PermissionError,
} from "shared/util";
import { postFeatureRevisionPublishValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getEnabledEnvironments } from "back-end/src/util/features";

const PUBLISHABLE_STATUSES = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
] as const;

export const postFeatureRevisionPublish = createApiRequestHandler(
  postFeatureRevisionPublishValidator,
)(async (req) => {
  const { id, version } = req.params;
  const { comment, bypassApproval } = req.body;
  const context = req.context;
  const org = context.org;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error(`Feature id '${id}' not found.`);
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const allEnvironments = getEnvironments(org);
  const featureEnvironments = filterEnvironmentsByFeature(
    allEnvironments,
    feature,
  );
  const featureEnvironmentIds = featureEnvironments.map((e) => e.id);

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version,
  });
  if (!revision) {
    throw new Error(`Revision ${version} not found for feature '${id}'.`);
  }

  if (
    !PUBLISHABLE_STATUSES.includes(
      revision.status as (typeof PUBLISHABLE_STATUSES)[number],
    )
  ) {
    throw new Error(
      `Cannot publish a revision in status '${revision.status}'.`,
    );
  }

  const live = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: feature.version,
  });
  if (!live) {
    throw new Error("Could not load live revision");
  }
  const base =
    revision.baseVersion === feature.version
      ? live
      : await getRevision({
          context,
          organization: org.id,
          featureId: feature.id,
          version: revision.baseVersion,
        });
  if (!base) {
    throw new Error("Could not load base revision");
  }

  // Compute merge to detect whether the review check should fire on the merged
  // outcome (mirrors postFeaturePublish in the internal controller).
  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    featureEnvironmentIds,
    {},
  );

  if (!mergeResult.success) {
    throw new Error(
      "Merge conflict detected. Resolve conflicts by creating a new draft from the latest live revision.",
    );
  }

  const filledLive = {
    ...live,
    ...liveRevisionFromFeature(live, feature),
  };
  const effectiveRevision = {
    ...filledLive,
    ...mergeResult.result,
    rules: {
      ...filledLive.rules,
      ...(mergeResult.result.rules ?? {}),
    },
  };
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: filledLive,
    revision: effectiveRevision,
    allEnvironments: featureEnvironmentIds,
    settings: org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });

  // Resolve bypass: explicit bypassApproval=true requires the bypass permission;
  // org-level restApiBypassesReviews continues to work as a global escape hatch.
  const orgBypass = !!org.settings?.restApiBypassesReviews;
  let canBypass = orgBypass;
  if (bypassApproval) {
    if (!context.permissions.canBypassApprovalChecks(feature)) {
      throw new PermissionError(
        "API key does not have the 'bypassApprovalChecks' permission required to set bypassApproval=true.",
      );
    }
    canBypass = true;
  }

  if (requiresReview && revision.status !== "approved" && !canBypass) {
    throw new PermissionError(
      "This revision requires approval before it can be published. " +
        "Either submit it for review and have it approved, or set bypassApproval=true (requires the bypassApprovalChecks permission).",
    );
  }

  // Permission checks for the actual publish — same as the internal flow.
  if (mergeResult.result.defaultValue !== undefined) {
    if (
      !context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, featureEnvironmentIds)),
      )
    ) {
      context.permissions.throwPermissionError();
    }
  } else {
    const changedEnvs = Object.keys(mergeResult.result.rules || {});
    if (changedEnvs.length > 0) {
      if (!context.permissions.canPublishFeature(feature, changedEnvs)) {
        context.permissions.throwPermissionError();
      }
    }
  }

  const updatedFeature = await publishRevision(
    context,
    feature,
    revision,
    mergeResult.result,
    comment,
  );

  await req.audit({
    event: "feature.publish",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: revision.version,
      comment,
    }),
  });

  const groupMap = await getSavedGroupMap(context);
  const experimentMap = await getExperimentMapForFeature(context, feature.id);
  const latestRevision = await getRevision({
    context,
    organization: updatedFeature.organization,
    featureId: updatedFeature.id,
    version: updatedFeature.version,
  });
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();

  return {
    feature: getApiFeatureObj({
      feature: updatedFeature,
      organization: req.organization,
      groupMap,
      experimentMap,
      revision: latestRevision,
      safeRolloutMap,
    }),
  };
});
