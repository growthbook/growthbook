import omit from "lodash/omit";
import { z } from "zod";
import {
  filterEnvironmentsByFeature,
  MergeResultChanges,
  PermissionError,
  checkIfRevisionNeedsReview,
} from "shared/util";
import { isEqual } from "lodash";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  createAndPublishRevision,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

export const postFeatureRevisionRevert = createApiRequestHandler({
  paramsSchema: z.object({
    id: z.string(),
    version: z.coerce.number().int(),
  }),
  bodySchema: z.object({
    strategy: z.enum(["draft", "publish"]).default("draft"),
    comment: z.string().optional(),
    title: z.string().optional(),
    adminOverride: z.boolean().optional().default(false),
  }),
})(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }

  const targetRevision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: req.params.version,
  });
  if (!targetRevision)
    throw new NotFoundError("Could not find feature revision");

  if (targetRevision.status !== "published") {
    throw new Error(
      "Can only revert to a published revision. " +
        `Revision #${req.params.version} has status "${targetRevision.status}".`,
    );
  }
  if (targetRevision.version === feature.version) {
    throw new Error(
      `Revision #${req.params.version} is already the live version — nothing to revert.`,
    );
  }

  // Build the delta between the target revision and current live state,
  // mirroring the logic in the feature-level revert endpoint.
  const allEnvironments = getEnvironments(req.context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const changes: MergeResultChanges = {};

  if (targetRevision.defaultValue !== feature.defaultValue) {
    if (
      !req.context.permissions.canPublishFeature(
        feature,
        environmentIds.filter(
          (env) => feature.environmentSettings?.[env]?.enabled,
        ),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
    changes.defaultValue = targetRevision.defaultValue;
  }

  changes.rules = {};
  const changedEnvs: string[] = [];
  environmentIds.forEach((env) => {
    const currentRules = feature.environmentSettings?.[env]?.rules || [];
    const targetRules =
      targetRevision.rules && env in targetRevision.rules
        ? targetRevision.rules[env]
        : currentRules;
    changes.rules![env] = targetRules;
    if (!isEqual(targetRules, currentRules)) changedEnvs.push(env);

    if (
      targetRevision.environmentsEnabled &&
      env in targetRevision.environmentsEnabled &&
      targetRevision.environmentsEnabled[env] !==
        feature.environmentSettings?.[env]?.enabled
    ) {
      changes.environmentsEnabled = changes.environmentsEnabled || {};
      changes.environmentsEnabled[env] =
        targetRevision.environmentsEnabled[env];
      if (!changedEnvs.includes(env)) changedEnvs.push(env);
    }
  });

  if (changedEnvs.length > 0) {
    if (!req.context.permissions.canPublishFeature(feature, changedEnvs)) {
      req.context.permissions.throwPermissionError();
    }
  }

  if (
    targetRevision.prerequisites !== undefined &&
    !isEqual(targetRevision.prerequisites, feature.prerequisites || [])
  ) {
    const allEnabledEnvs = environmentIds.filter(
      (env) => feature.environmentSettings?.[env]?.enabled,
    );
    if (!req.context.permissions.canPublishFeature(feature, allEnabledEnvs)) {
      req.context.permissions.throwPermissionError();
    }
    changes.prerequisites = targetRevision.prerequisites;
  }

  if (targetRevision.metadata) {
    const m = targetRevision.metadata;
    const metadataChanges: typeof changes.metadata = {};
    let hasMetaChange = false;
    if (m.description !== undefined && m.description !== feature.description) {
      metadataChanges.description = m.description;
      hasMetaChange = true;
    }
    if (m.owner !== undefined && m.owner !== feature.owner) {
      metadataChanges.owner = m.owner;
      hasMetaChange = true;
    }
    if (m.project !== undefined && m.project !== feature.project) {
      metadataChanges.project = m.project;
      hasMetaChange = true;
    }
    if (m.tags !== undefined && !isEqual(m.tags, feature.tags)) {
      metadataChanges.tags = m.tags;
      hasMetaChange = true;
    }
    if (m.neverStale !== undefined && m.neverStale !== feature.neverStale) {
      metadataChanges.neverStale = m.neverStale;
      hasMetaChange = true;
    }
    if (
      m.customFields !== undefined &&
      !isEqual(m.customFields, feature.customFields)
    ) {
      metadataChanges.customFields = m.customFields;
      hasMetaChange = true;
    }
    if (
      m.jsonSchema !== undefined &&
      !isEqual(m.jsonSchema, feature.jsonSchema)
    ) {
      metadataChanges.jsonSchema = m.jsonSchema;
      hasMetaChange = true;
    }
    if (m.valueType !== undefined && m.valueType !== feature.valueType) {
      metadataChanges.valueType = m.valueType;
      hasMetaChange = true;
    }
    if (hasMetaChange) {
      const allEnabledEnvs = environmentIds.filter(
        (env) => feature.environmentSettings?.[env]?.enabled,
      );
      if (!req.context.permissions.canPublishFeature(feature, allEnabledEnvs)) {
        req.context.permissions.throwPermissionError();
      }
      changes.metadata = metadataChanges;
    }
  }

  const { strategy, comment, title, adminOverride } = req.body;
  const defaultComment = `Revert to revision #${targetRevision.version}`;

  if (strategy === "draft") {
    if (!req.context.permissions.canManageFeatureDrafts(feature)) {
      req.context.permissions.throwPermissionError();
    }

    const newDraft = await createRevision({
      context: req.context,
      feature,
      user: req.context.auditUser,
      baseVersion: feature.version,
      comment: comment ?? defaultComment,
      title: title ?? `Revert to v${targetRevision.version}`,
      environments: getEnvironmentIdsFromOrg(req.context.org),
      publish: false,
      changes,
      org: req.context.org,
      canBypassApprovalChecks: false,
    });

    return { revision: omit(newDraft, "organization") };
  }

  // strategy === "publish"
  const apiBypassesReviews = !!req.context.org.settings?.restApiBypassesReviews;

  const liveRevision = await getRevision({
    context: req.context,
    organization: feature.organization,
    featureId: feature.id,
    version: feature.version,
  });
  if (!liveRevision) throw new Error("Could not load live revision");

  const allEnvironmentIds = getEnvironmentIdsFromOrg(req.organization);
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: liveRevision,
    revision: { ...liveRevision, ...changes } as typeof liveRevision,
    allEnvironments: allEnvironmentIds,
    settings: req.organization.settings,
    requireApprovalsLicensed:
      req.context.hasPremiumFeature("require-approvals"),
  });

  if (requiresReview) {
    if (!adminOverride) {
      throw new PermissionError(
        "This revert requires approval before changes can be published. " +
          "Pass adminOverride: true if your organization allows REST API bypass.",
      );
    }
    if (!apiBypassesReviews) {
      throw new PermissionError(
        "Cannot use adminOverride: your organization has not enabled 'REST API always bypasses approval requirements'.",
      );
    }
    if (!req.context.permissions.canBypassApprovalChecks(feature)) {
      req.context.permissions.throwPermissionError();
    }
  }

  const { revision: publishedRevision } = await createAndPublishRevision({
    context: req.context,
    feature,
    user: req.eventAudit,
    org: req.organization,
    changes,
    comment: comment ?? defaultComment,
    canBypassApprovalChecks: adminOverride && apiBypassesReviews,
  });

  const updated = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    version: publishedRevision.version,
  });

  return { revision: omit(updated ?? publishedRevision, "organization") };
});
