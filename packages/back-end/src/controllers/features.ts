import { Request, Response } from "express";
import { evaluateFeatures } from "@growthbook/proxy-eval";
import { isEqual } from "lodash";
import {
  autoMerge,
  filterEnvironmentsByFeature,
  filterProjectsByEnvironmentWithNull,
  MergeResultChanges,
  MergeStrategy,
  checkIfRevisionNeedsReview,
  resetReviewOnChange,
} from "shared/util";
import {
  getConnectionSDKCapabilities,
  SDKCapability,
} from "shared/sdk-versioning";
import {
  ExperimentRefRule,
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  FeatureTestResult,
  JSONSchemaDef,
} from "../../types/feature";
import { AuthRequest } from "../types/AuthRequest";
import {
  getContextForAgendaJobByOrgId,
  getContextFromReq,
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "../services/organizations";
import {
  addFeatureRule,
  addLinkedExperiment,
  applyRevisionChanges,
  archiveFeature,
  createFeature,
  deleteFeature,
  editFeatureRule,
  getAllFeaturesWithLinkedExperiments,
  getFeature,
  hasArchivedFeatures,
  migrateDraft,
  publishRevision,
  setDefaultValue,
  setJsonSchema,
  toggleFeatureEnvironment,
  updateFeature,
} from "../models/FeatureModel";
import { getRealtimeUsageByHour } from "../models/RealtimeModel";
import { lookupOrganizationByApiKey } from "../models/ApiKeyModel";
import {
  addIdsToRules,
  arrayMove,
  evaluateFeature,
  generateRuleId,
  getFeatureDefinitions,
  getSavedGroupMap,
} from "../services/features";
import { FeatureUsageRecords } from "../../types/realtime";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../services/audit";
import {
  cleanUpPreviousRevisions,
  createInitialRevision,
  createRevision,
  discardRevision,
  getRevision,
  getRevisions,
  getRevisionsByStatus,
  hasDraft,
  markRevisionAsPublished,
  markRevisionAsReviewRequested,
  ReviewSubmittedType,
  submitReviewAndComments,
  updateRevision,
} from "../models/FeatureRevisionModel";
import { getEnabledEnvironments } from "../util/features";
import {
  findSDKConnectionByKey,
  markSDKConnectionUsed,
} from "../models/SdkConnectionModel";
import { logger } from "../util/logger";
import { addTagsDiff } from "../models/TagModel";
import {
  EventUserForResponseLocals,
  EventUserLoggedIn,
} from "../events/event-types";
import {
  CACHE_CONTROL_MAX_AGE,
  CACHE_CONTROL_STALE_IF_ERROR,
  CACHE_CONTROL_STALE_WHILE_REVALIDATE,
  FASTLY_SERVICE_ID,
} from "../util/secrets";
import { upsertWatch } from "../models/WatchModel";
import { getSurrogateKeysFromEnvironments } from "../util/cdn.util";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import {
  addLinkedFeatureToExperiment,
  getAllPayloadExperiments,
  getExperimentById,
  getExperimentsByIds,
  getExperimentsByTrackingKeys,
} from "../models/ExperimentModel";
import { ReqContext } from "../../types/organization";
import { ExperimentInterface } from "../../types/experiment";
import { ApiReqContext } from "../../types/api";
import { getAllCodeRefsForFeature } from "../models/FeatureCodeRefs";

class UnrecoverableApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableApiError";
  }
}

export async function getPayloadParamsFromApiKey(
  key: string,
  req: Request
): Promise<{
  organization: string;
  capabilities: SDKCapability[];
  projects: string[];
  environment: string;
  encrypted: boolean;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
  hashSecureAttributes?: boolean;
  remoteEvalEnabled?: boolean;
  savedGroupReferencesEnabled?: boolean;
}> {
  // SDK Connection key
  if (key.match(/^sdk-/)) {
    const connection = await findSDKConnectionByKey(key);
    if (!connection) {
      throw new UnrecoverableApiError("Invalid API Key");
    }

    // If this is the first time the SDK Connection is being used, mark it as successfully connected
    if (!connection.connected) {
      // This is async, but we don't care about the response
      markSDKConnectionUsed(key).catch(() => {
        // Errors are not fatal, ignore them
        logger.warn("Failed to mark SDK Connection as used - " + key);
      });
    }

    return {
      organization: connection.organization,
      capabilities: getConnectionSDKCapabilities(connection),
      environment: connection.environment,
      projects: connection.projects,
      encrypted: connection.encryptPayload,
      encryptionKey: connection.encryptionKey,
      includeVisualExperiments: connection.includeVisualExperiments,
      includeDraftExperiments: connection.includeDraftExperiments,
      includeExperimentNames: connection.includeExperimentNames,
      includeRedirectExperiments: connection.includeRedirectExperiments,
      hashSecureAttributes: connection.hashSecureAttributes,
      remoteEvalEnabled: connection.remoteEvalEnabled,
      savedGroupReferencesEnabled: connection.savedGroupReferencesEnabled,
    };
  }
  // Old, legacy API Key
  else {
    let projectFilter = "";
    if (typeof req.query?.project === "string") {
      projectFilter = req.query.project;
    }

    const {
      organization,
      secret,
      environment,
      project,
      encryptSDK,
      encryptionKey,
    } = await lookupOrganizationByApiKey(key);
    if (!organization) {
      throw new UnrecoverableApiError("Invalid API Key");
    }
    if (secret) {
      throw new UnrecoverableApiError(
        "Must use a Publishable API key to get feature definitions"
      );
    }

    if (project && !projectFilter) {
      projectFilter = project;
    }

    return {
      organization,
      capabilities: ["bucketingV2"],
      environment: environment || "production",
      projects: projectFilter ? [projectFilter] : [],
      encrypted: !!encryptSDK,
      encryptionKey,
    };
  }
}

export async function getFeaturesPublic(req: Request, res: Response) {
  try {
    const { key } = req.params;

    if (!key) {
      throw new UnrecoverableApiError("Missing API key in request");
    }

    const {
      organization,
      capabilities,
      environment,
      encrypted,
      projects,
      encryptionKey,
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      includeRedirectExperiments,
      hashSecureAttributes,
      remoteEvalEnabled,
      savedGroupReferencesEnabled,
    } = await getPayloadParamsFromApiKey(key, req);

    const context = await getContextForAgendaJobByOrgId(organization);

    if (remoteEvalEnabled) {
      throw new UnrecoverableApiError(
        "Remote evaluation required for this connection"
      );
    }

    const environmentDoc = context.org?.settings?.environments?.find(
      (e) => e.id === environment
    );
    const filteredProjects = filterProjectsByEnvironmentWithNull(
      projects,
      environmentDoc,
      true
    );

    const defs = await getFeatureDefinitions({
      context,
      capabilities,
      environment,
      projects: filteredProjects,
      encryptionKey: encrypted ? encryptionKey : "",
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      includeRedirectExperiments,
      hashSecureAttributes,
      savedGroupReferencesEnabled:
        savedGroupReferencesEnabled &&
        capabilities.includes("savedGroupReferences"),
    });

    // The default is Cache for 30 seconds, serve stale up to 1 hour (10 hours if origin is down)
    res.set(
      "Cache-control",
      `public, max-age=${CACHE_CONTROL_MAX_AGE}, stale-while-revalidate=${CACHE_CONTROL_STALE_WHILE_REVALIDATE}, stale-if-error=${CACHE_CONTROL_STALE_IF_ERROR}`
    );

    // If using Fastly, add surrogate key header for cache purging
    if (FASTLY_SERVICE_ID) {
      // Purge by org, API Key, or payload contents
      const surrogateKeys = [
        organization,
        key,
        ...getSurrogateKeysFromEnvironments(organization, [environment]),
      ];
      res.set("Surrogate-Key", surrogateKeys.join(" "));
    }

    res.status(200).json({
      status: 200,
      ...defs,
    });
  } catch (e) {
    // We don't want to expose internal errors like Mongo Connections to users, so default to a generic message
    let error = "Failed to get features";

    // These errors are unrecoverable and can thus be cached by a CDN despite a 400 response code
    // Set this header, which our CDN can pick up and apply caching rules for
    // Also, use the more detailed error message since these are explicitly set by us
    if (e instanceof UnrecoverableApiError) {
      res.set("x-unrecoverable", "1");
      error = e.message;
    }

    return res.status(400).json({
      status: 400,
      error,
    });
  }
}

export async function getEvaluatedFeaturesPublic(req: Request, res: Response) {
  try {
    const { key } = req.params;

    if (!key) {
      throw new UnrecoverableApiError("Missing API key in request");
    }

    const {
      organization,
      capabilities,
      environment,
      encrypted,
      projects,
      encryptionKey,
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      includeRedirectExperiments,
      hashSecureAttributes,
      remoteEvalEnabled,
    } = await getPayloadParamsFromApiKey(key, req);

    const context = await getContextForAgendaJobByOrgId(organization);

    if (!remoteEvalEnabled) {
      throw new UnrecoverableApiError(
        "Remote evaluation disabled for this connection"
      );
    }

    const environmentDoc = context.org?.settings?.environments?.find(
      (e) => e.id === environment
    );
    const filteredProjects = filterProjectsByEnvironmentWithNull(
      projects,
      environmentDoc,
      true
    );

    // Evaluate features using provided attributes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attributes: Record<string, any> = req.body?.attributes || {};
    const forcedVariations: Record<string, number> =
      req.body?.forcedVariations || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forcedFeatures: Map<string, any> = new Map(
      req.body.forcedFeatures || []
    );
    const url = req.body?.url;

    const defs = await getFeatureDefinitions({
      context,
      capabilities,
      environment,
      projects: filteredProjects,
      encryptionKey: encrypted ? encryptionKey : "",
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      includeRedirectExperiments,
      hashSecureAttributes,
    });

    // This endpoint should never be cached
    res.set("Cache-control", "no-store");

    // todo: don't use link. investigate why clicking through returns the stub only.
    const payload = evaluateFeatures({
      payload: defs,
      attributes,
      forcedVariations,
      forcedFeatures,
      url,
    });

    res.status(200).json(payload);
  } catch (e) {
    // We don't want to expose internal errors like Mongo Connections to users, so default to a generic message
    const error = "Failed to get evaluated features";

    return res.status(400).json({
      status: 400,
      error,
    });
  }
}

export async function postFeatures(
  req: AuthRequest<Partial<FeatureInterface>>,
  res: Response<
    { status: 200; feature: FeatureInterface },
    EventUserForResponseLocals
  >
) {
  const context = getContextFromReq(req);
  const { org, userId, userName } = context;
  const { id, environmentSettings, ...otherProps } = req.body;

  if (
    !context.permissions.canCreateFeature(req.body) ||
    !context.permissions.canManageFeatureDrafts({ project: otherProps.project })
  ) {
    context.permissions.throwPermissionError();
  }

  if (!id) {
    throw new Error("Must specify feature key");
  }

  if (org.settings?.featureRegexValidator) {
    const regex = new RegExp(org.settings.featureRegexValidator);
    if (!regex.test(id)) {
      throw new Error(
        `Feature key must match the regex validator. '${org.settings.featureRegexValidator}' Example: '${org.settings.featureKeyExample}'`
      );
    }
  }

  if (!environmentSettings) {
    throw new Error("Feature missing initial environment toggle settings");
  }

  if (!id.match(/^[a-zA-Z0-9_.:|-]+$/)) {
    throw new Error(
      "Feature keys can only include letters, numbers, hyphens, and underscores."
    );
  }
  const existing = await getFeature(context, id);
  if (existing) {
    throw new Error(
      "This feature key already exists. Feature keys must be unique."
    );
  }

  const feature: FeatureInterface = {
    defaultValue: "",
    valueType: "boolean",
    owner: userName,
    description: "",
    project: "",
    environmentSettings: {},
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id,
    archived: false,
    version: 1,
    hasDrafts: false,
    jsonSchema: {
      schemaType: "schema",
      simple: {
        type: "object",
        fields: [],
      },
      schema: "",
      date: new Date(),
      enabled: false,
    },
  };

  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  // construct environmentSettings, scrub environments if not allowed in project
  feature.environmentSettings = Object.fromEntries(
    Object.entries(environmentSettings).filter(([env]) =>
      environmentIds.includes(env)
    )
  );

  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environmentIds))
    )
  ) {
    context.permissions.throwPermissionError();
  }

  addIdsToRules(feature.environmentSettings, feature.id);

  await createFeature(context, feature);
  await upsertWatch({
    userId,
    organization: org.id,
    item: feature.id,
    type: "features",
  });

  await req.audit({
    event: "feature.create",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsCreate(feature),
  });

  res.status(200).json({
    status: 200,
    feature,
  });
}

export async function postFeatureRebase(
  req: AuthRequest<
    {
      strategies: Record<string, MergeStrategy>;
      mergeResultSerialized: string;
    },
    { id: string; version: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { strategies, mergeResultSerialized } = req.body;
  const { id, version } = req.params;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only fix conflicts for Draft revisions");
  }

  const live = await getRevision(org.id, feature.id, feature.version);
  if (!live) {
    throw new Error("Could not lookup feature history");
  }

  const base =
    revision.baseVersion === live.version
      ? live
      : await getRevision(org.id, feature.id, revision.baseVersion);
  if (!base) {
    throw new Error("Could not lookup feature history");
  }

  const mergeResult = autoMerge(
    live,
    base,
    revision,
    environmentIds,
    strategies || {}
  );
  if (JSON.stringify(mergeResult) !== mergeResultSerialized) {
    throw new Error(
      "Something seems to have changed while you were reviewing the draft. Please re-review with the latest changes and submit again."
    );
  }

  if (!mergeResult.success) {
    throw new Error("Please resolve conflicts before saving");
  }

  const newRules: Record<string, FeatureRule[]> = {};
  environmentIds.forEach((env) => {
    newRules[env] = mergeResult.result.rules?.[env] || live.rules[env] || [];
  });
  await updateRevision(
    revision,
    {
      baseVersion: live.version,
      defaultValue: mergeResult.result.defaultValue ?? live.defaultValue,
      rules: newRules,
    },
    {
      user: res.locals.eventAudit,
      action: "rebase",
      subject: `on top of revision #${live.version}`,
      value: JSON.stringify(mergeResult.result),
    },
    false
  );

  res.status(200).json({
    status: 200,
  });
}
export async function postFeatureRequestReview(
  req: AuthRequest<
    {
      comment: string;
    },
    { id: string; version: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const { comment } = req.body;
  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }
  if (!context.permissions.canManageFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision(
    context.org.id,
    feature.id,
    parseInt(version)
  );
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only request review if is a draft");
  }
  await markRevisionAsReviewRequested(revision, res.locals.eventAudit, comment);
  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureReviewOrComment(
  req: AuthRequest<
    {
      comment: string;
      review?: ReviewSubmittedType;
    },
    { id: string; version: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const { comment, review = "Comment" } = req.body;
  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canReviewFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision(
    context.org.id,
    feature.id,
    parseInt(version)
  );
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  const createdByUser = revision.createdBy as EventUserLoggedIn;

  if (createdByUser?.id === context.userId && review !== "Comment") {
    throw Error("cannot submit a review for your self");
  }
  // dont allow review unless you are adding a comment
  if (
    !(
      revision.status === "changes-requested" ||
      revision.status === "pending-review" ||
      revision.status === "approved"
    ) &&
    review !== "Comment"
  ) {
    throw new Error("Can only review if review is requested");
  }
  await submitReviewAndComments(
    revision,
    res.locals.eventAudit,
    review,
    comment
  );
  res.status(200).json({
    status: 200,
  });
}

export async function postFeaturePublish(
  req: AuthRequest<
    {
      comment: string;
      mergeResultSerialized: string;
      adminOverride?: boolean;
    },
    { id: string; version: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { comment, mergeResultSerialized, adminOverride } = req.body;
  const { id, version } = req.params;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  const reviewStatuses = [
    "pending-review",
    "changes-requested",
    "draft",
    "approved",
  ];
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  const live = await getRevision(org.id, feature.id, feature.version);
  if (!live) {
    throw new Error("Could not lookup feature history");
  }

  const base =
    revision.baseVersion === live.version
      ? live
      : await getRevision(org.id, feature.id, revision.baseVersion);
  if (!base) {
    throw new Error("Could not lookup feature history");
  }
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: base,
    revision,
    allEnvironments: environmentIds,
    settings: org.settings,
  });
  if (!adminOverride && requiresReview && revision.status !== "approved") {
    throw new Error("needs review before publishing");
  }
  if (requiresReview && !reviewStatuses.includes(revision.status)) {
    throw new Error("Can only publish Draft revisions");
  }

  if (adminOverride && requiresReview) {
    if (!context.permissions.canBypassApprovalChecks(feature)) {
      context.permissions.throwPermissionError();
    }
  }
  const mergeResult = autoMerge(live, base, revision, environmentIds, {});
  if (JSON.stringify(mergeResult) !== mergeResultSerialized) {
    throw new Error(
      "Something seems to have changed while you were reviewing the draft. Please re-review with the latest changes and submit again."
    );
  }

  if (!mergeResult.success) {
    throw new Error("Please resolve conflicts before publishing");
  }

  // If changing the default value, it affects all enabled environments
  if (mergeResult.result.defaultValue !== undefined) {
    if (
      !context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environmentIds))
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }
  // Otherwise, only the environments with rule changes are affected
  else {
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
    comment
  );

  await req.audit({
    event: "feature.publish",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: revision.version,
      comment,
    }),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureRevert(
  req: AuthRequest<{ comment: string }, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { comment } = req.body;

  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (revision.version === feature.version || revision.status !== "published") {
    throw new Error("Can only revert to previously published revisions");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const changes: MergeResultChanges = {};

  if (revision.defaultValue !== feature.defaultValue) {
    if (
      !context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environmentIds))
      )
    ) {
      context.permissions.throwPermissionError();
    }
    changes.defaultValue = revision.defaultValue;
  }

  const changedEnvs: string[] = [];
  environmentIds.forEach((env) => {
    if (
      revision.rules[env] &&
      !isEqual(
        revision.rules[env],
        feature.environmentSettings?.[env]?.rules || []
      )
    ) {
      changedEnvs.push(env);
      changes.rules = changes.rules || {};
      changes.rules[env] = revision.rules[env];
    }
  });
  if (changedEnvs.length > 0) {
    if (!context.permissions.canPublishFeature(feature, changedEnvs)) {
      context.permissions.throwPermissionError();
    }
  }

  const updatedFeature = await applyRevisionChanges(
    context,
    feature,
    revision,
    changes
  );

  await markRevisionAsPublished(revision, res.locals.eventAudit, comment);

  await req.audit({
    event: "feature.revert",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: revision.version,
    }),
  });

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureFork(
  req: AuthRequest<never, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org, environments } = context;
  const { id, version } = req.params;

  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const newRevision = await createRevision({
    feature,
    user: res.locals.eventAudit,
    baseVersion: revision.version,
    changes: revision,
    environments,
    org,
  });
  await updateFeature(context, feature, {
    hasDrafts: true,
  });

  res.status(200).json({
    status: 200,
    version: newRevision.version,
  });
}

export async function postFeatureDiscard(
  req: AuthRequest<never, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;

  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error(`Can not discard ${revision.status} revisions`);
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  await discardRevision(revision, res.locals.eventAudit);

  const hasDrafts = await hasDraft(org.id, feature, [revision.version]);

  if (!hasDrafts) {
    await updateFeature(context, feature, {
      hasDrafts,
    });
  }

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureRule(
  req: AuthRequest<
    { rule: FeatureRule; environment: string },
    { id: string; version: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { environment, rule } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  if (!environmentIds.includes(environment)) {
    throw new Error("Invalid environment");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: [environment],
    defaultValueChanged: false,
    settings: org?.settings,
  });
  await addFeatureRule(
    revision,
    environment,
    rule,
    res.locals.eventAudit,
    resetReview
  );

  // If referencing a new experiment, add it to linkedExperiments
  if (
    rule.type === "experiment-ref" &&
    !feature.linkedExperiments?.includes(rule.experimentId)
  ) {
    await addLinkedFeatureToExperiment(context, rule.experimentId, feature.id);
    await addLinkedExperiment(feature, rule.experimentId);
  }

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureSync(
  req: AuthRequest<
    Omit<
      FeatureInterface,
      "organization" | "version" | "dateCreated" | "dateUpdated"
    >,
    { id: string }
  >,
  res: Response<
    { status: 200; feature: FeatureInterface },
    EventUserForResponseLocals
  >
) {
  const context = getContextFromReq(req);
  const { environments, org } = context;
  const { id } = req.params;

  const feature = await getFeature(context, id);
  // If this is a new feature, create it
  if (!feature) {
    await postFeatures(req, res);
    return;
  }

  if (!environments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags"
    );
  }

  const data = req.body;

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environments))
    )
  ) {
    context.permissions.throwPermissionError();
  }

  if (data.valueType && data.valueType !== feature.valueType) {
    throw new Error(
      "Cannot change valueType of feature after it's already been created."
    );
  }

  const updates: Partial<FeatureInterface> = {
    defaultValue: data.defaultValue ?? feature.defaultValue,
    description: data.description ?? feature.description,
    owner: data.owner ?? feature.owner,
    tags: data.tags ?? feature.tags,
  };
  const changes: Pick<FeatureRevisionInterface, "rules" | "defaultValue"> = {
    rules: {},
    defaultValue: data.defaultValue ?? feature.defaultValue,
  };

  let needsNewRevision = !isEqual(feature.defaultValue, updates.defaultValue);

  environments.forEach((env) => {
    // Revision Changes
    changes.rules[env] =
      data.environmentSettings?.[env]?.rules ??
      feature.environmentSettings?.[env]?.rules ??
      [];

    // Feature updates
    updates.environmentSettings = updates.environmentSettings || {};
    updates.environmentSettings[env] = updates.environmentSettings[env] || {
      enabled: feature.environmentSettings?.[env]?.enabled ?? false,
      rules: changes.rules[env],
    };

    if (
      data.environmentSettings?.[env] &&
      !isEqual(
        data.environmentSettings[env].rules || [],
        feature.environmentSettings?.[env]?.rules || []
      )
    ) {
      needsNewRevision = true;
    }
  });

  if (needsNewRevision) {
    const revision = await createRevision({
      feature,
      user: res.locals.eventAudit,
      baseVersion: feature.version,
      publish: true,
      changes,
      environments,
      comment: `Sync Feature`,
      org,
    });

    updates.version = revision.version;
  }

  const updatedFeature = await updateFeature(context, feature, updates);

  await req.audit({
    event: "feature.update",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: updatedFeature.version,
    }),
  });

  res.status(200).json({
    status: 200,
    feature: updatedFeature,
  });
}

export async function postFeatureExperimentRefRule(
  req: AuthRequest<{ rule: ExperimentRefRule }, { id: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { environments, org } = context;
  const { id } = req.params;
  const { rule } = req.body;

  if (
    rule.type !== "experiment-ref" ||
    !rule.experimentId ||
    !rule.variations ||
    !rule.variations.length
  ) {
    throw new Error("Invalid experiment rule");
  }

  if (!environments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags"
    );
  }

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environments))
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const experiment = await getExperimentById(context, rule.experimentId);
  if (!experiment) {
    throw new Error("Invalid experiment selected");
  }

  const updates: Partial<FeatureInterface> = {
    environmentSettings: feature.environmentSettings,
  };
  const changes: Pick<FeatureRevisionInterface, "rules"> = {
    rules: {},
  };
  environments.forEach((env) => {
    const envRule = {
      ...rule,
      id: generateRuleId(),
    };

    // Revision changes
    changes.rules[env] = [...(feature.environmentSettings?.[env]?.rules || [])];
    if (env == "production") {
      changes.rules[env].unshift(envRule);
    }

    // Feature updates
    updates.environmentSettings = updates.environmentSettings || {};
    updates.environmentSettings[env] = updates.environmentSettings[env] || {
      enabled: false,
      rules: [],
    };
    updates.environmentSettings[env].rules =
      updates.environmentSettings[env].rules || [];
    if (env == "production") {
      updates.environmentSettings[env].rules.unshift(envRule);
    }
  });

  const revision = await createRevision({
    feature,
    user: res.locals.eventAudit,
    baseVersion: feature.version,
    publish: true,
    changes,
    environments,
    comment: `Add Experiment - ${experiment.name}`,
    org,
  });

  const linkedExperiments = feature.linkedExperiments || [];
  if (!feature.linkedExperiments?.includes(experiment.id)) {
    linkedExperiments.push(experiment.id);
    updates.linkedExperiments = linkedExperiments;
  }

  if (revision.status === "published") {
    updates.version = revision.version;
    const updatedFeature = await updateFeature(context, feature, updates);

    await req.audit({
      event: "feature.update",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updatedFeature, {
        revision: revision.version,
      }),
    });
  } else {
    await updateFeature(context, feature, {
      linkedExperiments,
      hasDrafts: true,
    });
  }

  await addLinkedFeatureToExperiment(
    context,
    rule.experimentId,
    feature.id,
    experiment
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

async function getDraftRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  version: number
): Promise<FeatureRevisionInterface> {
  // This is the published version, create a new draft revision
  const { org } = context;
  if (version === feature.version) {
    const newRevision = await createRevision({
      feature,
      user: context.auditUser,
      environments: getEnvironmentIdsFromOrg(context.org),
      baseVersion: version,
      org,
    });

    await updateFeature(context, feature, {
      hasDrafts: true,
    });

    return newRevision;
  }

  // If this is already a draft, return it
  const revision = await getRevision(feature.organization, feature.id, version);
  if (!revision) {
    throw new Error("Cannot find revision");
  }
  if (
    !(
      revision.status === "draft" ||
      revision.status === "pending-review" ||
      revision.status === "changes-requested" ||
      revision.status === "approved"
    )
  ) {
    throw new Error("Can only make changes to draft revisions");
  }

  return revision;
}

export async function putRevisionComment(
  req: AuthRequest<{ comment: string }, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { comment } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  await updateRevision(
    revision,
    {},
    {
      user: res.locals.eventAudit,
      action: "edit comment",
      subject: "",
      value: JSON.stringify({ comment }),
    },
    false
  );

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureDefaultValue(
  req: AuthRequest<{ defaultValue: string }, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { environments, org } = context;
  const { id, version } = req.params;
  const { defaultValue } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: environments,
    defaultValueChanged: true,
    settings: org?.settings,
  });
  await setDefaultValue(
    revision,
    defaultValue,
    res.locals.eventAudit,
    resetReview
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureSchema(
  req: AuthRequest<Omit<JSONSchemaDef, "date">, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const schemaDef = req.body;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const updatedFeature = await setJsonSchema(context, feature, schemaDef);

  await req.audit({
    event: "feature.update",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function putFeatureRule(
  req: AuthRequest<
    { rule: Partial<FeatureRule>; environment: string; i: number },
    { id: string; version: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { environment, rule, i } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  if (!environmentIds.includes(environment)) {
    throw new Error("Invalid environment");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: [environment],
    defaultValueChanged: false,
    settings: org?.settings,
  });
  await editFeatureRule(
    revision,
    environment,
    i,
    rule,
    res.locals.eventAudit,
    resetReview
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureToggle(
  req: AuthRequest<{ environment: string; state: boolean }, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { environments } = context;
  const { id } = req.params;
  const { environment, state } = req.body;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canPublishFeature(feature, [environment])
  ) {
    context.permissions.throwPermissionError();
  }

  const currentState =
    feature.environmentSettings?.[environment]?.enabled || false;

  // If we're already in the desired state, no need to update
  // This can be caused by race conditions (e.g. two people with the feature open, both toggling at the same time)
  if (currentState === state) {
    return res.status(200).json({
      status: 200,
    });
  }

  await toggleFeatureEnvironment(context, feature, environment, state);

  await req.audit({
    event: "feature.toggle",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(
      { on: currentState },
      { on: state },
      { environment }
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureMoveRule(
  req: AuthRequest<
    { environment: string; from: number; to: number },
    { id: string; version: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { environments, org } = context;
  const { id, version } = req.params;
  const { environment, from, to } = req.body;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }
  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));

  const changes = { rules: revision.rules || {} };
  const rules = changes.rules[environment];
  if (!rules || !rules[from] || !rules[to]) {
    throw new Error("Invalid rule index");
  }
  const rule = rules[from];
  changes.rules[environment] = arrayMove(rules, from, to);
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: [environment],
    defaultValueChanged: false,
    settings: org?.settings,
  });
  await updateRevision(
    revision,
    changes,
    {
      user: res.locals.eventAudit,
      action: "move rule",
      subject: `in ${environment} from position ${from + 1} to ${to + 1}`,
      value: JSON.stringify(rule),
    },
    resetReview
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}
export async function getDraftandReviewRevisions(
  req: AuthRequest,
  res: Response
) {
  const context = getContextFromReq(req);
  const revisions = await getRevisionsByStatus(context, [
    "draft",
    "approved",
    "changes-requested",
    "pending-review",
  ]);
  res.status(200).json({
    status: 200,
    revisions,
  });
}

export async function deleteFeatureRule(
  req: AuthRequest<
    { environment: string; i: number },
    { id: string; version: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { environments, org } = context;
  const { id, version } = req.params;
  const { environment, i } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }
  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));

  const changes = { rules: revision.rules || {} };
  const rules = changes.rules[environment];
  if (!rules || !rules[i]) {
    throw new Error("Invalid rule index");
  }

  const rule = rules[i];

  changes.rules[environment] = rules.slice();
  changes.rules[environment].splice(i, 1);
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: [environment],
    defaultValueChanged: false,
    settings: org?.settings,
  });
  await updateRevision(
    revision,
    changes,
    {
      user: res.locals.eventAudit,
      action: "delete rule",
      subject: `in ${environment} (position ${i + 1})`,
      value: JSON.stringify(rule),
    },
    resetReview
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function putFeature(
  req: AuthRequest<Partial<FeatureInterface>, { id: string }>,
  res: Response<
    { status: 200; feature: FeatureInterface },
    EventUserForResponseLocals
  >
) {
  const context = getContextFromReq(req);
  const { org, environments } = context;
  const { id } = req.params;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const updates = req.body;
  if (!context.permissions.canUpdateFeature(feature, updates)) {
    context.permissions.throwPermissionError();
  }

  // Changing the project can affect whether or not it's published if using project-scoped api keys
  if ("project" in updates) {
    // Make sure they have access in both the old and new environments
    if (
      !context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environments))
      ) ||
      !context.permissions.canPublishFeature(
        updates,
        Array.from(getEnabledEnvironments(feature, environments))
      )
    ) {
      context.permissions.throwPermissionError();
    }
  }

  const allowedKeys: (keyof FeatureInterface)[] = [
    "tags",
    "description",
    "project",
    "owner",
  ];

  if (
    Object.keys(updates).filter(
      (key: keyof FeatureInterface) => !allowedKeys.includes(key)
    ).length > 0
  ) {
    throw new Error("Invalid update fields for feature");
  }

  const updatedFeature = await updateFeature(context, feature, updates);

  // If there are new tags to add
  await addTagsDiff(org.id, feature.tags || [], updates.tags || []);

  await req.audit({
    event: "feature.update",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature),
  });

  res.status(200).json({
    feature: updatedFeature,
    status: 200,
  });
}

export async function deleteFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const feature = await getFeature(context, id);

  if (feature) {
    const allEnvironments = getEnvironments(context.org);
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const environmentsIds = environments.map((e) => e.id);

    if (
      !context.permissions.canDeleteFeature(feature) ||
      !context.permissions.canManageFeatureDrafts(feature) ||
      !context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environmentsIds))
      )
    ) {
      context.permissions.throwPermissionError();
    }
    await deleteFeature(context, feature);
    await req.audit({
      event: "feature.delete",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsDelete(feature),
    });
  }

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureEvaluate(
  req: AuthRequest<
    {
      attributes: Record<string, boolean | string | number | object>;
      scrubPrerequisites?: boolean;
      skipRulesWithPrerequisites?: boolean;
    },
    { id: string; version: string }
  >,
  res: Response<
    { status: 200; results: FeatureTestResult[] },
    EventUserForResponseLocals
  >
) {
  const { id, version } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;
  const {
    attributes,
    scrubPrerequisites,
    skipRulesWithPrerequisites,
  } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  const groupMap = await getSavedGroupMap(org);
  const experimentMap = await getAllPayloadExperiments(context);
  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const results = evaluateFeature({
    feature,
    revision,
    attributes,
    groupMap,
    experimentMap,
    environments,
    scrubPrerequisites,
    skipRulesWithPrerequisites,
  });

  res.status(200).json({
    status: 200,
    results: results,
  });
}

export async function postFeatureArchive(
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentsIds = environments.map((e) => e.id);

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environmentsIds))
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const updatedFeature = await archiveFeature(
    context,
    feature,
    !feature.archived
  );

  await req.audit({
    event: "feature.archive",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(
      { archived: feature.archived }, // Old state
      { archived: updatedFeature.archived } // New state
    ),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function getFeatures(
  req: AuthRequest<
    unknown,
    unknown,
    { project?: string; includeArchived?: boolean }
  >,
  res: Response
) {
  const context = getContextFromReq(req);

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }
  const includeArchived = !!req.query.includeArchived;

  const { features, experiments } = await getAllFeaturesWithLinkedExperiments(
    context,
    {
      project,
      includeArchived,
    }
  );

  const hasArchived = includeArchived
    ? features.some((f) => f.archived)
    : await hasArchivedFeatures(context, project);

  res.status(200).json({
    status: 200,
    features,
    linkedExperiments: experiments,
    hasArchived,
  });
}

export async function getRevisionLog(
  req: AuthRequest<null, { id: string; version: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(
    context.org.id,
    feature.id,
    parseInt(version)
  );
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  res.json({
    status: 200,
    log: revision.log || [],
  });
}

export async function getFeatureById(
  req: AuthRequest<null, { id: string }, { v?: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org, environments } = context;
  const { id } = req.params;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  let revisions = await getRevisions(org.id, id);

  // The above only fetches the most recent revisions
  // If we're requesting a specific version that's older than that, fetch it directly
  if (req.query.v) {
    const version = parseInt(req.query.v);
    if (!revisions.some((r) => r.version === version)) {
      const revision = await getRevision(org.id, id, version);
      if (revision) {
        revisions.push(revision);
      }
    }
  }

  // Make sure we always select the live version, even if it's not one of the most recent revisions
  if (!revisions.some((r) => r.version === feature.version)) {
    const revision = await getRevision(org.id, id, feature.version);
    if (revision) {
      revisions.push(revision);
    }
  }

  // Historically, we haven't properly cleared revision history when deleting a feature
  // So if you create a feature with the same name as a previously deleted one, it would inherit the revision history
  // This can seriously mess up the feature page, so if we detect any old revisions, delete them
  if (revisions.some((r) => r.dateCreated < feature.dateCreated)) {
    await cleanUpPreviousRevisions(org.id, feature.id, feature.dateCreated);
    revisions = revisions.filter((r) => r.dateCreated >= feature.dateCreated);
  }

  // If feature doesn't have any revisions, add revision 1 automatically
  // We haven't always created revisions when creating a feature, so this lets us backfill
  if (!revisions.length) {
    try {
      revisions.push(
        await createInitialRevision(
          feature,
          null,
          environments,
          feature.dateCreated
        )
      );
    } catch (e) {
      // This is not a fatal error, so don't block the request from happening
      req.log.warn("Error creating initial feature revision", { feature: id });
    }
  }

  // Migrate old drafts to revisions
  if (feature.legacyDraft) {
    const draft = await migrateDraft(feature);
    if (draft) {
      revisions.push(draft);
    }
  }

  // Get all linked experiments
  const experimentIds = new Set<string>();
  const trackingKeys = new Set<string>();

  revisions.forEach((revision) => {
    environments.forEach((env) => {
      const rules = revision.rules[env];
      if (!rules) return;
      rules.forEach((rule) => {
        // New rules store the experiment id directly
        if (rule.type === "experiment-ref") {
          experimentIds.add(rule.experimentId);
        }
        // Old rules store the trackingKey
        else if (rule.type === "experiment") {
          trackingKeys.add(rule.trackingKey || feature.id);
        }
      });
    });
  });
  const experimentsMap: Map<string, ExperimentInterface> = new Map();
  if (trackingKeys.size) {
    const exps = await getExperimentsByTrackingKeys(context, [...trackingKeys]);
    exps.forEach((exp) => {
      experimentsMap.set(exp.id, exp);
      experimentIds.delete(exp.id);
    });
  }
  if (experimentIds.size) {
    const exps = await getExperimentsByIds(context, [...experimentIds]);
    exps.forEach((exp) => {
      experimentsMap.set(exp.id, exp);
    });
  }

  // Sanity check to make sure the published revision values and rules match what's stored in the feature
  const live = revisions.find((r) => r.version === feature.version);
  if (live) {
    try {
      if (live.defaultValue !== feature.defaultValue) {
        throw new Error(
          `Published revision defaultValue does not match feature ${org.id}.${feature.id}`
        );
      }
      environments.forEach((env) => {
        const settings = feature.environmentSettings?.[env];
        if (!settings) return;
        if (!isEqual(settings.rules || [], live.rules[env] || [])) {
          throw new Error(
            `Published revision rules.${env} does not match feature ${org.id}.${feature.id}`
          );
        }
      });
    } catch (e) {
      logger.error(e, e.message);
    }
  }

  // find code references
  const codeRefs = await getAllCodeRefsForFeature({
    feature: feature.id,
    organization: org,
  });

  res.status(200).json({
    status: 200,
    feature,
    revisions,
    experiments: [...experimentsMap.values()],
    codeRefs,
  });
}

export async function getRealtimeUsage(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const NUM_MINUTES = 30;

  // Get feature usage for the current hour
  const now = new Date();
  const current = await getRealtimeUsageByHour(
    org.id,
    now.toISOString().substring(0, 13)
  );

  const usage: FeatureUsageRecords = {};
  if (current) {
    Object.keys(current.features).forEach((feature) => {
      usage[feature] = { realtime: [] };
      for (let i = now.getMinutes(); i >= 0; i--) {
        usage[feature].realtime.push({
          used: current.features[feature]?.used?.[i] || 0,
          skipped: current.features[feature]?.skipped?.[i] || 0,
        });
      }
    });
  }

  // If needed, pull in part of the previous hour to get to 30 data points
  if (now.getMinutes() < NUM_MINUTES - 1) {
    const stop = 59 - (NUM_MINUTES - 1 - now.getMinutes());
    const lastHour = new Date(now);
    lastHour.setHours(lastHour.getHours() - 1);

    const lastHourData = await getRealtimeUsageByHour(
      org.id,
      lastHour.toISOString().substring(0, 13)
    );
    if (lastHourData) {
      Object.keys(lastHourData.features).forEach((feature) => {
        if (!usage[feature]) {
          usage[feature] = {
            realtime: Array(now.getMinutes() + 1).fill({
              used: 0,
              skipped: 0,
            }),
          };
        }
        for (let i = 59; i >= stop; i--) {
          usage[feature].realtime.push({
            used: lastHourData.features[feature]?.used?.[i] || 0,
            skipped: lastHourData.features[feature]?.skipped?.[i] || 0,
          });
        }
      });
    }
  }

  // Pad out all usage arrays to 30 items and reverse arrays
  Object.keys(usage).forEach((feature) => {
    while (usage[feature].realtime.length < 30) {
      usage[feature].realtime.push({
        used: 0,
        skipped: 0,
      });
    }
    // Remove any extra items and reverse
    usage[feature].realtime = usage[feature].realtime.slice(0, 30);
    usage[feature].realtime.reverse();
  });

  res.status(200).json({
    status: 200,
    usage,
  });
}

export async function toggleStaleFFDetectionForFeature(
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  await updateFeature(context, feature, {
    neverStale: !feature.neverStale,
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postPrerequisite(
  req: AuthRequest<{ prerequisite: FeaturePrerequisite }, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { prerequisite } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const changes = {
    prerequisites: feature.prerequisites || [],
  };
  changes.prerequisites.push(prerequisite);

  await updateFeature(context, feature, changes);

  res.status(200).json({
    status: 200,
  });
}

export async function putPrerequisite(
  req: AuthRequest<
    { prerequisite: FeaturePrerequisite; i: number },
    { id: string }
  >,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { prerequisite, i } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const changes = {
    prerequisites: feature.prerequisites || [],
  };

  if (!changes.prerequisites[i]) {
    throw new Error("Unknown prerequisite");
  }
  changes.prerequisites[i] = prerequisite;

  await updateFeature(context, feature, changes);

  res.status(200).json({
    status: 200,
  });
}

export async function deletePrerequisite(
  req: AuthRequest<{ i: number }, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { i } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const changes = {
    prerequisites: feature.prerequisites || [],
  };

  if (!changes.prerequisites[i]) {
    throw new Error("Unknown prerequisite");
  }
  changes.prerequisites.splice(i, 1);

  await updateFeature(context, feature, changes);

  res.status(200).json({
    status: 200,
  });
}
