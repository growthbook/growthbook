import {
  postFeatureRevisionPublishValidator,
  postFeatureRevisionPublishV2Validator,
} from "shared/validators";
import {
  autoMerge,
  checkIfRevisionNeedsReview,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  getRulesForEnvironment,
  liveRevisionFromFeature,
} from "shared/util";
import { isEqual } from "lodash";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  getLiveAndBaseRevisionsForFeature,
  toApiRevision,
  toApiRevisionV2,
} from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
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

  // Bypass via restApiBypassesReviews or bypassApprovalChecks.
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

  // Publish-permission scope: env-scoped for env-only changes (rules and/or
  // toggles); all enabled envs otherwise (other fields aren't env-scoped).
  const allEnabledEnvs = Array.from(
    getEnabledEnvironments(feature, environmentIds),
  );
  // `mergeResult.result.rules`, when present, is the full merged flat array.
  // Compute changed envs by diffing the per-env projection against live so
  // callers with env-scoped publish permissions get checked only for envs
  // whose visible rule sequence actually changed.
  const mergedRules = mergeResult.result.rules ?? filledLive.rules;
  const changedRuleEnvs =
    mergeResult.result.rules === undefined
      ? []
      : environmentIds.filter(
          (env) =>
            !isEqual(
              getRulesForEnvironment(filledLive.rules, env),
              getRulesForEnvironment(mergedRules, env),
            ),
        );
  const changedToggleEnvs = Object.keys(
    mergeResult.result.environmentsEnabled || {},
  );
  const changedEnvs = Array.from(
    new Set([...changedRuleEnvs, ...changedToggleEnvs]),
  );
  const isEnvScopedOnlyChange =
    mergeResult.result.defaultValue === undefined &&
    !mergeResult.result.prerequisites &&
    mergeResult.result.archived === undefined &&
    !mergeResult.result.metadata;
  const envsToCheck =
    isEnvScopedOnlyChange && changedEnvs.length > 0
      ? changedEnvs
      : allEnabledEnvs;
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

  return { revision: toApiRevision(finalRevision, req.context, feature) };
});

export const postFeatureRevisionPublishV2 = createApiRequestHandler(
  postFeatureRevisionPublishV2Validator,
)(async (req) => {
  // Identical to v1 — only the response serializer differs.
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

  const filledLive = { ...live, ...liveRevisionFromFeature(live, feature) };
  const effectiveRevision = { ...filledLive, ...mergeResult.result };

  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: filledLive,
    revision: effectiveRevision,
    allEnvironments: environmentIds,
    settings: req.organization.settings,
    requireApprovalsLicensed:
      req.context.hasPremiumFeature("require-approvals"),
  });

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

  const allEnabledEnvs = Array.from(
    getEnabledEnvironments(feature, environmentIds),
  );
  const mergedRules = mergeResult.result.rules ?? filledLive.rules;
  const changedRuleEnvs =
    mergeResult.result.rules === undefined
      ? []
      : environmentIds.filter(
          (env) =>
            !isEqual(
              getRulesForEnvironment(filledLive.rules, env),
              getRulesForEnvironment(mergedRules, env),
            ),
        );
  const changedToggleEnvs = Object.keys(
    mergeResult.result.environmentsEnabled || {},
  );
  const changedEnvs = Array.from(
    new Set([...changedRuleEnvs, ...changedToggleEnvs]),
  );
  const isEnvScopedOnlyChange =
    mergeResult.result.defaultValue === undefined &&
    !mergeResult.result.prerequisites &&
    mergeResult.result.archived === undefined &&
    !mergeResult.result.metadata;
  const envsToCheck =
    isEnvScopedOnlyChange && changedEnvs.length > 0
      ? changedEnvs
      : allEnabledEnvs;
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
    entity: { object: "feature", id: feature.id },
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
  const finalRevision = updated ?? revision;

  await dispatchFeatureRevisionEvent(
    req.context,
    updatedFeature,
    finalRevision,
    "revision.published",
    {},
  );

  return { revision: toApiRevisionV2(finalRevision, req.context, feature) };
});
