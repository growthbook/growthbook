import { Request, Response } from "express";
import { evaluateFeatures } from "@growthbook/proxy-eval";
import { isEqual, omit } from "lodash";
import { v4 as uuidv4 } from "uuid";
import {
  autoMerge,
  filterEnvironmentsByFeature,
  filterProjectsByEnvironmentWithNull,
  MergeResultChanges,
  MergeStrategy,
  checkIfRevisionNeedsReview,
  resetReviewOnChange,
  getAffectedEnvsForExperiment,
} from "shared/util";
import { SAFE_ROLLOUT_TRACKING_KEY_PREFIX } from "shared/constants";
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
  FeatureUsageData,
  FeatureUsageDataPoint,
} from "back-end/types/feature";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextForAgendaJobByOrgId,
  getContextFromReq,
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/services/organizations";
import {
  addFeatureRule,
  addLinkedExperiment,
  applyRevisionChanges,
  archiveFeature,
  copyFeatureEnvironmentRules,
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
} from "back-end/src/models/FeatureModel";
import { getRealtimeUsageByHour } from "back-end/src/models/RealtimeModel";
import { lookupOrganizationByApiKey } from "back-end/src/models/ApiKeyModel";
import {
  addIdsToRules,
  arrayMove,
  evaluateAllFeatures,
  evaluateFeature,
  generateRuleId,
  getFeatureDefinitions,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { FeatureUsageRecords } from "back-end/types/realtime";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import {
  cleanUpPreviousRevisions,
  createInitialRevision,
  createRevision,
  discardRevision,
  getMinimalRevisions,
  getRevision,
  getLatestRevisions,
  getRevisionsByStatus,
  hasDraft,
  markRevisionAsPublished,
  markRevisionAsReviewRequested,
  ReviewSubmittedType,
  submitReviewAndComments,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getEnabledEnvironments } from "back-end/src/util/features";
import {
  findSDKConnectionByKey,
  markSDKConnectionUsed,
} from "back-end/src/models/SdkConnectionModel";
import { logger } from "back-end/src/util/logger";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  EventUserForResponseLocals,
  EventUserLoggedIn,
} from "back-end/src/events/event-types";
import {
  CACHE_CONTROL_MAX_AGE,
  CACHE_CONTROL_STALE_IF_ERROR,
  CACHE_CONTROL_STALE_WHILE_REVALIDATE,
  FASTLY_SERVICE_ID,
} from "back-end/src/util/secrets";
import { upsertWatch } from "back-end/src/models/WatchModel";
import { getSurrogateKeysFromEnvironments } from "back-end/src/util/cdn.util";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "back-end/types/feature-revision";
import {
  addLinkedFeatureToExperiment,
  getAllPayloadExperiments,
  getExperimentById,
  getExperimentsByIds,
  getExperimentsByTrackingKeys,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { ReqContext } from "back-end/types/organization";
import { Changeset, ExperimentInterface } from "back-end/types/experiment";
import { ApiReqContext } from "back-end/types/api";
import { getAllCodeRefsForFeature } from "back-end/src/models/FeatureCodeRefs";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";
import { FeatureUsageLookback } from "back-end/src/types/Integration";
import { getChangesToStartExperiment } from "back-end/src/services/experiments";
import {
  SafeRolloutInterface,
  validateCreateSafeRolloutFields,
} from "back-end/src/validators/safe-rollout";
import {
  PostFeatureRuleBody,
  PutFeatureRuleBody,
} from "back-end/types/feature-rule";
import { getSafeRolloutRuleFromFeature } from "back-end/src/routers/safe-rollout/safe-rollout.helper";
import { SafeRolloutRule } from "back-end/src/validators/features";

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
  includeRuleIds?: boolean;
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
      includeRuleIds: connection.includeRuleIds,
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
      includeRuleIds,
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
      includeRuleIds,
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
      includeRuleIds,
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
      includeRuleIds,
      hashSecureAttributes,
    });

    // This endpoint should never be cached
    res.set("Cache-control", "no-store");

    // todo: don't use link. investigate why clicking through returns the stub only.
    const payload = await evaluateFeatures({
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

  if (org.settings?.requireProjectForFeatures && !otherProps.project) {
    throw new Error("Must specify a project for new features");
  }
  // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
  if (otherProps.project) {
    await context.models.projects.ensureProjectsExist([otherProps.project]);
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

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only fix conflicts for Draft revisions");
  }

  const live = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: feature.version,
  });
  if (!live) {
    throw new Error("Could not lookup feature history");
  }

  const base =
    revision.baseVersion === live.version
      ? live
      : await getRevision({
          context,
          organization: org.id,
          featureId: feature.id,
          version: revision.baseVersion,
        });
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
    context,
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

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only request review if is a draft");
  }
  await markRevisionAsReviewRequested(
    context,
    revision,
    res.locals.eventAudit,
    comment
  );
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

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
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
    context,
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
      publishExperimentIds?: string[];
    },
    { id: string; version: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const {
    comment,
    mergeResultSerialized,
    adminOverride,
    publishExperimentIds,
  } = req.body;
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

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
  const reviewStatuses = [
    "pending-review",
    "changes-requested",
    "draft",
    "approved",
  ];
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  const live = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: feature.version,
  });
  if (!live) {
    throw new Error("Could not lookup feature history");
  }

  const base =
    revision.baseVersion === live.version
      ? live
      : await getRevision({
          context,
          organization: org.id,
          featureId: feature.id,
          version: revision.baseVersion,
        });
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

  // If publishing experiments along with this draft, ensure they are valid
  const experimentsToUpdate: {
    experiment: ExperimentInterface;
    changes: Changeset;
  }[] = [];
  if (publishExperimentIds && publishExperimentIds.length) {
    const experiments = await getExperimentsByIds(
      context,
      publishExperimentIds
    );
    if (experiments.length !== publishExperimentIds.length) {
      throw new Error("Invalid experiment IDs");
    }
    if (experiments.some((exp) => exp.status !== "draft" || exp.archived)) {
      throw new Error("Can only publish draft experiments");
    }
    if (experiments.some((exp) => !exp.linkedFeatures?.includes(feature.id))) {
      throw new Error("All experiments must be linked to this feature");
    }
    if (
      experiments.some((exp) => {
        const envs = getAffectedEnvsForExperiment({
          experiment: exp,
          orgEnvironments: allEnvironments,
        });
        return (
          envs.length > 0 && !context.permissions.canRunExperiment(exp, envs)
        );
      })
    ) {
      context.permissions.throwPermissionError();
    }

    for (const experiment of experiments) {
      try {
        const changes = await getChangesToStartExperiment(context, experiment);

        if (!context.permissions.canUpdateExperiment(experiment, changes)) {
          context.permissions.throwPermissionError();
        }

        experimentsToUpdate.push({ experiment, changes });
      } catch (e) {
        throw new Error(`Cannot publish experiment: ${e.message}`);
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

  for (const { experiment, changes } of experimentsToUpdate) {
    const updated = await updateExperiment({
      context,
      experiment,
      changes,
    });

    await req.audit({
      event: "experiment.status",
      entity: {
        object: "experiment",
        id: experiment.id,
      },
      details: auditDetailsUpdate(experiment, updated),
    });
  }

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

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
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

  await markRevisionAsPublished(
    context,
    revision,
    res.locals.eventAudit,
    comment
  );

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

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
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
    context,
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

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
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

  await discardRevision(context, revision, res.locals.eventAudit);

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
  req: AuthRequest<PostFeatureRuleBody, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { environment, rule, safeRolloutFields } = req.body;

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

  if (rule.type === "safe-rollout") {
    if (!context.hasPremiumFeature("safe-rollout")) {
      throw new Error(`Safe Rollout rules is a premium feature.`);
    }

    const validatedSafeRolloutFields = await validateCreateSafeRolloutFields(
      omit(safeRolloutFields, "rampUpSchedule"),
      context
    );

    // Set default status for safe rollout rule
    rule.status = "running";
    rule.seed = rule.seed || uuidv4();
    rule.trackingKey =
      rule.trackingKey || `${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}${uuidv4()}`;

    const safeRollout = await context.models.safeRollout.create({
      ...validatedSafeRolloutFields,
      environment,
      featureId: feature.id,
      status: rule.status,
      autoSnapshots: true,
      rampUpSchedule: {
        enabled: safeRolloutFields?.rampUpSchedule?.enabled ?? false, // this is used so that we can disable the ramp up schedule using feature Flag
        step: 0,
        steps: [
          { percent: 0.1 },
          { percent: 0.25 },
          { percent: 0.5 },
          { percent: 0.75 },
          { percent: 1 },
        ],
        rampUpCompleted: false,
        nextUpdate: undefined, // this is set with the rule is enabled
      },
    });

    if (!safeRollout) {
      throw new Error("Failed to create safe rollout");
    }
    rule.safeRolloutId = safeRollout.id;
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: [environment],
    defaultValueChanged: false,
    settings: org?.settings,
  });
  await addFeatureRule(
    context,
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
      context,
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
    changes.rules[env].push(envRule);

    // Feature updates
    updates.environmentSettings = updates.environmentSettings || {};
    updates.environmentSettings[env] = updates.environmentSettings[env] || {
      enabled: false,
      rules: [],
    };
    updates.environmentSettings[env].rules =
      updates.environmentSettings[env].rules || [];
    updates.environmentSettings[env].rules.push(envRule);
  });

  const revision = await createRevision({
    context,
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
      context,
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
  const revision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    version,
  });
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

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  await updateRevision(
    context,
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
    context,
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

export async function putSafeRolloutStatus(
  req: AuthRequest<
    { status: SafeRolloutRule["status"]; environment: string; i: number },
    { id: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { status, environment, i } = req.body;
  const { org } = context;
  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await createRevision({
    context,
    feature,
    user: context.auditUser,
    environments: getEnvironmentIdsFromOrg(context.org),
    baseVersion: feature.version,
    org,
  });
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: [environment],
    defaultValueChanged: false,
    settings: org?.settings,
  });

  await editFeatureRule(
    context,
    revision,
    environment,
    i,
    { status },
    res.locals.eventAudit,
    resetReview
  );

  const live = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: feature.version,
  });
  if (!live) {
    throw new Error("Could not lookup feature history");
  }

  const base =
    revision.baseVersion === live.version
      ? live
      : await getRevision({
          context,
          organization: org.id,
          featureId: feature.id,
          version: revision.baseVersion,
        });
  if (!base) {
    throw new Error("Could not lookup feature history");
  }
  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: base,
    revision,
    allEnvironments: environmentIds,
    settings: org.settings,
  });
  if (!requiresReview) {
    const mergeResult = autoMerge(live, base, revision, environmentIds, {});

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
      "auto-publish status change"
    );

    await req.audit({
      event: "feature.publish",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updatedFeature, {
        revision: revision.version,
        comment: "auto-publish status change",
      }),
    });
  } else {
    await updateFeature(context, feature, {
      hasDrafts: true,
    });
  }
  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function putFeatureRule(
  req: AuthRequest<PutFeatureRuleBody, { id: string; version: string }>,
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

  if (rule.type === "safe-rollout") {
    if (!rule.safeRolloutId) {
      throw new Error("Safe Rollout rule must have a safeRolloutId");
    }
    const existingSafeRollout = await context.models.safeRollout.getById(
      rule.safeRolloutId
    );
    if (!existingSafeRollout) {
      throw new Error("Safe Rollout must exist");
    }

    const hasSafeRolloutStarted = existingSafeRollout.startedAt !== undefined;
    if (hasSafeRolloutStarted) {
      const existingRule = getSafeRolloutRuleFromFeature(
        feature,
        rule.safeRolloutId
      );
      if (!existingRule) {
        throw new Error("Unable to update rule that does not exist.");
      }

      const fieldsThatCannotBeUpdated = [
        "controlValue",
        "variationValue",
        "safeRolloutId",
        "hashAttribute",
        "seed",
        "trackingKey",
      ];
      const fieldsBeingUpdated = Object.entries(rule).filter(
        ([k, v]) => !isEqual(existingRule[k as keyof SafeRolloutRule], v)
      );

      // Check if any of the fields that cannot be updated are being updated
      const fieldsBeingUpdatedThatCannotBeUpdated = fieldsBeingUpdated.filter(
        ([fieldName]) => fieldsThatCannotBeUpdated.includes(fieldName)
      );

      if (fieldsBeingUpdatedThatCannotBeUpdated.length > 0) {
        const fieldNames = fieldsBeingUpdatedThatCannotBeUpdated
          .map(([fieldName]) => fieldName)
          .join(", ");
        throw new Error(
          `Cannot update the following fields after a Safe Rollout has started: ${fieldNames}`
        );
      }
    }
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: [environment],
    defaultValueChanged: false,
    settings: org?.settings,
  });

  await editFeatureRule(
    context,
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
    context,
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
    context,
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

  // For a feature created before requireProjectForFeatures was enabled, allow updates to happen until the feature is associated with a project
  if (
    org.settings?.requireProjectForFeatures &&
    feature.project &&
    updates.project === ""
  ) {
    throw new Error("Must specify a project");
  }
  // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
  if (updates.project && feature.project !== updates.project) {
    await context.models.projects.ensureProjectsExist([updates.project]);
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
    "customFields",
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
      evalDate?: string;
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
    evalDate,
  } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  const date = evalDate ? new Date(evalDate) : new Date();

  const groupMap = await getSavedGroupMap(org);
  const experimentMap = await getAllPayloadExperiments(context);
  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const safeRolloutMap = await context.models.safeRollout.getAllPayloadSafeRollouts();
  const results = evaluateFeature({
    feature,
    revision,
    attributes,
    groupMap,
    experimentMap,
    environments,
    scrubPrerequisites,
    skipRulesWithPrerequisites,
    date,
    safeRolloutMap,
  });

  res.status(200).json({
    status: 200,
    results: results,
  });
}

export async function postFeaturesEvaluate(
  req: AuthRequest<{
    attributes: Record<string, boolean | string | number | object>;
    featureIds: string[];
    environment: string;
  }>,
  res: Response<
    {
      status: 200;
      results: { [key: string]: FeatureTestResult }[] | undefined;
    },
    EventUserForResponseLocals
  >
) {
  const context = getContextFromReq(req);
  const {
    attributes,
    featureIds, // Array of feature ids to evaluate
    environment,
  } = req.body;

  const features: FeatureInterface[] = [];
  await Promise.all(
    featureIds.map(async (featureId) => {
      const feature = await getFeature(context, featureId);
      if (feature) {
        features.push(feature);
      }
    })
  );

  // now evaluate all features:
  const allEnvironments = getEnvironments(context.org);
  const environments =
    environment !== ""
      ? [allEnvironments.find((obj) => obj.id === environment)]
      : getEnvironments(context.org);
  const safeRolloutMap = await context.models.safeRollout.getAllPayloadSafeRollouts();
  const featureResults = await evaluateAllFeatures({
    features,
    context,
    attributeValues: attributes,
    groupMap: await getSavedGroupMap(context.org),
    environments: environments,
    safeRolloutMap,
  });
  res.status(200).json({
    status: 200,
    results: featureResults,
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
  res: Response<{ status: 200; log: RevisionLog[] }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  // In the past logs were stored on the revisions.
  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    version: parseInt(version),
    includeLog: true,
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  // But now we store logs in a separate table as they are too large
  const revisionLogs = await context.models.featureRevisionLogs.getAllByFeatureIdAndVersion(
    {
      featureId: id,
      version: parseInt(version),
    }
  );

  // revisionLogs use dateCreated as the timestamp, so we need to convert it to a RevisionLog as that is what the front end expects
  const revisionLogsFormatted: RevisionLog[] = revisionLogs.map((log) => ({
    timestamp: log.dateCreated,
    user: log.user,
    action: log.action,
    subject: log.subject,
    value: log.value,
  }));

  // We merge old logs on revisions with revisionLogs. The front end will sort them as needed
  const log = [...(revision.log || []), ...revisionLogsFormatted];

  res.json({
    status: 200,
    log: log,
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

  const minimalRevisions = await getMinimalRevisions(context, org.id, id);

  let fullRevisions = await getLatestRevisions(context, org.id, id);

  // The above only fetches the most recent revisions
  // If we're requesting a specific version that's older than that, fetch it directly
  if (req.query.v) {
    const version = parseInt(req.query.v);
    if (!fullRevisions.some((r) => r.version === version)) {
      const revision = await getRevision({
        context,
        organization: org.id,
        featureId: id,
        version,
      });
      if (revision) {
        fullRevisions.push(revision);
      }
    }
  }

  // Make sure we always select the live version, even if it's not one of the most recent revisions
  if (!fullRevisions.some((r) => r.version === feature.version)) {
    const revision = await getRevision({
      context,
      organization: org.id,
      featureId: id,
      version: feature.version,
    });
    if (revision) {
      fullRevisions.push(revision);
    }
  }

  // Historically, we haven't properly cleared revision history when deleting a feature
  // So if you create a feature with the same name as a previously deleted one, it would inherit the revision history
  // This can seriously mess up the feature page, so if we detect any old revisions, delete them
  if (fullRevisions.some((r) => r.dateCreated < feature.dateCreated)) {
    await cleanUpPreviousRevisions(org.id, feature.id, feature.dateCreated);
    fullRevisions = fullRevisions.filter(
      (r) => r.dateCreated >= feature.dateCreated
    );
  }

  // If feature doesn't have any revisions, add revision 1 automatically
  // We haven't always created revisions when creating a feature, so this lets us backfill
  if (!fullRevisions.length) {
    try {
      fullRevisions.push(
        await createInitialRevision(
          context,
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
    const draft = await migrateDraft(context, feature);
    if (draft) {
      fullRevisions.push(draft);
    }
  }

  // Get all linked experiments and  saferollouts
  const experimentIds = new Set<string>();
  const trackingKeys = new Set<string>();
  let hasSafeRollout = false;
  fullRevisions.forEach((revision) => {
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
        } else if (rule.type === "safe-rollout") {
          hasSafeRollout = true;
        }
      });
    });
  });
  const experimentsMap: Map<string, ExperimentInterface> = new Map();
  const safeRolloutMap: Map<string, SafeRolloutInterface> = new Map();
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
  if (hasSafeRollout) {
    const safeRollouts = await context.models.safeRollout.getAllByFeatureId(
      feature.id
    );
    safeRollouts.forEach((safeRollout: SafeRolloutInterface) => {
      safeRolloutMap.set(safeRollout.id, safeRollout);
    });
  }

  // Sanity check to make sure the published revision values and rules match what's stored in the feature
  const live = fullRevisions.find((r) => r.version === feature.version);
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
      logger.error(e);
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
    revisionList: minimalRevisions,
    revisions: fullRevisions,
    experiments: [...experimentsMap.values()],
    safeRollouts: [...safeRolloutMap.values()],
    codeRefs,
  });
}

export async function getFeatureUsage(
  req: AuthRequest<null, { id: string }, { lookback?: FeatureUsageLookback }>,
  res: Response<{ status: 200; usage: FeatureUsageData }>
) {
  const context = getContextFromReq(req);
  const { org } = context;

  const { id } = req.params;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(org);

  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  //TODO: handle multiple datasources with feature tracking
  const ds = await getGrowthbookDatasource(context);
  if (!ds) {
    throw new Error("No tracking datasource configured");
  }

  const integration = getSourceIntegrationObject(context, ds, true);
  if (!integration.getFeatureUsage) {
    throw new Error("Tracking datasource does not support feature usage");
  }

  const lookback = req.query.lookback || "15minute";

  const { start, rows } = await integration.getFeatureUsage(
    feature.id,
    lookback
  );

  function createTimeseries() {
    const datapoints: FeatureUsageDataPoint[] = [];
    for (let i = 0; i < 50; i++) {
      const ts = new Date(start);
      if (lookback === "15minute") {
        ts.setMinutes(ts.getMinutes() + i);
      } else if (lookback === "hour") {
        ts.setMinutes(ts.getMinutes() + 5 * i);
      } else if (lookback === "day") {
        ts.setHours(ts.getHours() + i);
      } else {
        ts.setHours(ts.getHours() + 6 * i);
      }

      if (ts > new Date()) {
        break;
      }

      datapoints.push({
        t: ts.getTime(),
        v: {},
      });
    }
    return datapoints;
  }

  const getTSIndex = (timestamp: Date, data: FeatureUsageDataPoint[]) => {
    const t = timestamp.getTime();

    for (let i = 0; i < data.length; i++) {
      if (data[i].t > t) {
        return i - 1;
      }
    }
    // If we get here, the timestamp is in the future
    return data.length - 1;
  };

  const usage: FeatureUsageData = {
    byRuleId: createTimeseries(),
    bySource: createTimeseries(),
    byValue: createTimeseries(),
    total: 0,
  };

  const validEnvs = new Set(environments.map((e) => e.id));

  function updateRecord(
    data: FeatureUsageDataPoint[],
    key: string,
    ts: Date,
    evaluations: number
  ) {
    const idx = getTSIndex(ts, data);
    if (!data[idx]) return;
    data[idx].v[key] = (data[idx].v[key] || 0) + evaluations;
  }

  rows.forEach((d) => {
    // Skip invalid environments (sanity check)
    if (!d.environment || !validEnvs.has(d.environment)) return;

    // Overall
    usage.total += d.evaluations;
    updateRecord(usage.bySource, d.source, d.timestamp, d.evaluations);
    updateRecord(usage.byValue, d.value, d.timestamp, d.evaluations);
    if (d.ruleId) {
      updateRecord(usage.byRuleId, d.ruleId, d.timestamp, d.evaluations);
    }
  });

  res.status(200).json({
    status: 200,
    usage,
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

export async function postCopyEnvironmentRules(
  req: AuthRequest<
    { sourceEnv: string; targetEnv: string },
    { id: string; version: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { sourceEnv, targetEnv } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  if (
    !environmentIds.includes(sourceEnv) ||
    !environmentIds.includes(targetEnv)
  ) {
    throw new Error("Invalid environment");
  }

  if (sourceEnv === targetEnv) {
    throw new Error("Source and target environments should be different");
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
    changedEnvironments: [targetEnv],
    defaultValueChanged: false,
    settings: org?.settings,
  });

  await copyFeatureEnvironmentRules(
    context,
    revision,
    sourceEnv,
    targetEnv,
    res.locals.eventAudit,
    resetReview
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}
