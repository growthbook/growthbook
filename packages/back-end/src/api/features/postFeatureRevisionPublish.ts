import { postFeatureRevisionPublishValidator } from "shared/validators";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
} from "shared/util";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  getLiveAndBaseRevisionsForFeature,
  revisionToApiInterface,
} from "back-end/src/services/features";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "back-end/src/util/errors";

export const postFeatureRevisionPublish = createApiRequestHandler(
  postFeatureRevisionPublishValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
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

  // Run merge first so review requirements are evaluated against the effective
  // post-merge state — mirrors what the controller and frontend do.
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

  // Build effectiveRevision from merged result layered on live (same as controller).
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
    allEnvironments: environmentIds,
    settings: req.organization.settings,
    requireApprovalsLicensed:
      req.context.hasPremiumFeature("require-approvals"),
  });

  // Callers bypass the review gate via either the org-level
  // restApiBypassesReviews setting or a role/token that grants the
  // bypassApprovalChecks permission on this feature's project.
  const canBypass =
    !!req.organization.settings?.restApiBypassesReviews ||
    req.context.permissions.canBypassApprovalChecks(feature);

  if (requiresReview && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this project.",
    );
  }

  // Check publish permission for the environments this revision touches.
  // For pure rules-only changes we can scope the check to just the affected
  // environments. For everything else (defaultValue, prerequisites,
  // environmentsEnabled, archived, metadata) we must check all enabled envs
  // since those changes are not scoped to a specific environment.
  const allEnabledEnvs = Array.from(
    getEnabledEnvironments(feature, environmentIds),
  );
  const changedEnvs = Object.keys(mergeResult.result.rules || {});
  const isRulesOnlyChange =
    mergeResult.result.defaultValue === undefined &&
    !mergeResult.result.prerequisites &&
    mergeResult.result.environmentsEnabled === undefined &&
    mergeResult.result.archived === undefined &&
    !mergeResult.result.metadata;
  const envsToCheck =
    isRulesOnlyChange && changedEnvs.length > 0 ? changedEnvs : allEnabledEnvs;
  if (!req.context.permissions.canPublishFeature(feature, envsToCheck)) {
    req.context.permissions.throwPermissionError();
  }

  const updatedFeature = await publishRevision(
    req.context,
    feature,
    revision,
    mergeResult.result,
    req.body.comment ?? "",
  );

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
    version: req.params.version,
  });

  return { revision: revisionToApiInterface(updated ?? revision) };
});
