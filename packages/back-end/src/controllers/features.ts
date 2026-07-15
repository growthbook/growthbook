import { Request, Response } from "express";
import { evaluateFeatures } from "@growthbook/proxy-eval";
import { cloneDeep, isEqual, omit } from "lodash";
import { v4 as uuidv4 } from "uuid";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  autoMerge,
  filterEnvironmentsByFeature,
  filterProjectsByEnvironmentWithNull,
  MergeResultChanges,
  mergeResultHasChanges,
  MergeStrategy,
  checkIfRevisionNeedsReview,
  evaluatePublishGovernance,
  resetReviewOnChange,
  getAffectedEnvsForExperiment,
  getDependentExperiments,
  getDependentFeatures,
  getRevertValueValidationWarnings,
  getRulesForEnvironment,
  getEnvsFromRampSchedule,
  isFeatureStale,
  IsFeatureStaleResult,
  mergeRevision,
  liveRevisionFromFeature,
  fillRevisionFromFeature,
  getReviewSetting,
  namespacesToMap,
  pruneOrphanedRampActions,
  assertSchemaMatchesValueType,
} from "shared/util";
import { SAFE_ROLLOUT_TRACKING_KEY_PREFIX } from "shared/constants";
import {
  getConnectionSDKCapabilities,
  SDKCapability,
} from "shared/sdk-versioning";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  SafeRolloutRule,
  ACTIVE_DRAFT_STATUSES,
  RevisionMetadata,
  RevisionRampAction,
  RevisionRampCreateAction,
  RevisionRampDetachAction,
  RevisionRampUpdateAction,
  RampStepAction,
} from "shared/validators";
import { FeatureUsageLookback } from "shared/types/integrations";
import {
  ContextualBanditRefRule,
  ExperimentRefRule,
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  FeatureTestResult,
  FeatureMetaInfo,
  JSONSchemaDef,
  FeatureUsageData,
  FeatureUsageDataPoint,
} from "shared/types/feature";
import { FeatureUsageRecords } from "shared/types/realtime";
import {
  EventUserForResponseLocals,
  EventUserLoggedIn,
} from "shared/types/events/event-types";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { Changeset, ExperimentInterface } from "shared/types/experiment";
import {
  PostFeatureRuleBody,
  PutFeatureRuleBody,
} from "shared/types/feature-rule";
import { getValidDate } from "shared/dates";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getContextForAgendaJobByOrgId,
  getContextFromReq,
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/services/organizations";
import {
  addLinkedExperiment,
  createFeature,
  deleteFeature,
  editFeatureRule,
  getAllFeatures,
  getAllFeaturesForStaleGraph,
  getFeature,
  getFeaturesByIds,
  getFeatureMetaInfoById,
  getFeatureMetaInfoByIds,
  getFeatureEnvStatus,
  hasArchivedFeatures,
  migrateDraft,
  prevalidatePublishRevision,
  publishRevision,
  setDefaultValue,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { getRealtimeUsageByHour } from "back-end/src/models/RealtimeModel";
import { dangerousLookupOrganizationByApiKey } from "back-end/src/util/api-key.util";
import { generateId } from "back-end/src/util/uuid";
import {
  addIdsToFlatRules,
  addIdsToRules,
  evaluateAllFeatures,
  evaluateFeature,
  FeatureDefinitionSDKPayload,
  generateRuleId,
  getFeatureDefinitions,
  getMergeResultPublishEnvs,
  getSavedGroupMap,
  getLiveAndBaseRevisionsForFeature,
  getLiveRevisionForFeature,
  getDraftRevision,
  assertCanAutoPublish,
  revisionRequiresReview,
} from "back-end/src/services/features";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import {
  moveFlatRule,
  stampRuleForEnvs,
  updateRuleById,
  removeRuleById,
} from "back-end/src/util/revisionRuleOps";
import {
  getSDKPayloadCacheLocation,
  formatLegacyCacheKey,
} from "back-end/src/models/SdkConnectionCacheModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import {
  dispatchFeatureRevisionEvent,
  dispatchRevisionReviewEvent,
  recordRevisionUpdate,
} from "back-end/src/services/featureRevisionEvents";
import {
  cleanUpPreviousRevisions,
  createInitialRevision,
  createRevision,
  discardRevision,
  reopenRevision,
  recallReview,
  undoReview,
  getActiveDraft,
  getActiveDraftStates,
  DraftStatusCounts,
  getMinimalRevisions,
  getRevision,
  getRevisionsByVersions,
  getFeaturePageRevisions,
  getRevisionsByStatus,
  markRevisionAsReviewRequested,
  normalizeRulesInputToV2,
  prevalidateRevisionUpdate,
  ReviewSubmittedType,
  submitReviewAndComments,
  updateRevision,
  setAutoPublishOnApproval,
  setRevisionScheduledPublish,
} from "back-end/src/models/FeatureRevisionModel";
import {
  buildFeatureLookups,
  getEnabledEnvironments,
} from "back-end/src/util/features";
import { ReqContext } from "back-end/types/request";
import {
  findSDKConnectionByKey,
  markSDKConnectionUsed,
} from "back-end/src/models/SdkConnectionModel";
import { logger } from "back-end/src/util/logger";
import { yieldEventLoop } from "back-end/src/util/yield";
import { addTagsDiff } from "back-end/src/models/TagModel";
import {
  CACHE_CONTROL_MAX_AGE,
  CACHE_CONTROL_STALE_IF_ERROR,
  CACHE_CONTROL_STALE_WHILE_REVALIDATE,
  FASTLY_SERVICE_ID,
} from "back-end/src/util/secrets";
import { getSurrogateKeysFromEnvironments } from "back-end/src/util/cdn.util";
import {
  addLinkedFeatureToExperiment,
  addPendingFeatureDraftToExperiment,
  clearPendingFeatureDraftsForRevision,
  clearPendingFeatureDraftsForFeature,
  removePendingFeatureDraftFromExperiment,
  removeLinkedFeatureFromExperiment,
  unlinkFeatureFromAllExperiments,
  getAllPayloadExperiments,
  getExperimentById,
  getExperimentsByIds,
  getExperimentsByTrackingKeys,
  getAllExperimentsForStaleGraph,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { ApiReqContext } from "back-end/types/api";
import { getAllCodeRefsForFeature } from "back-end/src/models/FeatureCodeRefs";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";
import { getChangesToStartExperiment } from "back-end/src/services/experiments";
import { approveScheduledExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import {
  formatPendingDraftFailureMessage,
  PendingDraftPublishResult,
  publishPendingFeatureDraftsForExperiment,
} from "back-end/src/services/experiment-feature";
import { validateCreateSafeRolloutFields } from "back-end/src/validators/safe-rollout";
import { getSafeRolloutRuleFromFeature } from "back-end/src/routers/safe-rollout/safe-rollout.helper";
import {
  SoftWarningError,
  UnrecoverableApiError,
} from "back-end/src/util/errors";
import {
  canEnableFeatureAutoPublishOnApproval,
  canPublishFeatureRevision,
  canScheduleFeaturePublish,
  maybeAutoPublishFeatureRevision,
  parseScheduledPublishDate,
} from "back-end/src/api/features/autoPublishOnApproval";
import {
  shouldValidateCustomFieldsOnUpdate,
  validateCustomFieldsForSection,
} from "back-end/src/util/custom-fields";
import { getInitialFeatureJsonSchema } from "back-end/src/util/feature-json-schema";

function normalizeRampStepAction(a: {
  targetType?: string;
  targetId?: string;
  patch: Record<string, unknown>;
}): RampStepAction {
  return {
    targetType: "feature-rule",
    targetId: a.targetId ?? "",
    patch: a.patch as RampStepAction["patch"],
  };
}

/**
 * Routes an envelope change through the revision system.
 * Bundles into the specified draft (by version) if provided; otherwise falls
 * back to the most-recent active draft; otherwise creates a new draft.
 * Returns the draft revision so callers can return its version to the client.
 */
async function createOrUpdateDraftWithChanges(
  context: ReqContext,
  feature: FeatureInterface,
  envelopeChanges: Partial<
    Pick<
      FeatureRevisionInterface,
      | "environmentsEnabled"
      | "prerequisites"
      | "archived"
      | "metadata"
      | "holdout"
    >
  >,
  logEntry: Omit<RevisionLog, "timestamp">,
  targetDraftVersion?: number,
  forceNewDraft?: boolean,
  autoComment?: string,
): Promise<FeatureRevisionInterface> {
  const { org } = context;
  const environments = getEnvironmentIdsFromOrg(context.org);

  let existingDraft: FeatureRevisionInterface | null = null;
  if (forceNewDraft) {
    // Caller explicitly requested a brand-new draft — skip any existing one.
    existingDraft = null;
  } else if (targetDraftVersion) {
    existingDraft = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: targetDraftVersion,
    });
  } else {
    existingDraft = await getActiveDraft(context, feature);
  }

  if (existingDraft) {
    const merged: typeof envelopeChanges = {};
    if ("environmentsEnabled" in envelopeChanges) {
      merged.environmentsEnabled = {
        ...(existingDraft.environmentsEnabled || {}),
        ...envelopeChanges.environmentsEnabled,
      };
    }
    if ("prerequisites" in envelopeChanges) {
      merged.prerequisites = envelopeChanges.prerequisites;
    }
    if ("archived" in envelopeChanges) {
      merged.archived = envelopeChanges.archived;
    }
    if ("metadata" in envelopeChanges) {
      merged.metadata = {
        ...(existingDraft.metadata || {}),
        ...envelopeChanges.metadata,
      };
    }
    if ("holdout" in envelopeChanges) {
      merged.holdout = envelopeChanges.holdout;
    }
    const updatedDraft = await updateRevision(
      context,
      feature,
      existingDraft,
      merged,
      logEntry,
      false,
    );
    if (!updatedDraft) {
      throw new Error(
        `Revision ${existingDraft.version} not found when updating draft`,
      );
    }
    return updatedDraft;
  }

  // No existing draft — create a new one
  const newRevision = await createRevision({
    context,
    feature,
    user: context.auditUser,
    environments,
    baseVersion: feature.version,
    changes: envelopeChanges as Partial<FeatureRevisionInterface>,
    publish: false,
    comment: autoComment || "",
    org,
  });
  return newRevision;
}

export type SDKPayloadParams = Pick<
  SDKConnectionInterface,
  | "key"
  | "environment"
  | "projects"
  | "encryptPayload"
  | "encryptionKey"
  | "sdkVersion"
  | "includeVisualExperiments"
  | "includeDraftExperiments"
  | "includeDraftExperimentRefs"
  | "includeExperimentNames"
  | "includeRedirectExperiments"
  | "includeRuleIds"
  | "hashSecureAttributes"
  | "savedGroupReferencesEnabled"
  | "remoteEvalEnabled"
  | "includeProjectIdInMetadata"
  | "includeCustomFieldsInMetadata"
  | "allowedCustomFieldsInMetadata"
  | "includeTagsInMetadata"
> &
  Partial<Pick<SDKConnectionInterface, "organization">> & {
    // Extend languages to allow "legacy" for old API keys
    languages: SDKLanguage[] | ["legacy"];
  };

export async function getPayloadParamsFromApiKey(
  key: string,
  req: Request,
): Promise<SDKPayloadParams> {
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
      key: connection.key,
      organization: connection.organization,
      environment: connection.environment,
      projects: connection.projects,
      encryptPayload: connection.encryptPayload,
      encryptionKey: connection.encryptionKey,
      includeVisualExperiments: connection.includeVisualExperiments,
      includeDraftExperiments: connection.includeDraftExperiments,
      includeDraftExperimentRefs: connection.includeDraftExperimentRefs,
      includeExperimentNames: connection.includeExperimentNames,
      includeRedirectExperiments: connection.includeRedirectExperiments,
      includeRuleIds: connection.includeRuleIds,
      includeProjectIdInMetadata: connection.includeProjectIdInMetadata,
      includeCustomFieldsInMetadata: connection.includeCustomFieldsInMetadata,
      allowedCustomFieldsInMetadata: connection.allowedCustomFieldsInMetadata,
      includeTagsInMetadata: connection.includeTagsInMetadata,
      hashSecureAttributes: connection.hashSecureAttributes,
      remoteEvalEnabled: connection.remoteEvalEnabled,
      savedGroupReferencesEnabled: connection.savedGroupReferencesEnabled,
      languages: connection.languages,
      sdkVersion: connection.sdkVersion,
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
    } = await dangerousLookupOrganizationByApiKey(key);
    if (!organization) {
      throw new UnrecoverableApiError("Invalid API Key");
    }
    if (secret) {
      throw new UnrecoverableApiError(
        "Must use a Publishable API key to get feature definitions",
      );
    }

    if (project && !projectFilter) {
      projectFilter = project;
    }

    // Synthesize a legacy cache key in lieu of an SDK connection key
    const cacheKey = formatLegacyCacheKey({
      apiKey: key,
      environment,
      project: projectFilter,
    });

    return {
      key: cacheKey,
      organization,
      environment: environment || "production",
      projects: projectFilter ? [projectFilter] : [],
      encryptPayload: !!encryptSDK,
      encryptionKey: encryptionKey || "",
      languages: ["legacy"], // "legacy" marker for computing basic capabilities (bucketingV2)
      sdkVersion: "0.0.0",
    };
  }
}

// Get feature definitions with cache-first strategy.
// Falls back to JIT generation on cache miss/corruption, with write-back to populate cache.
// Accepts: SDKPayloadParams - either a full SDKConnectionInterface object or a subset via API key lookup.
export async function getFeatureDefinitionsWithCache({
  context,
  params,
}: {
  context: ReqContext | ApiReqContext;
  params: SDKPayloadParams;
}): Promise<FeatureDefinitionSDKPayload> {
  let defs: FeatureDefinitionSDKPayload | undefined;
  const storageLocation = getSDKPayloadCacheLocation();

  // Try cache first
  if (storageLocation !== "none") {
    const cached = await context.models.sdkConnectionCache.getById(params.key);
    if (cached) {
      try {
        defs = JSON.parse(cached.contents);
      } catch (e) {
        logger.warn(e, "Failed to parse cached SDK payload, regenerating");
      }
    }
  }

  // Generate if cache disabled, cache miss, or corrupt cache
  if (!defs) {
    // Derive capabilities from languages/sdkVersion (or hardcode for legacy API keys)
    const capabilities =
      params.languages[0] === "legacy"
        ? ["bucketingV2" as SDKCapability] // hardcoded for legacy API keys
        : getConnectionSDKCapabilities({
            languages: params.languages as SDKLanguage[],
            sdkVersion: params.sdkVersion,
          });

    const environmentDoc = context.org?.settings?.environments?.find(
      (e) => e.id === params.environment,
    );
    const filteredProjects = filterProjectsByEnvironmentWithNull(
      params.projects,
      environmentDoc,
      true,
    );

    defs = await getFeatureDefinitions({
      context,
      capabilities,
      environment: params.environment,
      projects: filteredProjects,
      encryptPayload: params.encryptPayload,
      encryptionKey: params.encryptionKey,
      includeVisualExperiments: params.includeVisualExperiments,
      includeDraftExperiments: params.includeDraftExperiments,
      includeDraftExperimentRefs: params.includeDraftExperimentRefs,
      includeExperimentNames: params.includeExperimentNames,
      includeRedirectExperiments: params.includeRedirectExperiments,
      includeRuleIds: params.includeRuleIds,
      includeProjectIdInMetadata: params.includeProjectIdInMetadata,
      includeCustomFieldsInMetadata: params.includeCustomFieldsInMetadata,
      allowedCustomFieldsInMetadata: params.allowedCustomFieldsInMetadata,
      includeTagsInMetadata: params.includeTagsInMetadata,
      hashSecureAttributes: params.hashSecureAttributes,
      savedGroupReferencesEnabled:
        params.savedGroupReferencesEnabled !== undefined
          ? params.savedGroupReferencesEnabled &&
            capabilities.includes("savedGroupReferences")
          : undefined,
    });

    // Write back to cache to populate it for future reads (fire and forget)
    if (storageLocation !== "none") {
      const rawStack = new Error().stack || "";
      const stackTrace = rawStack.replace(/^Error.*?\n/, "");

      context.models.sdkConnectionCache
        .upsert(params.key, JSON.stringify(defs), {
          dateUpdated: new Date(),
          event: "cache-miss",
          model: "sdk-connection",
          stack: stackTrace,
          connection: params as unknown as Record<string, unknown>,
        })
        .catch((e) => {
          logger.warn(e, "Failed to write JIT generated payload to cache");
        });
    }
  }

  return defs;
}

export async function getFeaturesPublic(req: Request, res: Response) {
  try {
    const { key } = req.params;

    if (!key) {
      throw new UnrecoverableApiError("Missing API key in request");
    }

    const params = await getPayloadParamsFromApiKey(key, req);

    if (!params.organization) {
      throw new UnrecoverableApiError("Organization not found for API key");
    }

    const context = await getContextForAgendaJobByOrgId(params.organization);

    if (params.remoteEvalEnabled) {
      throw new UnrecoverableApiError(
        "Remote evaluation required for this connection",
      );
    }

    const defs = await getFeatureDefinitionsWithCache({
      context,
      params,
    });

    // The default is Cache for 30 seconds, serve stale up to 1 hour (10 hours if origin is down)
    res.set(
      "Cache-control",
      `public, max-age=${CACHE_CONTROL_MAX_AGE}, stale-while-revalidate=${CACHE_CONTROL_STALE_WHILE_REVALIDATE}, stale-if-error=${CACHE_CONTROL_STALE_IF_ERROR}`,
    );

    // If using Fastly, add surrogate key header for cache purging
    if (FASTLY_SERVICE_ID) {
      // Purge by org, API Key, or payload contents
      const surrogateKeys = [
        params.organization,
        key,
        ...getSurrogateKeysFromEnvironments(params.organization, [
          params.environment,
        ]),
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

    const params = await getPayloadParamsFromApiKey(key, req);

    if (!params.organization) {
      throw new UnrecoverableApiError("Organization not found for API key");
    }

    const context = await getContextForAgendaJobByOrgId(params.organization);

    if (!params.remoteEvalEnabled) {
      throw new UnrecoverableApiError(
        "Remote evaluation disabled for this connection",
      );
    }

    // Evaluate features using provided attributes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attributes: Record<string, any> = req.body?.attributes || {};
    const forcedVariations: Record<string, number> =
      req.body?.forcedVariations || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forcedFeatures: Map<string, any> = new Map(
      req.body.forcedFeatures || [],
    );
    const url = req.body?.url;

    const defs = await getFeatureDefinitionsWithCache({
      context,
      params,
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
  >,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const {
    id,
    environmentSettings,
    holdout,
    customFields,
    jsonSchema,
    ...otherProps
  } = req.body;

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
        `Feature key must match the regex validator. '${org.settings.featureRegexValidator}' Example: '${org.settings.featureKeyExample}'`,
      );
    }
  }

  if (!environmentSettings) {
    throw new Error("Feature missing initial environment toggle settings");
  }

  if (!id.match(/^[a-zA-Z0-9_.:|-]+$/)) {
    throw new Error(
      "Feature keys can only include letters, numbers, hyphens, and underscores.",
    );
  }

  if (org.settings?.requireProjectForFeatures && !otherProps.project) {
    throw new Error("Must specify a project for new features");
  }
  // Validate projects - We can remove this validation when FeatureModel is migrated to BaseModel
  if (otherProps.project) {
    await context.models.projects.ensureProjectsExist([otherProps.project]);
  }

  await validateCustomFieldsForSection({
    customFieldValues: customFields,
    customFieldsModel: context.models.customFields,
    section: "feature",
    project: otherProps.project || undefined,
  });

  const existing = await getFeature(context, id);
  if (existing) {
    throw new Error(
      "This feature key already exists. Feature keys must be unique.",
    );
  }

  const initialJsonSchema = getInitialFeatureJsonSchema(jsonSchema);

  const feature: FeatureInterface = {
    defaultValue: "",
    valueType: "boolean",
    owner: userId,
    description: "",
    project: "",
    environmentSettings: {},
    rules: [],
    customFields,
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id,
    archived: false,
    version: 1,
    holdout: holdout?.id ? holdout : undefined,
    jsonSchema: initialJsonSchema,
  };

  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  // construct environmentSettings, scrub environments if not allowed in project
  feature.environmentSettings = Object.fromEntries(
    Object.entries(environmentSettings).filter(([env]) =>
      environmentIds.includes(env),
    ),
  );

  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environmentIds)),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  addIdsToRules(feature.environmentSettings, feature.id);

  // Accept v1-shape (env-nested rules) or v2-shape (top-level `rules`) bodies,
  // but never both — mixing silently concats into feature.rules and can
  // corrupt rule ids. buildFeatureUpdate strips stray envSettings[env].rules
  // on write.
  const inboundEnvRules = Object.fromEntries(
    Object.entries(feature.environmentSettings ?? {}).map(([env, settings]) => [
      env,
      ((settings as unknown as { rules?: FeatureRule[] }).rules ??
        []) as FeatureRule[],
    ]),
  );
  const hasTopLevelRules = Array.isArray(otherProps.rules)
    ? otherProps.rules.length > 0
    : false;
  const hasPerEnvRules = Object.values(inboundEnvRules).some(
    (r) => Array.isArray(r) && r.length > 0,
  );
  if (hasTopLevelRules && hasPerEnvRules) {
    throw new Error(
      "Feature create received both top-level `rules` and `environmentSettings[env].rules`. " +
        "Use one shape or the other — the v1 per-env shape is for v1 clients; the v2 flat `rules` array is for v2 clients.",
    );
  }
  // v1-shape (per-env) input is normalized through `normalizeRulesInputToV2`
  // so content-identical rules across envs merge into a single v2 rule with
  // `environments: [...envs]` (or `allEnvironments: true` when applicable),
  // matching the read-path JIT migration. The naive shared `naiveFlattenV1Rules`
  // would split the same rule id across envs, forcing `ensureUniqueRuleIds`
  // to suffix and breaking v1 round-trip semantics.
  const flattenedInbound = normalizeRulesInputToV2(inboundEnvRules, {
    orgEnvs: getEnvironments(org),
    featureProject: feature.project,
  });
  if (flattenedInbound.length > 0) {
    feature.rules = [...(feature.rules ?? []), ...flattenedInbound];
  }

  // Inbound v2 rules (e.g. from FeatureFromExperimentModal) often arrive with
  // `id: ""`; stamp ids so they're addressable by later update/delete ops.
  addIdsToFlatRules(feature.rules, feature.id);

  await createFeature(context, feature);
  await context.models.watch.upsertWatch({
    userId,
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

  if (holdout && holdout.id) {
    const holdoutObj = await context.models.holdout.getById(holdout.id);
    if (!holdoutObj) {
      throw new Error("Holdout not found");
    }
    await context.models.holdout.updateById(holdout.id, {
      linkedFeatures: {
        ...holdoutObj.linkedFeatures,
        [id]: { id, dateAdded: new Date() },
      },
    });
  }

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
  res: Response,
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
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  const rebasableStatuses = [
    "draft",
    "pending-review",
    "changes-requested",
    "approved",
  ];
  if (!rebasableStatuses.includes(revision.status)) {
    throw new Error("Can only fix conflicts for active draft revisions");
  }
  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });

  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    strategies || {},
  );
  if (JSON.stringify(mergeResult) !== mergeResultSerialized) {
    throw new Error(
      "Something seems to have changed while you were reviewing the draft. Please re-review with the latest changes and submit again.",
    );
  }

  if (!mergeResult.success) {
    throw new Error("Please resolve conflicts before saving");
  }

  const newRules: FeatureRule[] =
    mergeResult.result.rules ?? feature.rules ?? [];
  const newEnvironmentsEnabled: Record<string, boolean> = {};
  environmentIds.forEach((env) => {
    newEnvironmentsEnabled[env] =
      mergeResult.result.environmentsEnabled?.[env] ??
      feature.environmentSettings?.[env]?.enabled ??
      false;
  });

  // Build complete metadata snapshot: start from live feature, overlay any
  // metadata fields the merge result explicitly changed.
  const featureMetadataSnapshot: RevisionMetadata = {
    description: feature.description,
    owner: feature.owner,
    project: feature.project,
    tags: feature.tags,
    neverStale: feature.neverStale,
    customFields: feature.customFields,
    jsonSchema: feature.jsonSchema,
    valueType: feature.valueType,
  };
  const newMetadata: RevisionMetadata = mergeResult.result.metadata
    ? { ...featureMetadataSnapshot, ...mergeResult.result.metadata }
    : featureMetadataSnapshot;

  // The merge can drop a rule that a pending ramp action targets (e.g. live
  // deleted it). Prune those orphaned actions rather than carrying dead
  // intent forward; the prune is recorded in the rebase log entry below.
  const { kept: keptRampActions, pruned: prunedRampActions } =
    pruneOrphanedRampActions(revision.rampActions, newRules);

  // A rebase that actually pulls in upstream changes must re-trigger review
  // per org policy — the prior approval was for pre-rebase content. Mirrors
  // the v2 REST rebase path (postFeatureRevisionRebase). The merged result
  // carries rules as a whole array, so when the rebase produced a new one we
  // treat every env the feature is in as potentially changed.
  const rulesChanged = mergeResult.result.rules !== undefined;
  const changedEnvsFromRebase = Array.from(
    new Set([
      ...(rulesChanged ? environmentIds : []),
      ...Object.keys(mergeResult.result.environmentsEnabled ?? {}),
    ]),
  );
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: changedEnvsFromRebase,
    defaultValueChanged: mergeResult.result.defaultValue !== undefined,
    settings: org.settings,
  });

  await updateRevision(
    context,
    feature,
    revision,
    {
      baseVersion: live.version,
      defaultValue: mergeResult.result.defaultValue ?? feature.defaultValue,
      rules: newRules,
      environmentsEnabled: newEnvironmentsEnabled,
      prerequisites:
        mergeResult.result.prerequisites ?? feature.prerequisites ?? [],
      archived: mergeResult.result.archived ?? feature.archived ?? false,
      metadata: newMetadata,
      holdout:
        "holdout" in mergeResult.result
          ? mergeResult.result.holdout
          : (feature.holdout ?? null),
      ...(prunedRampActions.length > 0 ? { rampActions: keptRampActions } : {}),
    },
    {
      user: res.locals.eventAudit,
      action: "rebase",
      subject: `on top of revision #${live.version}`,
      value: JSON.stringify(
        prunedRampActions.length > 0
          ? { ...mergeResult.result, prunedRampActions }
          : mergeResult.result,
      ),
    },
    resetReview,
    // Rebase is permitted while a "lock edits" schedule is active.
    { bypassScheduleLock: true },
  );

  const rebased = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  const finalRevision = rebased ?? revision;

  void req
    .audit({
      event: "feature.revision.rebase",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(
        { baseVersion: revision.baseVersion },
        { baseVersion: live.version },
        { version: revision.version },
      ),
    })
    .catch((e) =>
      logger.error(e, "Failed to write audit log for revision.rebase"),
    );

  await dispatchFeatureRevisionEvent(
    context,
    feature,
    finalRevision,
    "revision.rebased",
    { baseVersion: live.version },
  );

  // A clean rebase (no review reset) keeps an approved+armed draft approved;
  // re-fire auto-publish so it merges now it's rebased onto live.
  await maybeAutoPublishFeatureRevision(context, feature, finalRevision);

  res.status(200).json({
    status: 200,
  });
}
// Arm or cancel a deferred publish on a draft (scheduledPublishAt: null cancels).
// The Agenda poller fires it once the date arrives and governance allows.
export async function postFeatureScheduledPublish(
  req: AuthRequest<
    {
      scheduledPublishAt: string | null;
      lockEdits?: boolean;
      lockOthers?: boolean;
      bypassApproval?: boolean;
    },
    { id: string; version: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const { scheduledPublishAt, lockEdits, lockOthers } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) throw new Error("Could not find feature");

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  if (!revision) throw new Error("Could not find feature revision");

  if (
    !["draft", "pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new Error(
      "Cannot schedule publish on a published or discarded revision",
    );
  }

  const date = parseScheduledPublishDate(scheduledPublishAt);
  // Arming needs the premium feature + publish authority; canceling needs only
  // publish authority.
  const allowed = date
    ? canScheduleFeaturePublish(context, feature)
    : canPublishFeatureRevision(context, feature);
  if (!allowed) {
    context.permissions.throwPermissionError();
  }

  // Committing a schedule on a draft is the no-approval path (fires without a
  // review cycle), so only allow it when the change doesn't require review (or
  // the caller can bypass). Review-required drafts arm via request-review instead.
  if (date && revision.status === "draft") {
    // Fail closed when the base can't be resolved: don't engage locks/schedule
    // on a draft we can't confirm is review-exempt.
    const requiresReview = await revisionRequiresReview(
      context,
      feature,
      revision,
      { treatUnresolvedBaseAsReview: true },
    );
    if (
      requiresReview &&
      !context.permissions.canBypassApprovalChecks(feature)
    ) {
      throw new Error(
        "This change requires approval — request review to schedule its publish.",
      );
    }
  }

  // Persist the admin bypass-approval intent only when the caller actually has
  // that permission — a requested bypass from a non-admin is silently ignored.
  const bypassApproval =
    !!req.body.bypassApproval &&
    context.permissions.canBypassApprovalChecks(feature);

  await setRevisionScheduledPublish(
    context,
    revision,
    { scheduledPublishAt: date, lockEdits, lockOthers, bypassApproval },
    context.userId || null,
  );

  res.status(200).json({ status: 200 });
}

export async function postFeatureRequestReview(
  req: AuthRequest<
    {
      comment: string;
      autoPublishOnApproval?: boolean;
      // Optional deferred-publish schedule armed alongside the review request.
      scheduledPublishAt?: string | null;
      scheduledPublishLockEdits?: boolean;
      scheduledPublishLockOthers?: boolean;
    },
    { id: string; version: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const {
    comment,
    autoPublishOnApproval,
    scheduledPublishAt,
    scheduledPublishLockEdits,
    scheduledPublishLockOthers,
  } = req.body;
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
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only request review if is a draft");
  }
  const enableAutoPublish =
    autoPublishOnApproval &&
    canEnableFeatureAutoPublishOnApproval(context, feature);

  const scheduledDate = parseScheduledPublishDate(scheduledPublishAt);
  if (scheduledDate !== null && !canScheduleFeaturePublish(context, feature)) {
    context.permissions.throwPermissionError();
  }

  await markRevisionAsReviewRequested(
    context,
    revision,
    res.locals.eventAudit,
    comment,
    {
      autoPublishOnApproval: enableAutoPublish,
      scheduledPublishAt: scheduledDate,
      scheduledPublishLockEdits,
      scheduledPublishLockOthers,
    },
  );

  const updatedRevision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  const finalRevision = updatedRevision ?? revision;

  void req
    .audit({
      event: "feature.revision.requestReview",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(
        { status: revision.status },
        { status: finalRevision.status },
        { version: revision.version, comment },
      ),
    })
    .catch((e) =>
      logger.error(e, "Failed to write audit log for revision.requestReview"),
    );

  await dispatchFeatureRevisionEvent(
    context,
    feature,
    finalRevision,
    "revision.reviewRequested",
    { reviewComment: comment ?? null },
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
  res: Response,
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
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  const createdByUser = revision.createdBy as EventUserLoggedIn;

  // Verdicts may stand alone, but a plain comment must have a body.
  if (review === "Comment" && !comment?.trim()) {
    throw new Error("Comment cannot be empty");
  }

  if (createdByUser?.id === context.userId && review !== "Comment") {
    throw Error("cannot submit a review for your self");
  }

  // Block contributors from self-approving when the org setting is enabled.
  // Note: contributors[] is only populated on drafts created after contributor tracking was
  // deployed. Legacy drafts with no contributors[] bypass this check — there is no way to
  // retroactively determine co-authors without reading revision logs.
  if (review === "Approved") {
    const requireReviews = context.org.settings?.requireReviews;
    const reviewSetting = Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, feature)
      : undefined;
    if (reviewSetting?.blockSelfApproval) {
      const isSelfApproval = (revision.contributors ?? []).some(
        (id) => id === context.userId,
      );
      if (isSelfApproval) {
        throw new Error("You cannot approve a draft you contributed to.");
      }
    }
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
    comment,
    // Capture the live version the approval is made against so a later publish
    // can detect when the approval has gone stale.
    feature.version,
  );

  const updatedRevision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  const finalRevision = updatedRevision ?? revision;

  const auditUser = context.auditUser;
  const reviewer =
    auditUser && auditUser.type !== "system"
      ? { id: auditUser.id, name: auditUser.name, email: auditUser.email }
      : {};

  await dispatchRevisionReviewEvent(
    context,
    feature,
    revision,
    finalRevision,
    review,
    comment,
    reviewer,
  );

  if (review === "Approved") {
    await maybeAutoPublishFeatureRevision(context, feature, finalRevision);
  }

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureApproveAndPublish(
  req: AuthRequest<
    {
      comment: string;
      mergeResultSerialized: string;
      adminOverride?: boolean;
      publishExperimentIds?: string[];
    },
    { id: string; version: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const { comment } = req.body;
  const feature = await getFeature(context, id);
  if (!feature) throw new Error("Could not find feature");

  if (!context.permissions.canReviewFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  if (!revision) throw new Error("Could not find feature revision");

  const createdByUser = revision.createdBy as EventUserLoggedIn;
  if (createdByUser?.id === context.userId) {
    throw Error("Cannot approve a draft you created");
  }

  if (revision.contributors?.some((cid) => cid === context.userId)) {
    const requireReviews = context.org.settings?.requireReviews;
    const reviewSetting = Array.isArray(requireReviews)
      ? getReviewSetting(requireReviews, feature)
      : undefined;
    if (reviewSetting?.blockSelfApproval) {
      throw new Error("You cannot approve a draft you contributed to.");
    }
  }

  if (
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new Error(
      `Can only approve when review has been requested (status is "${revision.status}")`,
    );
  }

  // Recompute the merge result and run the staleness/conflict checks BEFORE
  // committing the approval. postFeaturePublish runs them only after the
  // "approved" status is written and the review event fired, so a concurrent
  // live publish in that window would fail the check and strand the revision
  // in "approved". Mirrors postFeaturePublish's drift-repair → autoMerge.
  const allEnvironments = getEnvironments(context.org);
  const featureEnvironmentIds = filterEnvironmentsByFeature(
    allEnvironments,
    feature,
  ).map((e) => e.id);
  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });
  await repairFeatureDriftIfNeeded(
    context,
    feature,
    live,
    featureEnvironmentIds,
    { throwOnFailure: true },
  );
  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    featureEnvironmentIds,
    {},
  );
  if (JSON.stringify(mergeResult) !== req.body.mergeResultSerialized) {
    throw new Error(
      "Something seems to have changed while you were reviewing the draft. Please re-review with the latest changes and submit again.",
    );
  }
  if (!mergeResult.success) {
    throw new Error("Please resolve conflicts before publishing");
  }

  // Verify publish capability BEFORE committing the approval — postFeaturePublish
  // only checks it after the "approved" status and review event are written, so a
  // review-but-not-publish caller would otherwise leave the draft stuck "approved".
  // Derive the affected envs from the post-drift-repair merge result, identical to
  // postFeaturePublish's check, so this gate can't diverge from the actual publish.
  const filledLive = { ...live, ...liveRevisionFromFeature(live, feature) };
  const envsToCheck = await getMergeResultPublishEnvs({
    context,
    feature,
    filledLiveRules: filledLive.rules ?? [],
    result: mergeResult.result,
    environmentIds: featureEnvironmentIds,
  });
  if (!context.permissions.canPublishFeature(feature, envsToCheck)) {
    context.permissions.throwPermissionError();
  }

  // Mirror postFeaturePublish's adminOverride + rebase-governance gates BEFORE
  // committing the approval. postFeaturePublish runs them only after the
  // "approved" status is written, so a draft that's behind live (when the org
  // enforces rebase-before-publish) — or an adminOverride without bypass rights
  // — would otherwise throw there and leave the revision stuck "approved".
  // Approving anchors approvedBaseVersion to the current live version, so model
  // that post-approval state (staleApproval=false; only raw divergence blocks).
  const adminOverride = !!req.body.adminOverride;
  if (adminOverride && !context.permissions.canBypassApprovalChecks(feature)) {
    context.permissions.throwPermissionError();
  }
  if (!adminOverride) {
    const governance = evaluatePublishGovernance({
      revisionStatus: "approved",
      baseVersion: revision.baseVersion,
      liveVersion: feature.version,
      mergeSuccess: true,
      liveChanges: [],
      approvedBaseVersion: feature.version,
      requireRebaseBeforePublish:
        !!context.org.settings?.requireRebaseBeforePublish,
    });
    if (governance.rebaseRequired && governance.blockReason) {
      throw new Error(governance.blockReason);
    }
  }

  await submitReviewAndComments(
    context,
    revision,
    res.locals.eventAudit,
    "Approved",
    comment,
    feature.version,
  );

  const approvedRevision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  const finalApproved = approvedRevision ?? revision;

  const auditUser = context.auditUser;
  const reviewer =
    auditUser && auditUser.type !== "system"
      ? { id: auditUser.id, name: auditUser.name, email: auditUser.email }
      : {};

  await dispatchRevisionReviewEvent(
    context,
    feature,
    revision,
    finalApproved,
    "Approved",
    comment,
    reviewer,
  );

  await postFeaturePublish(req, res);
}

export async function postFeatureToggleAutoPublish(
  req: AuthRequest<{ enabled: boolean }, { id: string; version: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const { enabled } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) throw new Error("Could not find feature");

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  if (!revision) throw new Error("Could not find feature revision");

  if (
    !["draft", "pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new Error(
      "Cannot change auto-publish on a published or discarded draft",
    );
  }

  // Baseline: only draft managers may change auto-publish arming (else any org
  // member could disarm another's draft). Enabling additionally needs publish
  // authority, since auto-publish runs under this user's authority.
  if (!context.permissions.canManageFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  if (enabled && !canEnableFeatureAutoPublishOnApproval(context, feature)) {
    context.permissions.throwPermissionError();
  }

  await setAutoPublishOnApproval(revision, !!enabled, context.userId || null);

  // Arming an already-approved draft must publish now — otherwise it waits for
  // an approval event that never comes.
  if (enabled && revision.status === "approved") {
    const armed =
      (await getRevision({
        context,
        organization: context.org.id,
        featureId: feature.id,
        feature,
        version: parseInt(version),
      })) ?? revision;
    await maybeAutoPublishFeatureRevision(context, feature, armed);
  }

  res.status(200).json({ status: 200 });
}

// Retract a review request: reverts pending-review / changes-requested /
// approved back to draft. Gated on canManageFeatureDrafts (any draft manager,
// not only the original requester).
export async function postFeatureRecallReview(
  req: AuthRequest<Record<string, never>, { id: string; version: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const feature = await getFeature(context, id);
  if (!feature) throw new Error("Could not find feature");
  if (!context.permissions.canManageFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  if (!revision) throw new Error("Could not find feature revision");
  await recallReview(context, revision, res.locals.eventAudit);
  res.status(200).json({ status: 200 });
}

// Reviewer retracts their own verdict: approved / changes-requested reverts to
// pending-review. Review comments remain in the log.
export async function postFeatureUndoReview(
  req: AuthRequest<Record<string, never>, { id: string; version: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version } = req.params;
  const feature = await getFeature(context, id);
  if (!feature) throw new Error("Could not find feature");
  if (!context.permissions.canReviewFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }
  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  if (!revision) throw new Error("Could not find feature revision");
  const newStatus = await undoReview(context, revision, res.locals.eventAudit);

  // Undoing a "changes-requested" verdict can flip the revision to "approved"
  // (another reviewer's approval still stands). Mirror the review path so an
  // armed draft auto-publishes instead of getting stuck in approved limbo.
  if (newStatus === "approved") {
    const finalRevision =
      (await getRevision({
        context,
        organization: context.org.id,
        featureId: feature.id,
        feature,
        version: parseInt(version),
      })) ?? revision;
    await maybeAutoPublishFeatureRevision(context, feature, finalRevision);
  }

  res.status(200).json({ status: 200 });
}

// Edit the comment text in an owned revision log entry. The model enforces
// that only the author of a plain `Comment` entry can mutate it; verdicts,
// review requests, and other audit-trail entries are immutable.
export async function putFeatureRevisionLogComment(
  req: AuthRequest<
    { comment: string },
    { id: string; version: string; logId: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version, logId } = req.params;
  const { comment } = req.body;
  if (!comment?.trim()) {
    throw new Error("Comment cannot be empty");
  }
  const feature = await getFeature(context, id);
  if (!feature) throw new Error("Could not find feature");
  await context.models.featureRevisionLogs.updateCommentText(logId, comment, {
    featureId: feature.id,
    version: parseInt(version),
  });
  res.status(200).json({ status: 200 });
}

// Delete an owned revision log entry. The model enforces that only the
// author of a plain `Comment` entry can delete; verdicts and other
// audit-trail entries are immutable.
export async function deleteFeatureRevisionLogEntry(
  req: AuthRequest<
    Record<string, never>,
    { id: string; version: string; logId: string }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id, version, logId } = req.params;
  const feature = await getFeature(context, id);
  if (!feature) throw new Error("Could not find feature");
  await context.models.featureRevisionLogs.deleteOwnedEntry(logId, {
    featureId: feature.id,
    version: parseInt(version),
  });
  res.status(200).json({ status: 200 });
}

// Detect drift between the live revision (source of truth) and the persisted
// `feature.rules` / `feature.defaultValue`. If found, repair in place by
// re-writing through `updateFeature` — which scrubs legacy
// `environmentSettings.{env}.rules` so the JIT read-time migration stops
// re-flattening them and shadowing the v2 top-level rules.
//
// Idempotent and converges in one round-trip. Mutates `feature` so callers in
// the same request see the repaired state without re-reading.
async function repairFeatureDriftIfNeeded(
  context: ReqContext,
  feature: FeatureInterface,
  live: FeatureRevisionInterface | undefined,
  environmentIds: string[],
  { throwOnFailure = false }: { throwOnFailure?: boolean } = {},
): Promise<void> {
  if (!live) return;

  const liveRulesFlat: FeatureRule[] = live.rules ?? [];
  const featureRulesFlat: FeatureRule[] = feature.rules ?? [];
  const defaultValueDrift = live.defaultValue !== feature.defaultValue;
  const driftedEnvs = environmentIds.filter(
    (env) =>
      !isEqual(
        getRulesForEnvironment(featureRulesFlat, env),
        getRulesForEnvironment(liveRulesFlat, env),
      ),
  );

  if (!defaultValueDrift && driftedEnvs.length === 0) return;

  logger.warn(
    {
      featureId: feature.id,
      orgId: context.org.id,
      defaultValueDrift,
      driftedEnvs,
    },
    "Repairing feature drift against live revision",
  );

  try {
    const original = { ...feature };
    const repaired = await updateFeature(context, feature, {
      ...(defaultValueDrift ? { defaultValue: live.defaultValue } : {}),
      rules: liveRulesFlat,
    });
    Object.assign(feature, repaired);

    // Record the repair in the audit history so automated rewrites are
    // visible and searchable (`context.autoRepair` in details). Non-fatal:
    // an audit write failure must not abort a publish/revert whose repair
    // succeeded.
    try {
      await context.auditLog({
        event: "feature.update",
        entity: {
          object: "feature",
          id: feature.id,
        },
        details: auditDetailsUpdate(original, repaired, {
          autoRepair: true,
          note: "Automatic drift repair: feature did not match its live revision and was rewritten from it",
          liveRevisionVersion: live.version,
          defaultValueDrift,
          driftedEnvs,
        }),
      });
    } catch (auditError) {
      logger.error(
        { err: auditError, featureId: feature.id, orgId: context.org.id },
        "Failed to write audit entry for feature drift repair",
      );
    }
  } catch (e) {
    logger.error(
      { err: e, featureId: feature.id, orgId: context.org.id },
      "Failed to repair feature drift",
    );
    // Write callers (publish, revert) MUST abort if the repair fails —
    // otherwise the subsequent diff runs against the stale `feature.rules`
    // and the operation silently no-ops or produces an incorrect merge
    // (the exact failure this helper exists to prevent). Read callers
    // (e.g. getFeatureById) tolerate the stale response.
    if (throwOnFailure) {
      throw new Error(
        "Could not reconcile feature with its live revision. Please retry.",
      );
    }
  }
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
  res: Response,
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
    feature,
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
  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });

  // Heal any pre-publish drift so `autoMerge` diffs the draft against the
  // true live state. Without this, a feature stuck at a prior version's
  // rules (e.g. via the legacy env.rules JIT-migration shadow) would make
  // the merge produce phantom "changes" or silently no-op.
  await repairFeatureDriftIfNeeded(context, feature, live, environmentIds, {
    throwOnFailure: true,
  });

  // Compute merge result first so the review check can diff the merged outcome
  // against live — the same approach the frontend uses. This prevents spurious
  // review requirements when the draft's raw rules differ from base only because
  // an automated process (e.g. ramp step advancement) published changes in between.
  const mergeResult = autoMerge(
    liveRevisionFromFeature(live, feature),
    fillRevisionFromFeature(base, feature),
    revision,
    environmentIds,
    {},
  );

  // Build an effective revision from the merge result layered on top of live,
  // mirroring the frontend's requireReviews calculation.
  const filledLive = {
    ...live,
    ...liveRevisionFromFeature(live, feature),
  };
  const effectiveRevision = mergeResult.success
    ? {
        ...filledLive,
        ...mergeResult.result,
        rules: mergeResult.result.rules ?? filledLive.rules ?? [],
        // rampActions live on the draft; autoMerge doesn't carry them through
        // MergeResultChanges, so re-attach them for the review gate check.
        rampActions: revision.rampActions,
      }
    : { ...revision, ...fillRevisionFromFeature(revision, feature) };

  // For ramp `update` actions, the live schedule may have step patches that
  // target environments the draft removes. Build a lookup so the review check
  // can catch the "removing env" direction as well as adding.
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
    settings: org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
    liveRampScheduleEnvs,
  });
  if (!adminOverride && requiresReview && revision.status !== "approved") {
    throw new Error("needs review before publishing");
  }
  if (requiresReview && !reviewStatuses.includes(revision.status)) {
    throw new Error("Can only publish Draft revisions");
  }

  // adminOverride skips review requirements AND the rebase-required governance
  // gate below, so it always demands the bypass permission — not just when
  // reviews are required.
  if (adminOverride && !context.permissions.canBypassApprovalChecks(feature)) {
    context.permissions.throwPermissionError();
  }
  if (JSON.stringify(mergeResult) !== mergeResultSerialized) {
    throw new Error(
      "Something seems to have changed while you were reviewing the draft. Please re-review with the latest changes and submit again.",
    );
  }

  if (!mergeResult.success) {
    throw new Error("Please resolve conflicts before publishing");
  }

  // Governance: when the org requires same-base merges, block publishing a
  // draft that is behind live (or whose approval has gone stale) until it is
  // rebased. Admins with the bypass permission may override.
  if (!adminOverride) {
    const governance = evaluatePublishGovernance({
      revisionStatus: revision.status,
      baseVersion: revision.baseVersion,
      liveVersion: feature.version,
      mergeSuccess: mergeResult.success,
      liveChanges: [],
      approvedBaseVersion: revision.approvedBaseVersion ?? null,
      requireRebaseBeforePublish: !!org.settings?.requireRebaseBeforePublish,
    });
    if (governance.rebaseRequired && governance.blockReason) {
      throw new Error(governance.blockReason);
    }
  }

  const envsToCheck = await getMergeResultPublishEnvs({
    context,
    feature,
    filledLiveRules: filledLive.rules ?? [],
    result: mergeResult.result,
    environmentIds,
  });
  if (!context.permissions.canPublishFeature(feature, envsToCheck)) {
    context.permissions.throwPermissionError();
  }

  // If publishing experiments along with this draft, ensure they are valid.
  // Experiments with a future statusUpdateSchedule.startAt are routed through
  // approveScheduledExperimentStart instead of starting immediately.
  const experimentsToUpdate: {
    experiment: ExperimentInterface;
    changes: Changeset;
  }[] = [];
  const experimentsToApproveSchedule: ExperimentInterface[] = [];
  if (publishExperimentIds && publishExperimentIds.length) {
    const experiments = await getExperimentsByIds(
      context,
      publishExperimentIds,
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

    const now = new Date();
    const startNowExperiments: ExperimentInterface[] = [];
    for (const exp of experiments) {
      const startAt = exp.statusUpdateSchedule?.startAt
        ? getValidDate(exp.statusUpdateSchedule.startAt)
        : null;
      if (startAt && startAt > now) {
        experimentsToApproveSchedule.push(exp);
      } else {
        startNowExperiments.push(exp);
      }
    }

    for (const experiment of startNowExperiments) {
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

    // Permission gate for scheduled-approval bucket — mirrors the check in
    // approveScheduledExperimentStart so the request fails before we publish
    // the feature revision instead of after.
    for (const experiment of experimentsToApproveSchedule) {
      if (!context.permissions.canUpdateExperiment(experiment, {})) {
        context.permissions.throwPermissionError();
      }
      const linkedFeatures = await getFeaturesByIds(
        context,
        experiment.linkedFeatures || [],
      );
      const schedEnvs = getAffectedEnvsForExperiment({
        experiment,
        orgEnvironments: context.org.settings?.environments || [],
        linkedFeatures,
      });
      if (
        schedEnvs.length > 0 &&
        !context.permissions.canRunExperiment(experiment, schedEnvs)
      ) {
        context.permissions.throwPermissionError();
      }
    }

    // Pre-flight: check for merge conflicts in OTHER pending feature drafts
    // for each experiment being started immediately. Scheduled-approval
    // experiments defer the pending-draft publish to the agenda job, which
    // runs its own merge check at start time.
    for (const experiment of startNowExperiments) {
      const otherDrafts = (experiment.pendingFeatureDrafts ?? []).filter(
        (d) => d.featureId !== feature.id,
      );
      for (const { featureId, revisionVersion } of otherDrafts) {
        const otherFeature = await getFeature(context, featureId);
        if (!otherFeature) continue;
        const otherRevision = await getRevision({
          context,
          organization: otherFeature.organization,
          featureId: otherFeature.id,
          feature: otherFeature,
          version: revisionVersion,
        });
        if (
          !otherRevision ||
          otherRevision.status === "published" ||
          otherRevision.status === "discarded"
        )
          continue;
        const { live, base } = await getLiveAndBaseRevisionsForFeature({
          context,
          feature: otherFeature,
          revision: otherRevision,
        });
        const otherMerge = autoMerge(
          liveRevisionFromFeature(live, otherFeature),
          fillRevisionFromFeature(base, otherFeature),
          otherRevision,
          environmentIds,
          {},
        );
        if (!otherMerge.success) {
          throw new Error(
            `Feature "${otherFeature.id}" has a merge conflict in its pending draft. Resolve the conflict before starting experiment "${experiment.name}".`,
          );
        }
        // Prevalidate custom hooks for the other draft before the current feature publishes below
        if (mergeResultHasChanges(otherMerge)) {
          await prevalidatePublishRevision({
            context,
            feature: otherFeature,
            revision: otherRevision,
            result: otherMerge.result,
            comment: `Experiment "${experiment.name}" started`,
          });
        }
      }
    }
  }

  const updatedFeature = await publishRevision({
    context,
    feature,
    revision,
    result: mergeResult.result,
    comment,
    bypassLockdown:
      !!adminOverride && context.permissions.canBypassApprovalChecks(feature),
  });

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

  const publishedRevision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  await dispatchFeatureRevisionEvent(
    context,
    updatedFeature,
    publishedRevision ?? revision,
    "revision.published",
    {},
  );

  for (const { experiment, changes } of experimentsToUpdate) {
    // Reload so pendingFeatureDrafts reflects the just-published feature.
    const reloadedExp =
      (await getExperimentById(context, experiment.id)) ?? experiment;

    // Publish remaining pending drafts (other linked features). Abort if any
    // fail — mirrors the blocking behavior of postExperimentStatus.
    //
    // Residual exposure: the current feature is already live by this point.
    // Phase-1 pre-flight above caught merge conflicts, approval gaps, and
    // custom-hook rejections for the OTHER drafts, so the remaining failure
    // modes here are transient infra errors and re-rejects after state shifts.
    // Throwing aborts the experiment status transition; the already-published
    // current feature stays live. Closing this gap fully would require cross-
    // collection transactions.
    const adminBypass =
      !!adminOverride && context.permissions.canBypassApprovalChecks(feature);
    const publishResult: PendingDraftPublishResult =
      await publishPendingFeatureDraftsForExperiment(
        context,
        reloadedExp,
        adminBypass,
      );
    if (publishResult.failed.length > 0) {
      throw new Error(formatPendingDraftFailureMessage(publishResult.failed));
    }

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

  // Approve scheduled starts for experiments whose `statusUpdateSchedule.startAt`
  // is in the future. The agenda job will publish their other pending feature
  // drafts and transition the experiment to running when the scheduled time
  // is reached, so we intentionally don't call publishPendingFeatureDraftsForExperiment
  // here.
  for (const experiment of experimentsToApproveSchedule) {
    const { updated } = await approveScheduledExperimentStart({
      context,
      experimentId: experiment.id,
      skipChecklist: true,
    });

    await req.audit({
      event: "experiment.update",
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
  req: AuthRequest<{ comment?: string }, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { org, environments: contextEnvironments } = context;
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
    feature,
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

  // Intentionally no assertRegisteredAttributes() call here — reverting
  // restores a previously-published state as-is, which may reference
  // attributes that have since been archived or removed.

  // Heal pre-revert drift so the diff against `revision` reflects the true
  // live state. Without this, a feature stuck at an older version's rules
  // (e.g. via the legacy env.rules JIT-migration shadow) can make the
  // requested revision look identical to live and short-circuit the revert.
  const liveRevisionForRepair = await getLiveRevisionForFeature(
    context,
    feature,
  );
  await repairFeatureDriftIfNeeded(
    context,
    feature,
    liveRevisionForRepair,
    environmentIds,
    { throwOnFailure: true },
  );

  // Compute the diff (what actually changes on the feature doc) and check publish permissions per-change.
  const mergeChanges: MergeResultChanges = {};
  const allEnabledEnvs = Array.from(
    getEnabledEnvironments(feature, environmentIds),
  );

  if (revision.defaultValue !== feature.defaultValue) {
    if (!context.permissions.canPublishFeature(feature, allEnabledEnvs)) {
      context.permissions.throwPermissionError();
    }
    mergeChanges.defaultValue = revision.defaultValue;
  }

  // Diff per-env projections for permission checks. Any env diff publishes
  // the revision's full flat rules array.
  const revRules: FeatureRule[] = revision.rules ?? [];
  const liveRules: FeatureRule[] = feature.rules ?? [];
  const changedEnvs: string[] = [];
  let anyRulesChanged = false;
  environmentIds.forEach((env) => {
    const revSlice = getRulesForEnvironment(revRules, env);
    const liveSlice = getRulesForEnvironment(liveRules, env);
    if (!isEqual(revSlice, liveSlice)) {
      changedEnvs.push(env);
      anyRulesChanged = true;
    }

    // Kill switches — sparse: only revert if this revision explicitly set them
    if (
      revision.environmentsEnabled !== undefined &&
      env in revision.environmentsEnabled
    ) {
      const revEnabled = revision.environmentsEnabled[env];
      const liveEnabled = feature.environmentSettings?.[env]?.enabled ?? false;
      if (revEnabled !== liveEnabled) {
        if (!changedEnvs.includes(env)) changedEnvs.push(env);
        mergeChanges.environmentsEnabled =
          mergeChanges.environmentsEnabled || {};
        mergeChanges.environmentsEnabled[env] = revEnabled;
      }
    }
  });
  if (anyRulesChanged) {
    mergeChanges.rules = revRules;
  }
  if (changedEnvs.length > 0) {
    if (!context.permissions.canPublishFeature(feature, changedEnvs)) {
      context.permissions.throwPermissionError();
    }
  }

  // Prerequisites — sparse: only revert if this revision explicitly set them
  if (
    revision.prerequisites !== undefined &&
    !isEqual(revision.prerequisites, feature.prerequisites || [])
  ) {
    if (!context.permissions.canPublishFeature(feature, allEnabledEnvs)) {
      context.permissions.throwPermissionError();
    }
    mergeChanges.prerequisites = revision.prerequisites;
  }

  // Archived state — sparse: only revert if this revision explicitly changed it
  if (
    revision.archived !== undefined &&
    revision.archived !== (feature.archived ?? false)
  ) {
    if (!context.permissions.canPublishFeature(feature, allEnabledEnvs)) {
      context.permissions.throwPermissionError();
    }
    mergeChanges.archived = revision.archived;
  }

  // Metadata — sparse: revert only the fields this revision explicitly changed
  if (revision.metadata) {
    const metadataChanges: RevisionMetadata = {};
    let hasMetadataChanges = false;
    const m = revision.metadata;
    if (
      m.description !== undefined &&
      m.description !== (feature.description ?? "")
    ) {
      metadataChanges.description = m.description;
      hasMetadataChanges = true;
    }
    if (m.owner !== undefined && m.owner !== (feature.owner ?? "")) {
      metadataChanges.owner = m.owner;
      hasMetadataChanges = true;
    }
    if (m.project !== undefined && m.project !== (feature.project ?? "")) {
      metadataChanges.project = m.project;
      hasMetadataChanges = true;
    }
    if (m.tags !== undefined && !isEqual(m.tags, feature.tags ?? [])) {
      metadataChanges.tags = m.tags;
      hasMetadataChanges = true;
    }
    if (m.neverStale !== undefined && m.neverStale !== feature.neverStale) {
      metadataChanges.neverStale = m.neverStale;
      hasMetadataChanges = true;
    }
    if (
      m.customFields !== undefined &&
      !isEqual(m.customFields, feature.customFields ?? {})
    ) {
      metadataChanges.customFields = m.customFields;
      hasMetadataChanges = true;
    }
    if (
      m.jsonSchema !== undefined &&
      !isEqual(m.jsonSchema, feature.jsonSchema)
    ) {
      metadataChanges.jsonSchema = m.jsonSchema;
      hasMetadataChanges = true;
    }
    if (hasMetadataChanges) {
      if (!context.permissions.canPublishFeature(feature, allEnabledEnvs)) {
        context.permissions.throwPermissionError();
      }
      mergeChanges.metadata = metadataChanges;
    }
  }

  // No diff against live — refuse before creating an empty "Locked" revision.
  if (Object.keys(mergeChanges).length === 0) {
    throw new Error(
      `Nothing to revert: the live feature already matches revision #${revision.version}.`,
    );
  }

  // Flag restored values the current schema/value-type can no longer read as a
  // bypassable soft warning. Runs before createRevision so a blocked attempt
  // leaves no orphaned draft.
  const valueWarnings = getRevertValueValidationWarnings(feature, mergeChanges);
  if (valueWarnings.length && !context.ignoreWarnings) {
    throw new SoftWarningError(
      "Reverting to this revision restores values that no longer pass validation:\n" +
        valueWarnings.join("\n"),
      valueWarnings,
    );
  }

  // Build the full state of the target revision for the new revision document.
  // Sparse legacy revisions fall back to the feature's own rules.
  const revisionChanges: Partial<FeatureRevisionInterface> = {
    defaultValue: revision.defaultValue,
    rules: revision.rules ?? feature.rules ?? [],
  };
  if (revision.environmentsEnabled !== undefined) {
    revisionChanges.environmentsEnabled = revision.environmentsEnabled;
  }
  if (revision.prerequisites !== undefined) {
    revisionChanges.prerequisites = revision.prerequisites;
  }
  if (revision.archived !== undefined) {
    revisionChanges.archived = revision.archived;
  }
  if (revision.metadata !== undefined) {
    revisionChanges.metadata = revision.metadata;
  }
  // Holdout intentionally excluded: changes require the dedicated updateHoldout
  // flow (side effects + guards), and the field is sparse in revisions so
  // absent !== "no holdout".

  const newRevision = await createRevision({
    context,
    feature,
    user: res.locals.eventAudit,
    baseVersion: feature.version,
    changes: revisionChanges,
    environments: contextEnvironments,
    org,
    comment: comment || `Revert to revision #${revision.version}`,
  });

  // Reverts restore a previously-published (already-reviewed) state. When the
  // org enables "reverts bypass approval", any publisher may publish a revert
  // without approval — publish perms were already enforced per-change above.
  const revertBypass =
    context.permissions.canBypassApprovalChecks(feature) ||
    !!org.settings?.revertsBypassApproval;
  if (!revertBypass) {
    await assertCanAutoPublish(context, feature, newRevision);
  }
  const updatedFeature = await publishRevision({
    context,
    feature,
    revision: newRevision,
    result: mergeChanges,
    bypassLockdown: revertBypass,
  });

  await req.audit({
    event: "feature.revert",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: newRevision.version,
    }),
  });

  await dispatchFeatureRevisionEvent(
    context,
    updatedFeature,
    newRevision,
    "revision.reverted",
    { revertedToVersion: revision.version },
  );

  res.status(200).json({
    status: 200,
    version: newRevision.version,
  });
}

// Creates a draft that, when published, reverts the feature to the state of a previously-published revision.
export async function postFeatureRevertDraft(
  req: AuthRequest<{ comment?: string }, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { org, environments: contextEnvironments } = context;
  const { id, version } = req.params;
  const { comment } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (revision.version === feature.version || revision.status !== "published") {
    throw new Error(
      "Can only create a revert draft for previously published revisions",
    );
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  // Build changes representing the full state of the target revision.
  // Sparse legacy revisions fall back to the feature's own rules.
  const changes: Partial<FeatureRevisionInterface> = {
    defaultValue: revision.defaultValue,
    rules: revision.rules ?? feature.rules ?? [],
  };

  if (revision.environmentsEnabled !== undefined) {
    changes.environmentsEnabled = revision.environmentsEnabled;
  }
  if (revision.prerequisites !== undefined) {
    changes.prerequisites = revision.prerequisites;
  }
  if (revision.archived !== undefined) {
    changes.archived = revision.archived;
  }
  if (revision.metadata !== undefined) {
    changes.metadata = revision.metadata;
  }

  const newRevision = await createRevision({
    context,
    feature,
    user: res.locals.eventAudit,
    baseVersion: feature.version,
    changes,
    environments: contextEnvironments,
    org,
    comment: comment || `Revert to revision #${revision.version}`,
  });

  await req.audit({
    event: "feature.update",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, feature, {
      revision: newRevision.version,
    }),
  });

  res.status(200).json({
    status: 200,
    version: newRevision.version,
  });
}

export async function postFeatureFork(
  req: AuthRequest<never, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
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
    feature,
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

  res.status(200).json({
    status: 200,
    version: newRevision.version,
  });
}

export async function postFeatureDiscard(
  req: AuthRequest<never, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>,
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
    feature,
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
  await clearPendingFeatureDraftsForRevision(
    context,
    feature.id,
    revision.version,
    revision.rules,
  );

  const discarded = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  const finalRevision = discarded ?? revision;

  void req
    .audit({
      event: "feature.revision.discard",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(
        { status: revision.status },
        { status: finalRevision.status },
        { version: revision.version },
      ),
    })
    .catch((e) =>
      logger.error(e, "Failed to write audit log for revision.discard"),
    );

  await dispatchFeatureRevisionEvent(
    context,
    feature,
    finalRevision,
    "revision.discarded",
    {},
  );

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureReopen(
  req: AuthRequest<never, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>,
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
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (revision.status !== "discarded") {
    throw new Error(`Can only reopen discarded revisions`);
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  await reopenRevision(context, revision, res.locals.eventAudit);

  const reopened = await getRevision({
    context,
    organization: org.id,
    featureId: feature.id,
    feature,
    version: parseInt(version),
  });
  const finalRevision = reopened ?? revision;

  void req
    .audit({
      event: "feature.revision.reopen",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(
        { status: revision.status },
        { status: finalRevision.status },
        { version: revision.version },
      ),
    })
    .catch((e) =>
      logger.error(e, "Failed to write audit log for revision.reopen"),
    );

  await dispatchFeatureRevisionEvent(
    context,
    feature,
    finalRevision,
    "revision.reopened",
    {},
  );

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureRule(
  req: AuthRequest<PostFeatureRuleBody, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const {
    environments: selectedEnvironments = [],
    rule,
    safeRolloutFields,
    rampSchedule: rampSchedulePayload,
  } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  selectedEnvironments.forEach((env) => {
    if (!environmentIds.includes(env)) {
      throw new Error("Invalid environment");
    }
  });

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  // Opt-in attribute registration check before any side effects (safe-rollout
  // create, holdout linking, revision update).
  assertRegisteredAttributes(
    context,
    {
      hashAttribute: (rule as { hashAttribute?: string }).hashAttribute,
      fallbackAttribute: (rule as { fallbackAttribute?: string })
        .fallbackAttribute,
      condition: rule.condition,
    },
    "rule",
    undefined,
    feature.project,
  );

  // Pre-generate the safeRollout id so hooks see the rule's final shape; the doc is created after prevalidation
  let validatedSafeRolloutFields: Awaited<
    ReturnType<typeof validateCreateSafeRolloutFields>
  > | null = null;
  if (rule.type === "safe-rollout") {
    if (!context.hasPremiumFeature("safe-rollout")) {
      throw new Error(`Safe Rollout rules is a premium feature.`);
    }

    validatedSafeRolloutFields = await validateCreateSafeRolloutFields(
      omit(safeRolloutFields, "rampUpSchedule"),
      context,
    );

    rule.status = "running";
    rule.seed = rule.seed || uuidv4();
    rule.trackingKey =
      rule.trackingKey || `${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}${uuidv4()}`;
    rule.safeRolloutId = generateId("sr_");
  }

  // Add holdout to existing experiment and experiment to holdout linkedExperiments
  // if the experiment is not running and has no linked implementations for
  // experiment-ref rules (writes deferred until after custom-hook prevalidation)
  let holdoutExperimentToLink: ExperimentInterface | null = null;
  if (rule.type === "experiment-ref" && feature.holdout?.id) {
    const experiment = await getExperimentById(context, rule.experimentId);

    if (experiment?.status !== "draft") {
      throw new Error(
        `Cannot add experiment rule: this feature uses a holdout, so the experiment must be in "draft" status (currently "${experiment?.status ?? "unknown"}").`,
      );
    }
    const expHasLinkedChanges =
      (experiment.linkedFeatures?.length ?? 0) > 0 ||
      experiment.hasURLRedirects ||
      experiment.hasVisualChangesets;
    if (expHasLinkedChanges) {
      throw new Error(
        `Cannot add experiment rule: this feature uses a holdout, but the experiment already has linked features, URL redirects, or visual changesets. Unlink them first.`,
      );
    }
    if (experiment.holdoutId && experiment.holdoutId !== feature.holdout.id) {
      const featureHoldout = await context.models.holdout.getById(
        feature.holdout.id,
      );
      const expHoldout = experiment.holdoutId
        ? await context.models.holdout.getById(experiment.holdoutId)
        : null;
      throw new Error(
        `Cannot add experiment rule: experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}" but this feature uses holdout "${featureHoldout?.name || feature.holdout.id}".`,
      );
    }

    if (!experiment.holdoutId) {
      holdoutExperimentToLink = experiment;
    }
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: selectedEnvironments,
    defaultValueChanged: false,
    settings: org?.settings,
  });

  // Assign rule ID if not present
  if (!rule.id) {
    rule.id = generateRuleId();
  }
  // Rollout rules always carry an explicit seed (= rule.id when user didn't set
  // one) so monitored and non-monitored steps bucket users identically.
  if (rule.type === "rollout" && !rule.seed) {
    rule.seed = rule.id;
  }
  let rampActionsUpdate:
    | RevisionRampCreateAction
    | RevisionRampDetachAction
    | undefined;
  if (
    rampSchedulePayload &&
    (rule.type === "rollout" || rule.type === "force") &&
    rule.id
  ) {
    if (rampSchedulePayload.mode === "create") {
      const createAction: RevisionRampCreateAction = {
        mode: "create",
        name: rampSchedulePayload.name,
        steps: (rampSchedulePayload.steps ?? []).map(
          (s: {
            interval?: number | null;
            actions?: unknown[];
            approvalNotes?: string | null;
            monitored?: boolean;
            holdConditions?: Record<string, unknown>;
          }) => ({
            interval: s.interval ?? null,
            actions: (s.actions ?? []).map((a: unknown) =>
              normalizeRampStepAction(a as { patch: Record<string, unknown> }),
            ),
            approvalNotes: s.approvalNotes ?? undefined,
            monitored: !!s.monitored,
            holdConditions: s.holdConditions as
              | RevisionRampCreateAction["steps"][number]["holdConditions"]
              | undefined,
          }),
        ),
        startActions: rampSchedulePayload.startActions?.map((a: unknown) =>
          normalizeRampStepAction(a as { patch: Record<string, unknown> }),
        ),
        endActions: rampSchedulePayload.endActions?.map((a: unknown) =>
          normalizeRampStepAction(a as { patch: Record<string, unknown> }),
        ),
        startDate:
          rampSchedulePayload.startDate as RevisionRampCreateAction["startDate"],
        cutoffDate: rampSchedulePayload.cutoffDate,
        monitoringConfig: rampSchedulePayload.monitoringConfig,
        lockdownConfig: rampSchedulePayload.lockdownConfig,
        requiresStartApproval: rampSchedulePayload.requiresStartApproval,
        ruleId: rule.id,
      };
      rampActionsUpdate = createAction;
    } else if (rampSchedulePayload.mode === "detach") {
      const existingActions = revision.rampActions ?? [];
      const hasPendingCreate = existingActions.some(
        (a) => a.mode === "create" && a.ruleId === rule.id,
      );
      if (!hasPendingCreate) {
        const detachAction: RevisionRampDetachAction = {
          mode: "detach",
          rampScheduleId: rampSchedulePayload.rampScheduleId,
          ruleId: rule.id,
          deleteScheduleWhenEmpty: rampSchedulePayload.deleteScheduleWhenEmpty,
        };
        rampActionsUpdate = detachAction;
      }
    }
  }

  // Honor a client-supplied `allEnvironments: true`; otherwise stamp the
  // rule with the explicit env list. Without this, "All environments"
  // selections were being saved as a discrete `environments[]` snapshot,
  // freezing the rule against future env additions.
  const existingRules = cloneDeep(revision.rules ?? []);
  const stampedRule: FeatureRule =
    rule.allEnvironments === true
      ? ({
          ...omit(rule, ["environments"]),
          allEnvironments: true,
        } as FeatureRule)
      : stampRuleForEnvs(rule, selectedEnvironments);
  const ruleAdditionChanges = {
    rules: [...existingRules, stampedRule],
  };

  const combinedChanges: Record<string, unknown> = ruleAdditionChanges;
  if (rampActionsUpdate) {
    const existingActions = revision.rampActions ?? [];
    const filtered = existingActions.filter(
      (a) =>
        !(
          (a.mode === "create" && a.ruleId === rampActionsUpdate!.ruleId) ||
          (a.mode === "detach" && a.ruleId === rampActionsUpdate!.ruleId)
        ),
    );
    combinedChanges.rampActions = [...filtered, rampActionsUpdate];
  }

  // Run custom hooks before the side-effect writes below so a rejection doesn't orphan them
  await prevalidateRevisionUpdate(
    context,
    feature,
    revision,
    combinedChanges,
    resetReview,
  );

  if (rule.type === "safe-rollout" && validatedSafeRolloutFields) {
    const safeRollout = await context.models.safeRollout.create({
      id: rule.safeRolloutId,
      ...validatedSafeRolloutFields,
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
  }

  if (holdoutExperimentToLink && feature.holdout?.id) {
    await updateExperiment({
      context,
      experiment: holdoutExperimentToLink,
      changes: {
        holdoutId: feature.holdout.id,
      },
    });
    const holdout = await context.models.holdout.getById(feature.holdout.id);
    await context.models.holdout.updateById(feature.holdout.id, {
      linkedExperiments: {
        ...holdout?.linkedExperiments,
        [holdoutExperimentToLink.id]: {
          id: holdoutExperimentToLink.id,
          dateAdded: new Date(),
        },
      },
    });
  }

  const auditSubject =
    rule.allEnvironments === true
      ? "to all environments"
      : `to ${selectedEnvironments.join(", ")}`;
  const updatedRevisionAfterRuleAdd = await updateRevision(
    context,
    feature,
    revision,
    combinedChanges,
    {
      user: res.locals.eventAudit,
      action: "add rule" + (rampActionsUpdate ? " with ramp schedule" : ""),
      subject: auditSubject,
      value: JSON.stringify(rule),
    },
    resetReview,
  );
  await recordRevisionUpdate(
    context,
    feature,
    updatedRevisionAfterRuleAdd ?? revision,
    "rule.add",
    { environments: selectedEnvironments },
  );

  if (rule.type === "experiment-ref") {
    // Ensure both sides of the linkage are populated.
    if (!feature.linkedExperiments?.includes(rule.experimentId)) {
      await addLinkedFeatureToExperiment(
        context,
        rule.experimentId,
        feature.id,
      );
      await addLinkedExperiment(feature, rule.experimentId);
    }
    // Queue the draft for auto-publish when the experiment goes running.
    const draftVersion =
      updatedRevisionAfterRuleAdd?.version ?? revision.version;
    await addPendingFeatureDraftToExperiment(
      context,
      rule.experimentId,
      feature.id,
      draftVersion,
    );
  }

  res.status(200).json({
    status: 200,
    version: updatedRevisionAfterRuleAdd?.version ?? revision.version,
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
  >,
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
      "Must have at least one environment configured to use Feature Flags",
    );
  }

  const data = req.body;

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environments)),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  if (data.valueType && data.valueType !== feature.valueType) {
    throw new Error(
      "Cannot change valueType of feature after it's already been created.",
    );
  }

  const updates: Partial<FeatureInterface> = {
    description: data.description ?? feature.description,
    owner: data.owner ?? feature.owner,
    tags: data.tags ?? feature.tags,
  };
  const updatesInRevision: Partial<FeatureInterface> = {};

  // The Sync endpoint accepts per-env rule arrays under
  // `environmentSettings[env].rules`. Produce a flat array with unique ids by
  // narrowing live rules to the envs the caller did NOT override, then
  // appending the caller's inbound rules stamped per env. A naive per-env
  // fan-out would duplicate `allEnvironments: true` rules across envs.
  const liveFeatureRules: FeatureRule[] = feature.rules ?? [];
  const envSettingsIn = data.environmentSettings as
    | Record<string, { rules?: FeatureRule[] }>
    | undefined;
  const inboundEnvs = new Set<string>(
    environments.filter((e) => envSettingsIn?.[e]?.rules !== undefined),
  );

  const buildNextFlatRules = (): FeatureRule[] => {
    const result: FeatureRule[] = [];

    for (const r of liveFeatureRules) {
      // Env subset of this rule NOT replaced by an inbound per-env override.
      let remainingEnvs: string[];
      if (r.allEnvironments) {
        remainingEnvs = environments.filter((e) => !inboundEnvs.has(e));
        if (remainingEnvs.length === 0) continue;
        if (remainingEnvs.length === environments.length) {
          result.push(r);
          continue;
        }
      } else {
        remainingEnvs = (r.environments ?? []).filter(
          (e) => !inboundEnvs.has(e),
        );
        if (remainingEnvs.length === 0) continue;
      }
      result.push({
        ...r,
        allEnvironments: false,
        environments: remainingEnvs,
      });
    }

    // Append inbound rules for overridden envs, each stamped to a single env.
    environments.forEach((env) => {
      const inbound = envSettingsIn?.[env]?.rules;
      if (inbound === undefined) return;
      inbound.forEach((r) =>
        result.push({
          ...r,
          allEnvironments: false,
          environments: [env],
        } as FeatureRule),
      );
    });

    return result;
  };
  const nextFlatRules = buildNextFlatRules();
  const changes: Pick<FeatureRevisionInterface, "rules" | "defaultValue"> = {
    rules: nextFlatRules,
    defaultValue: data.defaultValue ?? feature.defaultValue,
  };

  let needsNewRevision = false;

  if (
    data.defaultValue != null &&
    !isEqual(feature.defaultValue, data.defaultValue)
  ) {
    updatesInRevision.defaultValue = data.defaultValue;
    needsNewRevision = true;
  }

  environments.forEach((env) => {
    // envSettings tracks the kill switch only; rules flow via changes.rules.
    updatesInRevision.environmentSettings =
      updatesInRevision.environmentSettings || {};
    updatesInRevision.environmentSettings[env] = updatesInRevision
      .environmentSettings[env] || {
      enabled: feature.environmentSettings?.[env]?.enabled ?? false,
    };

    const inboundEnvRules = (
      data.environmentSettings as
        | Record<string, { rules?: FeatureRule[] }>
        | undefined
    )?.[env]?.rules;
    if (
      inboundEnvRules !== undefined &&
      !isEqual(inboundEnvRules, getRulesForEnvironment(liveFeatureRules, env))
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

    if (revision.status === "published") {
      updates.version = revision.version;
      Object.assign(updates, updatesInRevision);
    }
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

// Bundles an experiment-ref rule + the env kill-switch toggles needed to make
// it applicable into one revision. Default leaves a draft and records it on
// the experiment for auto-publish on `status -> running`; `autoPublish`
// publishes immediately when permitted.
export async function postFeatureExperimentRefRule(
  req: AuthRequest<
    {
      rule: ExperimentRefRule;
      autoPublish?: boolean;
      draftVersion?: number;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; version: number; published: boolean },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { org, environments } = context;
  const { id } = req.params;
  const { rule, autoPublish, draftVersion, forceNewDraft } = req.body;

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
      "Must have at least one environment configured to use Feature Flags",
    );
  }

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

  const experiment = await getExperimentById(context, rule.experimentId);
  if (!experiment) {
    throw new Error("Invalid experiment selected");
  }

  // allEnvironments:true strips any stale environments[]; false passes the
  // explicit list through. Legacy callers that send neither default to every
  // applicable org env.
  let scopedRule: FeatureRule;
  if (rule.allEnvironments === true) {
    scopedRule = {
      ...omit(rule, ["environments"]),
      id: generateRuleId(),
      allEnvironments: true,
    } as FeatureRule;
  } else if (
    rule.allEnvironments === false &&
    Array.isArray(rule.environments)
  ) {
    scopedRule = { ...rule, id: generateRuleId() } as FeatureRule;
  } else {
    scopedRule = stampRuleForEnvs(
      { ...rule, id: generateRuleId() } as FeatureRule,
      environments,
    );
  }

  const ruleEnvFootprint = scopedRule.allEnvironments
    ? environments
    : (scopedRule.environments ?? []);

  if (!context.permissions.canPublishFeature(feature, ruleEnvFootprint)) {
    context.permissions.throwPermissionError();
  }

  // autoPublish always starts from live so the merge stays clean.
  const targetVersion = autoPublish
    ? feature.version
    : forceNewDraft
      ? feature.version
      : (draftVersion ?? feature.version);
  const revision = await getDraftRevision(context, feature, targetVersion);

  // One-way: any rule-footprint env that's currently off flips on. We never
  // turn envs off here.
  const baseEnvEnabled: Record<string, boolean> = {
    ...Object.fromEntries(
      environments.map((e) => [
        e,
        feature.environmentSettings?.[e]?.enabled ?? false,
      ]),
    ),
    ...(revision.environmentsEnabled ?? {}),
  };
  const envToggles: Record<string, boolean> = {};
  for (const envId of ruleEnvFootprint) {
    if (!environments.includes(envId)) continue;
    if (!baseEnvEnabled[envId]) envToggles[envId] = true;
  }

  const existingRules = cloneDeep(revision.rules ?? []);
  const nextRules = [...existingRules, scopedRule];

  const combinedChanges: Partial<FeatureRevisionInterface> = {
    rules: nextRules,
  };
  if (Object.keys(envToggles).length > 0) {
    combinedChanges.environmentsEnabled = {
      ...(revision.environmentsEnabled ?? {}),
      ...envToggles,
    };
  }
  // Title fresh drafts only — don't clobber a user's title on an existing draft.
  const bundlingIntoExistingDraft =
    !!draftVersion && !forceNewDraft && !autoPublish;
  if (!bundlingIntoExistingDraft && !revision.title) {
    combinedChanges.title =
      experiment.type === "multi-armed-bandit"
        ? "Publish bandit"
        : "Publish experiment";
  }

  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: ruleEnvFootprint,
    defaultValueChanged: false,
    settings: org?.settings,
  });
  const auditSubject = scopedRule.allEnvironments
    ? "to all environments"
    : `to ${ruleEnvFootprint.join(", ") || "no environments"}`;
  const updatedRevision =
    (await updateRevision(
      context,
      feature,
      revision,
      combinedChanges,
      {
        user: res.locals.eventAudit,
        action: "add experiment rule",
        subject: auditSubject,
        value: JSON.stringify(scopedRule),
      },
      resetReview,
    )) ?? revision;
  await recordRevisionUpdate(context, feature, updatedRevision, "rule.add", {
    environments: ruleEnvFootprint,
  });

  let published = false;
  if (autoPublish) {
    await assertCanAutoPublish(context, feature, updatedRevision);
    const { live, base } = await getLiveAndBaseRevisionsForFeature({
      context,
      feature,
      revision: updatedRevision,
    });
    const orgEnvIds = environments;
    const mergeResult = autoMerge(live, base, updatedRevision, orgEnvIds, {});
    if (!mergeResult.success) {
      throw new Error(
        `Unable to auto-publish: please resolve conflicts on draft #${updatedRevision.version} before publishing.`,
      );
    }
    const updatedFeature = await publishRevision({
      context,
      feature,
      revision: updatedRevision,
      result: mergeResult.result,
      comment: `Add experiment rule for "${experiment.name}"`,
      bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
    });
    await req.audit({
      event: "feature.publish",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(feature, updatedFeature, {
        revision: updatedRevision.version,
        comment: `Add experiment rule for "${experiment.name}"`,
      }),
    });
    published = true;
  } else {
    // Queue the draft for auto-publish on `status -> running`.
    await addPendingFeatureDraftToExperiment(
      context,
      rule.experimentId,
      feature.id,
      updatedRevision.version,
    );
  }

  if (!feature.linkedExperiments?.includes(experiment.id)) {
    await addLinkedExperiment(feature, experiment.id);
  }
  await addLinkedFeatureToExperiment(
    context,
    rule.experimentId,
    feature.id,
    experiment,
  );

  res.status(200).json({
    status: 200,
    version: updatedRevision.version,
    published,
  });
}

export async function postFeatureContextualBanditRefRule(
  req: AuthRequest<
    {
      rule: ContextualBanditRefRule;
      autoPublish?: boolean;
      draftVersion?: number;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; version: number; published: boolean },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { org, environments } = context;
  const { id } = req.params;
  const { rule, autoPublish, draftVersion, forceNewDraft } = req.body;

  if (
    rule.type !== "contextual-bandit-ref" ||
    !rule.contextualBanditId ||
    !rule.variations ||
    !rule.variations.length
  ) {
    throw new Error("Invalid contextual bandit rule");
  }

  if (!environments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags",
    );
  }

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

  const contextualBandit = await context.models.contextualBandits.getById(
    rule.contextualBanditId,
  );
  if (!contextualBandit) {
    throw new Error("Invalid contextual bandit selected");
  }

  let scopedRule: FeatureRule;
  if (rule.allEnvironments === true) {
    scopedRule = {
      ...omit(rule, ["environments"]),
      id: generateRuleId(),
      allEnvironments: true,
    } as FeatureRule;
  } else if (
    rule.allEnvironments === false &&
    Array.isArray(rule.environments)
  ) {
    scopedRule = { ...rule, id: generateRuleId() } as FeatureRule;
  } else {
    scopedRule = stampRuleForEnvs(
      { ...rule, id: generateRuleId() } as FeatureRule,
      environments,
    );
  }

  const ruleEnvFootprint = scopedRule.allEnvironments
    ? environments
    : (scopedRule.environments ?? []);

  if (!context.permissions.canPublishFeature(feature, ruleEnvFootprint)) {
    context.permissions.throwPermissionError();
  }

  const targetVersion = autoPublish
    ? feature.version
    : forceNewDraft
      ? feature.version
      : (draftVersion ?? feature.version);
  const revision = await getDraftRevision(context, feature, targetVersion);

  const baseEnvEnabled: Record<string, boolean> = {
    ...Object.fromEntries(
      environments.map((e) => [
        e,
        feature.environmentSettings?.[e]?.enabled ?? false,
      ]),
    ),
    ...(revision.environmentsEnabled ?? {}),
  };
  const envToggles: Record<string, boolean> = {};
  for (const envId of ruleEnvFootprint) {
    if (!environments.includes(envId)) continue;
    if (!baseEnvEnabled[envId]) envToggles[envId] = true;
  }

  const existingRules = cloneDeep(revision.rules ?? []);
  const nextRules = [...existingRules, scopedRule];

  const combinedChanges: Partial<FeatureRevisionInterface> = {
    rules: nextRules,
  };
  if (Object.keys(envToggles).length > 0) {
    combinedChanges.environmentsEnabled = {
      ...(revision.environmentsEnabled ?? {}),
      ...envToggles,
    };
  }
  const bundlingIntoExistingDraft =
    !!draftVersion && !forceNewDraft && !autoPublish;
  if (!bundlingIntoExistingDraft && !revision.title) {
    combinedChanges.title = "Publish contextual bandit";
  }

  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: ruleEnvFootprint,
    defaultValueChanged: false,
    settings: org?.settings,
  });
  const auditSubject = scopedRule.allEnvironments
    ? "to all environments"
    : `to ${ruleEnvFootprint.join(", ") || "no environments"}`;
  const updatedRevision =
    (await updateRevision(
      context,
      feature,
      revision,
      combinedChanges,
      {
        user: res.locals.eventAudit,
        action: "add contextual bandit rule",
        subject: auditSubject,
        value: JSON.stringify(scopedRule),
      },
      resetReview,
    )) ?? revision;
  await recordRevisionUpdate(context, feature, updatedRevision, "rule.add", {
    environments: ruleEnvFootprint,
  });

  let published = false;
  if (autoPublish) {
    await assertCanAutoPublish(context, feature, updatedRevision);
    const { live, base } = await getLiveAndBaseRevisionsForFeature({
      context,
      feature,
      revision: updatedRevision,
    });
    const orgEnvIds = environments;
    const mergeResult = autoMerge(live, base, updatedRevision, orgEnvIds, {});
    if (!mergeResult.success) {
      throw new Error(
        `Unable to auto-publish: please resolve conflicts on draft #${updatedRevision.version} before publishing.`,
      );
    }
    const updatedFeature = await publishRevision({
      context,
      feature,
      revision: updatedRevision,
      result: mergeResult.result,
      comment: `Add contextual bandit rule for "${contextualBandit.name}"`,
      bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
    });
    await req.audit({
      event: "feature.publish",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(feature, updatedFeature, {
        revision: updatedRevision.version,
        comment: `Add contextual bandit rule for "${contextualBandit.name}"`,
      }),
    });
    published = true;
  } else {
    await context.models.contextualBandits.addPendingFeatureDraft(
      contextualBandit.id,
      feature.id,
      updatedRevision.version,
    );
  }

  if (!contextualBandit.linkedFeatures?.includes(feature.id)) {
    await context.models.contextualBandits.addLinkedFeature(
      contextualBandit.id,
      feature.id,
    );
  }

  res.status(200).json({
    status: 200,
    version: updatedRevision.version,
    published,
  });
}

export async function putRevisionComment(
  req: AuthRequest<{ comment: string }, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>,
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
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  const updatedRevisionAfterComment = await updateRevision(
    context,
    feature,
    revision,
    { comment },
    {
      user: res.locals.eventAudit,
      action: "edit comment",
      subject: "",
      value: JSON.stringify({ comment }),
    },
    false,
  );
  await recordRevisionUpdate(
    context,
    feature,
    updatedRevisionAfterComment ?? revision,
    "metadata",
  );

  res.status(200).json({
    status: 200,
  });
}

export async function putRevisionTitle(
  req: AuthRequest<{ title: string }, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { title } = req.body;

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
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  const updatedRevisionAfterTitle = await updateRevision(
    context,
    feature,
    revision,
    { title },
    {
      user: res.locals.eventAudit,
      action: "edit title",
      subject: "",
      value: JSON.stringify({ title }),
    },
    false,
  );
  await recordRevisionUpdate(
    context,
    feature,
    updatedRevisionAfterTitle ?? revision,
    "metadata",
  );

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureDefaultValue(
  req: AuthRequest<{ defaultValue: string }, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
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
  const updatedRevisionAfterDefaultValue = await setDefaultValue(
    context,
    feature,
    revision,
    defaultValue,
    res.locals.eventAudit,
    resetReview,
  );
  await recordRevisionUpdate(
    context,
    feature,
    updatedRevisionAfterDefaultValue ?? revision,
    "defaultValue",
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureSchema(
  req: AuthRequest<
    Omit<JSONSchemaDef, "date"> & {
      targetDraftVersion?: number;
      autoPublish?: boolean;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { targetDraftVersion, autoPublish, forceNewDraft, ...schemaDef } =
    req.body;
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

  assertSchemaMatchesValueType(schemaDef, feature.valueType);

  const jsonSchema: JSONSchemaDef = {
    ...schemaDef,
    date: new Date(),
  };
  const draft = await createOrUpdateDraftWithChanges(
    context,
    feature,
    { metadata: { jsonSchema } },
    {
      user: context.auditUser,
      action: "update",
      subject: "json schema",
      value: JSON.stringify({ schemaType: schemaDef.schemaType }),
    },
    autoPublish ? undefined : targetDraftVersion,
    autoPublish ? true : forceNewDraft,
    autoPublish ? "Update JSON schema" : undefined,
  );
  if (autoPublish) {
    await assertCanAutoPublish(context, feature, draft);
    await publishRevision({
      context,
      feature,
      revision: draft,
      result: { metadata: { jsonSchema } },
      bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
    });
  }
  return res.status(200).json({ status: 200, draftVersion: draft.version });
}

export async function putSafeRolloutStatus(
  req: AuthRequest<
    {
      status: SafeRolloutRule["status"];
      environment: string;
      ruleId: string;
    },
    { id: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  // `environment` is retained for audit context and reset-review scoping.
  const { status, environment, ruleId } = req.body;
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
    feature,
    revision,
    ruleId,
    { status },
    res.locals.eventAudit,
    resetReview,
    environment,
  );

  const { live, base } = await getLiveAndBaseRevisionsForFeature({
    context,
    feature,
    revision,
  });
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
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });
  if (!requiresReview) {
    const featureEnvs: Record<string, boolean> = Object.fromEntries(
      Object.entries(feature.environmentSettings ?? {}).map(([envId, env]) => [
        envId,
        env.enabled,
      ]),
    );
    const fillEnvs = (r: typeof live) => ({
      ...r,
      environmentsEnabled: { ...featureEnvs, ...(r.environmentsEnabled ?? {}) },
      holdout: feature.holdout ?? null,
    });
    const mergeResult = autoMerge(
      fillEnvs(live),
      fillEnvs(base),
      revision,
      environmentIds,
      {},
    );

    if (!mergeResult.success) {
      throw new Error("Please resolve conflicts before publishing");
    }

    // If changing the default value, it affects all enabled environments
    if (mergeResult.result.defaultValue !== undefined) {
      if (
        !context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, environmentIds)),
        )
      ) {
        context.permissions.throwPermissionError();
      }
    }
    // Otherwise, only the environments with rule changes are affected.
    // `mergeResult.result.rules`, when present, is the full merged flat v2
    // array; diff its per-env projection against the live baseline so
    // env-scoped publish permissions are checked only for envs whose
    // visible rule sequence actually changes.
    else if (mergeResult.result.rules !== undefined) {
      const liveRulesFlat = liveRevisionFromFeature(live, feature).rules ?? [];
      const mergedRules = mergeResult.result.rules;
      const changedEnvs = environmentIds.filter(
        (env) =>
          !isEqual(
            getRulesForEnvironment(liveRulesFlat, env),
            getRulesForEnvironment(mergedRules, env),
          ),
      );
      if (changedEnvs.length > 0) {
        if (!context.permissions.canPublishFeature(feature, changedEnvs)) {
          context.permissions.throwPermissionError();
        }
      }
    }
    const updatedFeature = await publishRevision({
      context,
      feature,
      revision,
      result: mergeResult.result,
      comment: "auto-publish status change",
      bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
    });

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
  }
  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function putFeatureRule(
  req: AuthRequest<PutFeatureRuleBody, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { rule, ruleId, rampSchedule: rampSchedulePayload } = req.body;

  if (!ruleId) {
    throw new Error("Must provide ruleId to identify the rule");
  }

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

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
      rule.safeRolloutId,
    );
    if (!existingSafeRollout) {
      throw new Error("Safe Rollout must exist");
    }

    const hasSafeRolloutStarted = existingSafeRollout.startedAt !== undefined;
    if (hasSafeRolloutStarted) {
      const existingRule = getSafeRolloutRuleFromFeature(
        feature,
        rule.safeRolloutId,
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
        ([k, v]) => !isEqual(existingRule[k as keyof SafeRolloutRule], v),
      );

      // Check if any of the fields that cannot be updated are being updated
      const fieldsBeingUpdatedThatCannotBeUpdated = fieldsBeingUpdated.filter(
        ([fieldName]) => fieldsThatCannotBeUpdated.includes(fieldName),
      );

      if (fieldsBeingUpdatedThatCannotBeUpdated.length > 0) {
        const fieldNames = fieldsBeingUpdatedThatCannotBeUpdated
          .map(([fieldName]) => fieldName)
          .join(", ");
        throw new Error(
          `Cannot update the following fields after a Safe Rollout has started: ${fieldNames}`,
        );
      }
    }
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));

  const existingRules = cloneDeep(revision.rules ?? []);
  let existingRule = existingRules.find((r) => r.id === ruleId);

  // Stale-draft case: the rule was published to live after this draft was
  // created (draft.baseVersion < the version where the rule was added), so
  // the draft never picked it up. The modal still surfaces the rule (it's in
  // feature.rules), so failing here surprises the user. Pull the live rule
  // into the draft so the edit applies; autoMerge will reconcile cleanly at
  // publish (live already has the rule with the same id).
  if (!existingRule) {
    const liveRule = (feature.rules ?? []).find((r) => r.id === ruleId);
    if (liveRule) {
      existingRules.push(cloneDeep(liveRule));
      existingRule = existingRules[existingRules.length - 1];
    }
  }

  if (!existingRule) throw new Error("Unknown rule");

  // Audit/review scope is the rule's own env scope.
  const ruleChangedEnvs: string[] =
    existingRule.allEnvironments || existingRule.environments === undefined
      ? environmentIds
      : (existingRule.environments ?? []);

  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: ruleChangedEnvs,
    defaultValueChanged: false,
    settings: org?.settings,
  });

  // Opt-in attribute registration check — only validate fields that actually
  // changed from the revision so pre-existing violations don't block unrelated edits.
  // v2 stores rules in a flat list keyed by id; `existingRule` (above) is the
  // pre-edit baseline for the same rule we're now patching.
  assertRegisteredAttributes(
    context,
    {
      hashAttribute: (rule as { hashAttribute?: string }).hashAttribute,
      fallbackAttribute: (rule as { fallbackAttribute?: string })
        .fallbackAttribute,
      condition: rule.condition,
    },
    "rule",
    {
      hashAttribute: (existingRule as { hashAttribute?: string }).hashAttribute,
      fallbackAttribute: (existingRule as { fallbackAttribute?: string })
        .fallbackAttribute,
      condition: existingRule.condition,
    },
    feature.project,
  );

  let rampActionsUpdate:
    | RevisionRampCreateAction
    | RevisionRampUpdateAction
    | RevisionRampDetachAction
    | undefined;
  if (rampSchedulePayload) {
    if (rampSchedulePayload.mode === "create") {
      const createAction: RevisionRampCreateAction = {
        mode: "create",
        name: rampSchedulePayload.name,
        steps: (rampSchedulePayload.steps ?? []).map(
          (s: {
            interval?: number | null;
            actions?: unknown[];
            approvalNotes?: string | null;
            monitored?: boolean;
            holdConditions?: Record<string, unknown>;
          }) => ({
            interval: s.interval ?? null,
            actions: (s.actions ?? []).map((a: unknown) =>
              normalizeRampStepAction(a as { patch: Record<string, unknown> }),
            ),
            approvalNotes: s.approvalNotes ?? undefined,
            monitored: !!s.monitored,
            holdConditions: s.holdConditions as
              | RevisionRampCreateAction["steps"][number]["holdConditions"]
              | undefined,
          }),
        ),
        startActions: rampSchedulePayload.startActions?.map((a: unknown) =>
          normalizeRampStepAction(a as { patch: Record<string, unknown> }),
        ),
        endActions: rampSchedulePayload.endActions?.map((a: unknown) =>
          normalizeRampStepAction(a as { patch: Record<string, unknown> }),
        ),
        startDate:
          rampSchedulePayload.startDate as RevisionRampCreateAction["startDate"],
        cutoffDate: rampSchedulePayload.cutoffDate,
        monitoringConfig: rampSchedulePayload.monitoringConfig,
        lockdownConfig: rampSchedulePayload.lockdownConfig,
        requiresStartApproval: rampSchedulePayload.requiresStartApproval,
        ruleId,
      };
      rampActionsUpdate = createAction;
    } else if (rampSchedulePayload.mode === "detach") {
      const hasPendingCreate = (revision.rampActions ?? []).some(
        (a) => a.mode === "create" && a.ruleId === ruleId,
      );
      if (!hasPendingCreate) {
        const detachAction: RevisionRampDetachAction = {
          mode: "detach",
          rampScheduleId: rampSchedulePayload.rampScheduleId,
          ruleId,
          deleteScheduleWhenEmpty: rampSchedulePayload.deleteScheduleWhenEmpty,
        };
        rampActionsUpdate = detachAction;
      }
    } else if (rampSchedulePayload.mode === "update") {
      const updateAction: RevisionRampUpdateAction = {
        mode: "update",
        rampScheduleId: rampSchedulePayload.rampScheduleId,
        name: rampSchedulePayload.name,
        steps: (rampSchedulePayload.steps ?? []).map(
          (s: {
            interval?: number | null;
            actions?: unknown[];
            approvalNotes?: string | null;
            monitored?: boolean;
            holdConditions?: Record<string, unknown>;
          }) => ({
            interval: s.interval ?? null,
            actions: (s.actions ?? []).map((a: unknown) =>
              normalizeRampStepAction(a as { patch: Record<string, unknown> }),
            ),
            approvalNotes: s.approvalNotes ?? undefined,
            monitored: !!s.monitored,
            holdConditions: s.holdConditions as
              | RevisionRampCreateAction["steps"][number]["holdConditions"]
              | undefined,
          }),
        ),
        startActions: rampSchedulePayload.startActions?.map((a: unknown) =>
          normalizeRampStepAction(a as { patch: Record<string, unknown> }),
        ),
        endActions: rampSchedulePayload.endActions?.map((a: unknown) =>
          normalizeRampStepAction(a as { patch: Record<string, unknown> }),
        ),
        startDate:
          rampSchedulePayload.startDate as RevisionRampCreateAction["startDate"],
        cutoffDate: rampSchedulePayload.cutoffDate,
        monitoringConfig: rampSchedulePayload.monitoringConfig,
        lockdownConfig: rampSchedulePayload.lockdownConfig,
        requiresStartApproval: rampSchedulePayload.requiresStartApproval,
        ruleId,
      };
      rampActionsUpdate = updateAction;
    }
    // "clear" removes any pending ramp action for this rule without adding a new one
  }

  // Drop stale `environments` when merge produces `allEnvironments: true`.
  const { rules: nextRules } = updateRuleById(existingRules, ruleId, (e) => {
    const merged = {
      ...e,
      ...(rule as Partial<FeatureRule>),
    } as FeatureRule;
    if (merged.allEnvironments === true) {
      return {
        ...omit(merged, ["environments"]),
        allEnvironments: true,
      } as FeatureRule;
    }
    return merged;
  });

  const combinedChanges: Record<string, unknown> = { rules: nextRules };
  if (rampSchedulePayload?.mode === "clear") {
    // Strip any pending ramp action for this rule.
    const existingActions = revision.rampActions ?? [];
    combinedChanges.rampActions = existingActions.filter(
      (a) =>
        !(
          (a.mode === "create" && a.ruleId === ruleId) ||
          (a.mode === "update" && a.ruleId === ruleId) ||
          (a.mode === "detach" && a.ruleId === ruleId)
        ),
    );
  } else if (rampActionsUpdate) {
    const existingActions = revision.rampActions ?? [];
    const filtered = existingActions.filter(
      (a) =>
        !(
          (a.mode === "create" && a.ruleId === rampActionsUpdate!.ruleId) ||
          (a.mode === "update" && a.ruleId === rampActionsUpdate!.ruleId) ||
          (a.mode === "detach" && a.ruleId === rampActionsUpdate!.ruleId)
        ),
    );
    combinedChanges.rampActions = [...filtered, rampActionsUpdate];
  }

  const updatedRevisionAfterRuleEdit = await updateRevision(
    context,
    feature,
    revision,
    combinedChanges,
    {
      user: res.locals.eventAudit,
      action: "edit rule" + (rampActionsUpdate ? " with ramp schedule" : ""),
      subject: `rule ${ruleId}`,
      value: JSON.stringify(rule),
    },
    resetReview,
  );
  await recordRevisionUpdate(
    context,
    feature,
    updatedRevisionAfterRuleEdit ?? revision,
    "rule.update",
    { environments: ruleChangedEnvs },
  );

  // Schedule edits flow through draft revisions: `mode: "update"` enqueues a
  // RevisionRampUpdateAction above (see L3248) which createRampSchedulesForRevision
  // applies at publish time. Clearing startDate on a ready schedule triggers
  // the "start now" path in createRampSchedulesForRevision, which transitions
  // ready → running immediately when the revision publishes.

  // If editing an experiment-ref rule, keep pendingFeatureDrafts in sync.
  const editedRule = (updatedRevisionAfterRuleEdit ?? revision).rules?.find(
    (r) => r.id === ruleId,
  );
  if (editedRule?.type === "experiment-ref") {
    const draftVersion =
      updatedRevisionAfterRuleEdit?.version ?? revision.version;
    await addPendingFeatureDraftToExperiment(
      context,
      editedRule.experimentId,
      feature.id,
      draftVersion,
    );
  }

  res.status(200).json({
    status: 200,
    version: updatedRevisionAfterRuleEdit?.version ?? revision.version,
  });
}

export async function postFeatureCreateDraft(
  req: AuthRequest<{ title?: string; comment?: string }, { id: string }>,
  res: Response<
    { status: 200; draftVersion: number },
    EventUserForResponseLocals
  >,
) {
  const { id } = req.params;
  const { title, comment } = req.body ?? {};
  const context = getContextFromReq(req);
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

  const environments = getEnvironmentIdsFromOrg(context.org);
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });

  if (!liveRevision) throw new Error("Could not load live revision");

  const newDraft = await createRevision({
    context,
    feature,
    user: context.auditUser,
    baseVersion: feature.version,
    comment: comment ?? "",
    title,
    environments,
    publish: false,
    changes: {},
    org: context.org,
    canBypassApprovalChecks: false,
  });

  void req
    .audit({
      event: "feature.revision.create",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsCreate({
        featureId: feature.id,
        version: newDraft.version,
        baseVersion: newDraft.baseVersion,
        comment: newDraft.comment,
      }),
    })
    .catch((e) =>
      logger.error(e, "Failed to write audit log for revision.create"),
    );

  await dispatchFeatureRevisionEvent(
    context,
    feature,
    newDraft,
    "revision.created",
    {},
  );

  return res.status(200).json({
    status: 200,
    draftVersion: newDraft.version,
  });
}

export async function postFeatureToggle(
  req: AuthRequest<
    {
      environments: Record<string, boolean>;
      autoPublish?: boolean;
      draftVersion?: number;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { environments: orgEnvIds } = context;
  const { id } = req.params;
  const { environments, autoPublish, draftVersion, forceNewDraft } = req.body;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!environments || typeof environments !== "object") {
    throw new Error(
      "Missing required field: environments (Record<string, boolean>)",
    );
  }

  const envIds = Object.keys(environments);
  if (envIds.length === 0) {
    return res.status(200).json({ status: 200 });
  }

  for (const env of envIds) {
    if (!orgEnvIds.includes(env)) {
      throw new Error(`Invalid environment: ${env}`);
    }
  }

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canPublishFeature(feature, envIds)
  ) {
    context.permissions.throwPermissionError();
  }

  if (autoPublish) {
    // Filter to envs that actually differ from live.
    const changes: Record<string, boolean> = {};
    const prevStates: Record<string, boolean> = {};
    for (const [env, state] of Object.entries(environments)) {
      const liveState = feature.environmentSettings?.[env]?.enabled || false;
      if (liveState !== state) {
        changes[env] = state;
        prevStates[env] = liveState;
      }
    }

    if (Object.keys(changes).length === 0) {
      return res.status(200).json({ status: 200 });
    }

    const changedEnvList = Object.keys(changes);
    const comment =
      changedEnvList.length === 1
        ? `Toggle ${changedEnvList[0]} ${changes[changedEnvList[0]] ? "on" : "off"}`
        : `Toggle kill switches: ${changedEnvList.join(", ")}`;

    const orgEnvironments = getEnvironmentIdsFromOrg(context.org);
    const revision = await createRevision({
      context,
      feature,
      user: context.auditUser,
      baseVersion: feature.version,
      comment,
      environments: orgEnvironments,
      publish: false,
      changes: { environmentsEnabled: changes },
      org: context.org,
    });

    await assertCanAutoPublish(context, feature, revision);
    await publishRevision({
      context,
      feature,
      revision,
      result: { environmentsEnabled: changes },
      bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
    });

    await req.audit({
      event: "feature.toggle",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(prevStates, changes),
    });

    return res
      .status(200)
      .json({ status: 200, draftVersion: revision.version });
  }

  // Non-autoPublish path: write all changes to a single draft.
  const existingDraft = forceNewDraft
    ? null
    : draftVersion
      ? await getRevision({
          context,
          organization: feature.organization,
          featureId: feature.id,
          feature,
          version: draftVersion,
        })
      : await getActiveDraft(context, feature);

  // Filter to envs that actually change from the current draft/live state.
  const changes: Record<string, boolean> = {};
  const prevStates: Record<string, boolean> = {};
  for (const [env, state] of Object.entries(environments)) {
    const currentState =
      existingDraft?.environmentsEnabled != null &&
      env in existingDraft.environmentsEnabled
        ? existingDraft.environmentsEnabled[env]
        : feature.environmentSettings?.[env]?.enabled || false;
    if (currentState !== state) {
      changes[env] = state;
      prevStates[env] = currentState;
    }
  }

  if (Object.keys(changes).length === 0) {
    return res.status(200).json({
      status: 200,
      draftVersion: existingDraft?.version,
    });
  }

  const changedEnvList = Object.keys(changes);
  const draft = await createOrUpdateDraftWithChanges(
    context,
    feature,
    { environmentsEnabled: changes },
    {
      user: context.auditUser,
      action: "update",
      subject:
        changedEnvList.length === 1
          ? `environment toggle: ${changedEnvList[0]}`
          : `environment toggles: ${changedEnvList.join(", ")}`,
      value: JSON.stringify(changes),
    },
    existingDraft?.version,
    forceNewDraft,
  );

  await req.audit({
    event: "feature.toggle",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(prevStates, changes, { draft: true }),
  });
  await recordRevisionUpdate(context, feature, draft, "toggle", {
    environments: changedEnvList,
  });

  return res.status(200).json({ status: 200, draftVersion: draft.version });
}

export async function postFeatureMoveRule(
  req: AuthRequest<
    { from: number; to: number },
    { id: string; version: string }
  >,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { environments, org } = context;
  const { id, version } = req.params;
  const { from, to } = req.body;
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

  const existingRules = cloneDeep(revision.rules ?? []);

  const { rules: nextRules, moved: rule } = moveFlatRule(
    existingRules,
    from,
    to,
  );

  const changedEnvironments = rule.allEnvironments
    ? environments
    : (rule.environments ?? []);
  const auditSubject = `from position ${from + 1} to ${to + 1}`;

  const changes = { rules: nextRules };
  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments,
    defaultValueChanged: false,
    settings: org?.settings,
  });
  const updatedRevisionAfterMove = await updateRevision(
    context,
    feature,
    revision,
    changes,
    {
      user: res.locals.eventAudit,
      action: "move rule",
      subject: auditSubject,
      value: JSON.stringify(rule),
    },
    resetReview,
  );
  await recordRevisionUpdate(
    context,
    feature,
    updatedRevisionAfterMove ?? revision,
    "rule.reorder",
    { environments: changedEnvironments },
  );

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}
export async function getDraftandReviewRevisions(
  req: AuthRequest<null, Record<string, never>, { sparse?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const sparse = req.query.sparse === "true";
  const revisions = await getRevisionsByStatus(
    context,
    ["draft", "approved", "changes-requested", "pending-review"],
    { sparse },
  );

  const featureIds = Array.from(new Set(revisions.map((r) => r.featureId)));
  const featureMeta = await getFeatureMetaInfoByIds(context, featureIds);
  const featureMetaMap = new Map(featureMeta.map((f) => [f.id, f]));
  const revisionsWithMeta = revisions.map((r) => ({
    ...r,
    featureMeta: featureMetaMap.get(r.featureId),
  }));

  res.status(200).json({
    status: 200,
    revisions: revisionsWithMeta,
  });
}

export async function deleteFeatureRule(
  req: AuthRequest<{ ruleId: string }, { id: string; version: string }>,
  res: Response<{ status: 200; version: number }, EventUserForResponseLocals>,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, version } = req.params;
  const { ruleId } = req.body;

  if (!ruleId) {
    throw new Error("Must provide ruleId to identify the rule");
  }

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const allEnvironments = getEnvironments(context.org);
  const featureEnvs = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = featureEnvs.map((e) => e.id);

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canManageFeatureDrafts(feature)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getDraftRevision(context, feature, parseInt(version));
  const existingRules = cloneDeep(revision.rules ?? []);

  const { rules: nextRules, removed: rule } = removeRuleById(
    existingRules,
    ruleId,
  );
  const ruleChangedEnvs: string[] =
    rule.allEnvironments || rule.environments === undefined
      ? environmentIds
      : (rule.environments ?? []);

  // Strip any pending ramp actions for the deleted rule so publish doesn't
  // create a schedule doc that would be immediately cleaned up as orphaned.
  // Mirrors the REST handler's behavior.
  const changes: { rules: FeatureRule[]; rampActions?: RevisionRampAction[] } =
    { rules: nextRules };
  const existingRampActions = revision.rampActions ?? [];
  const filteredRampActions = existingRampActions.filter(
    (a) => a.ruleId !== ruleId,
  );
  if (filteredRampActions.length !== existingRampActions.length) {
    changes.rampActions = filteredRampActions;
  }

  const resetReview = resetReviewOnChange({
    feature,
    changedEnvironments: ruleChangedEnvs,
    defaultValueChanged: false,
    settings: org?.settings,
  });
  const updatedRevisionAfterRuleDelete = await updateRevision(
    context,
    feature,
    revision,
    changes,
    {
      user: res.locals.eventAudit,
      action: "delete rule",
      subject: `rule ${ruleId}`,
      value: JSON.stringify(rule),
    },
    resetReview,
  );
  await recordRevisionUpdate(
    context,
    feature,
    updatedRevisionAfterRuleDelete ?? revision,
    "rule.delete",
    { environments: ruleChangedEnvs },
  );

  if (rule.type === "experiment-ref" && rule.experimentId) {
    await removePendingFeatureDraftFromExperiment(
      context,
      rule.experimentId,
      feature.id,
      revision.version,
    );
    // Remove the experiment link when the live revision no longer has the rule.
    const stillLive = (feature.rules ?? []).some(
      (r) =>
        r.type === "experiment-ref" && r.experimentId === rule.experimentId,
    );
    if (!stillLive) {
      await removeLinkedFeatureFromExperiment(
        context,
        rule.experimentId,
        feature.id,
      );
    }
  }

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function putFeature(
  req: AuthRequest<
    Partial<FeatureInterface> & {
      targetDraftVersion?: number;
      autoPublish?: boolean;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; feature: FeatureInterface; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { org, environments } = context;
  const { id } = req.params;
  const feature = await getFeature(context, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const { targetDraftVersion, autoPublish, forceNewDraft, ...updates } =
    req.body;
  if (!context.permissions.canUpdateFeature(feature, updates)) {
    context.permissions.throwPermissionError();
  }

  // Allow project-less features (created before requireProjectForFeatures) to be updated without a project
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

  // Changing the project can affect SDK payload visibility; require publish permission in both old and new project
  if ("project" in updates) {
    if (
      !context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environments)),
      ) ||
      !context.permissions.canPublishFeature(
        updates,
        Array.from(getEnabledEnvironments(feature, environments)),
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
    "holdout",
  ];

  if (
    (Object.keys(updates) as (keyof FeatureInterface)[]).filter(
      (key) => !allowedKeys.includes(key),
    ).length > 0
  ) {
    throw new Error("Invalid update fields for feature");
  }

  // FIXME: We skip validation because project is updated in a different place than where
  // we define custom fields, and that would prevent the user from doing either update.
  // Ideally we validate custom fields everytime, but we need to update our UI to support that.
  if (
    shouldValidateCustomFieldsOnUpdate({
      existingCustomFieldValues: feature.customFields,
      updatedCustomFieldValues: updates.customFields,
    })
  ) {
    await validateCustomFieldsForSection({
      customFieldValues: updates.customFields,
      customFieldsModel: context.models.customFields,
      section: "feature",
      project: "project" in updates ? updates.project : feature.project,
    });
  }

  const metadataKeys: (keyof FeatureInterface)[] = [
    "tags",
    "description",
    "project",
    "owner",
    "customFields",
  ];
  const metadataUpdates = Object.fromEntries(
    Object.entries(updates).filter(([k]) =>
      metadataKeys.includes(k as keyof FeatureInterface),
    ),
  ) as Partial<FeatureInterface>;
  const holdoutUpdate = "holdout" in updates ? updates.holdout : undefined;

  if (Object.keys(metadataUpdates).length > 0 || holdoutUpdate !== undefined) {
    const envelopeChanges: Parameters<
      typeof createOrUpdateDraftWithChanges
    >[2] = {};

    if (Object.keys(metadataUpdates).length > 0) {
      envelopeChanges.metadata = {
        ...(metadataUpdates.description !== undefined && {
          description: metadataUpdates.description,
        }),
        ...(metadataUpdates.owner !== undefined && {
          owner: metadataUpdates.owner,
        }),
        ...(metadataUpdates.project !== undefined && {
          project: metadataUpdates.project,
        }),
        ...(metadataUpdates.tags !== undefined && {
          tags: metadataUpdates.tags,
        }),
        ...(metadataUpdates.customFields !== undefined && {
          customFields: metadataUpdates.customFields as Record<string, unknown>,
        }),
      };
    }

    if (holdoutUpdate !== undefined) {
      envelopeChanges.holdout = holdoutUpdate ?? null;
    }

    const changedKeys = [
      ...Object.keys(metadataUpdates),
      ...(holdoutUpdate !== undefined ? ["holdout"] : []),
    ] as (keyof FeatureInterface)[];
    const metadataFieldLabels: Partial<Record<keyof FeatureInterface, string>> =
      {
        description: "description",
        tags: "tags",
        owner: "owner",
        project: "project",
        customFields: "custom fields",
        holdout: "holdout",
      };
    const draftComment = autoPublish
      ? changedKeys.length === 1
        ? `Update ${metadataFieldLabels[changedKeys[0]] ?? changedKeys[0]}`
        : "Update feature"
      : undefined;
    const draft = await createOrUpdateDraftWithChanges(
      context,
      feature,
      envelopeChanges,
      {
        user: context.auditUser,
        action: "update",
        subject:
          holdoutUpdate !== undefined &&
          Object.keys(metadataUpdates).length === 0
            ? "holdout"
            : "metadata",
        value: JSON.stringify({
          ...metadataUpdates,
          ...(holdoutUpdate !== undefined && { holdout: holdoutUpdate }),
        }),
      },
      autoPublish ? undefined : targetDraftVersion,
      autoPublish ? true : forceNewDraft,
      draftComment,
    );
    let updatedFeature: FeatureInterface = feature;
    if (autoPublish) {
      await assertCanAutoPublish(context, feature, draft);
      updatedFeature = await publishRevision({
        context,
        feature,
        revision: draft,
        result: envelopeChanges,
        bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
      });
    }
    // Keep the tag autocomplete table in sync (side-effect; revision already captures the values).
    if (metadataUpdates.tags !== undefined) {
      await addTagsDiff(
        org.id,
        feature.tags || [],
        metadataUpdates.tags as string[],
      );
    }
    await req.audit({
      event: "feature.update",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(feature, updatedFeature, {
        draft: !autoPublish,
        draftVersion: draft.version,
      }),
    });
    return res.status(200).json({
      status: 200,
      feature: updatedFeature,
      draftVersion: draft.version,
    });
  }

  // All allowed keys are handled above; reaching here means no valid fields were sent.
  throw new Error("No valid update fields for feature");
}

export async function deleteFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }, EventUserForResponseLocals>,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  const feature = await getFeature(context, id);

  if (feature) {
    if (!feature.archived) {
      throw new Error("Feature must be archived before it can be deleted");
    }

    if (!context.permissions.canDeleteFeature(feature)) {
      context.permissions.throwPermissionError();
    }
    if (feature.holdout?.id) {
      try {
        await context.models.holdout.removeFeatureFromHoldout(
          feature.holdout.id,
          feature.id,
        );
      } catch (e) {
        // This is not a fatal error, so don't block the request from happening
        logger.warn(e, "Error removing feature from holdout");
      }
    }
    await deleteFeature(context, feature);
    await unlinkFeatureFromAllExperiments(context, feature.id);
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
  >,
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
    feature,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  const date = evalDate ? new Date(evalDate) : new Date();

  const groupMap = await getSavedGroupMap(context);
  const experimentMap = await getAllPayloadExperiments(context);
  const allEnvironments = getEnvironments(org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();
  const constants = await context.models.constants.getAll();
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
    namespaces: namespacesToMap(org.settings?.namespaces),
    organization: org,
    constants,
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
  >,
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
    }),
  );

  // now evaluate all features:
  const allEnvironments = getEnvironments(context.org);
  const environments =
    environment !== ""
      ? [allEnvironments.find((obj) => obj.id === environment)]
      : getEnvironments(context.org);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();
  const featureResults = await evaluateAllFeatures({
    features,
    context,
    attributeValues: attributes,
    groupMap: await getSavedGroupMap(context),
    environments: environments,
    safeRolloutMap,
  });
  res.status(200).json({
    status: 200,
    results: featureResults,
  });
}

export async function postFeatureArchive(
  req: AuthRequest<
    | {
        archived: boolean;
        autoPublish?: boolean;
        draftVersion?: number;
        forceNewDraft?: boolean;
      }
    | undefined,
    { id: string }
  >,
  res: Response<
    { status: 200; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);
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

  const {
    archived: archivedParam,
    autoPublish,
    draftVersion,
    forceNewDraft,
  } = req.body ?? {};
  // Use the explicitly requested state if provided; fall back to toggling.
  const newArchivedState = archivedParam ?? !feature.archived;
  const archiveChanges = { archived: newArchivedState };
  const archiveComment = newArchivedState
    ? "Archive feature"
    : "Unarchive feature";

  const draft = await createOrUpdateDraftWithChanges(
    context,
    feature,
    archiveChanges,
    {
      user: context.auditUser,
      action: "update",
      subject: newArchivedState ? "archive" : "unarchive",
      value: JSON.stringify({ archived: newArchivedState }),
    },
    autoPublish ? undefined : draftVersion,
    autoPublish ? true : forceNewDraft,
    archiveComment,
  );

  if (autoPublish) {
    await assertCanAutoPublish(context, feature, draft);
    const updatedFeature = await publishRevision({
      context,
      feature,
      revision: draft,
      result: archiveChanges,
      bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
    });
    // Re-fetch so the payload reflects the post-publish status ("published").
    const publishedRevision =
      (await getRevision({
        context,
        organization: context.org.id,
        featureId: feature.id,
        feature,
        version: draft.version,
      })) ?? draft;
    await dispatchFeatureRevisionEvent(
      context,
      updatedFeature,
      publishedRevision,
      "revision.published",
      {},
    );
  }

  if (newArchivedState) {
    await clearPendingFeatureDraftsForFeature(context, feature.id);
  }

  await req.audit({
    event: "feature.archive",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(
      { archived: feature.archived },
      { archived: newArchivedState },
      { draft: !autoPublish, draftVersion: draft.version },
    ),
  });
  if (!autoPublish) {
    await recordRevisionUpdate(context, feature, draft, "archive");
  }

  res.status(200).json({ status: 200, draftVersion: draft.version });
}

export async function getFeatures(
  req: AuthRequest<
    unknown,
    unknown,
    { project?: string; includeArchived?: boolean }
  >,
  res: Response,
) {
  const context = getContextFromReq(req);

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }
  const includeArchived = !!req.query.includeArchived;

  const features = await getAllFeatures(context, {
    projects: project ? [project] : undefined,
    includeArchived,
  });

  const hasArchived = includeArchived
    ? features.some((f) => f.archived)
    : await hasArchivedFeatures(context, project);

  res.status(200).json({
    status: 200,
    features,
    hasArchived,
  });
}

export async function getFeatureRevisions(
  req: AuthRequest<null, { id: string }, { versions?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const versionsParam = req.query.versions ?? "";
  const versions = versionsParam
    .split(",")
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => !isNaN(v) && v > 0);

  // Don't 400 on an empty/zero-only list. The frontend uses 0 as a sentinel
  // ("no version yet") in several places — DraftSelectorForChanges,
  // KillSwitchModal, and useFeaturePageData when the selected revision's
  // baseVersion is 0 (initial revision on a brand-new feature). Returning an
  // empty array lets those callers no-op instead of surfacing a 400 in the UI.
  if (!versions.length) {
    return res.status(200).json({ status: 200, revisions: [] });
  }

  const revisions = await getRevisionsByVersions({
    context,
    organization: org.id,
    featureId: id,
    feature,
    versions,
  });

  return res.status(200).json({ status: 200, revisions });
}

export async function getRevisionLog(
  req: AuthRequest<null, { id: string; version: string }>,
  res: Response<
    { status: 200; log: RevisionLog[] },
    EventUserForResponseLocals
  >,
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
    feature,
    version: parseInt(version),
    includeLog: true,
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  // But now we store logs in a separate table as they are too large
  const revisionLogs =
    await context.models.featureRevisionLogs.getAllByFeatureIdAndVersion({
      featureId: id,
      version: parseInt(version),
    });

  // revisionLogs use dateCreated as the timestamp, so we need to convert it to a RevisionLog as that is what the front end expects
  const revisionLogsFormatted: RevisionLog[] = revisionLogs.map((log) => ({
    id: log.id,
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
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, environments } = context;
  const { id } = req.params;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const minimalRevisions = await getMinimalRevisions(context, org.id, id);

  let fullRevisions = await getFeaturePageRevisions(
    context,
    org.id,
    id,
    feature,
  );

  // The above only fetches the most recent revisions
  // If we're requesting a specific version that's older than that, fetch it directly
  if (req.query.v) {
    const version = parseInt(req.query.v);
    if (!fullRevisions.some((r) => r.version === version)) {
      const revision = await getRevision({
        context,
        organization: org.id,
        featureId: id,
        feature,
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
      feature,
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
      (r) => r.dateCreated >= feature.dateCreated,
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
          feature.dateCreated,
        ),
      );
    } catch (e) {
      // This is not a fatal error, so don't block the request from happening
      req.log.warn(e, "Error creating initial feature revision");
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
    (revision.rules ?? []).forEach((rule) => {
      if (rule?.type === "experiment-ref") {
        experimentIds.add(rule.experimentId);
      }
      // Legacy `experiment` rules use trackingKey instead of experimentId
      else if (rule?.type === "experiment") {
        trackingKeys.add(rule.trackingKey || feature.id);
      } else if (rule?.type === "safe-rollout") {
        hasSafeRollout = true;
      }
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
  // find active ramp schedules for this feature (before safe rollouts so we
  // can check for ramp-linked safe rollout IDs).
  const now = Date.now();
  const rampSchedules = (
    await context.models.rampSchedules.getAllByFeatureId(feature.id)
  ).map((rs) =>
    rs.startedAt ? { ...rs, elapsedMs: now - rs.startedAt.getTime() } : rs,
  );

  // Also check ramp schedules for linked safe rollouts (v2 monitoring).
  const rampLinkedSrIds = rampSchedules
    .map((rs) => rs.safeRolloutId)
    .filter((id): id is string => !!id);

  if (hasSafeRollout || rampLinkedSrIds.length > 0) {
    const safeRollouts = await context.models.safeRollout.getAllByFeatureId(
      feature.id,
    );
    safeRollouts.forEach((safeRollout: SafeRolloutInterface) => {
      safeRolloutMap.set(safeRollout.id, safeRollout);
    });
    // Ensure ramp-linked safe rollouts are included even if getAllByFeatureId
    // missed them (e.g. featureId mismatch in legacy data).
    for (const srId of rampLinkedSrIds) {
      if (!safeRolloutMap.has(srId)) {
        const sr = await context.models.safeRollout.getById(srId);
        if (sr) safeRolloutMap.set(sr.id, sr);
      }
    }
  }

  const live = fullRevisions.find((r) => r.version === feature.version);
  await repairFeatureDriftIfNeeded(context, feature, live, environments);

  // find code references
  const codeRefs = await getAllCodeRefsForFeature({
    feature: feature.id,
    organization: org,
  });

  // find holdout
  let holdout: HoldoutInterface | null = null;
  if (feature.holdout) {
    holdout = await context.models.holdout.getById(feature.holdout.id);
  }

  res.status(200).json({
    status: 200,
    feature,
    revisionList: minimalRevisions,
    revisions: fullRevisions,
    experiments: [...experimentsMap.values()],
    safeRollouts: [...safeRolloutMap.values()],
    codeRefs,
    holdout,
    rampSchedules,
  });
}

export async function getFeatureUsage(
  req: AuthRequest<null, { id: string }, { lookback?: FeatureUsageLookback }>,
  res: Response<{ status: 200; usage: FeatureUsageData }>,
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
    lookback,
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
    evaluations: number,
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
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const NUM_MINUTES = 30;

  // Get feature usage for the current hour
  const now = new Date();
  const current = await getRealtimeUsageByHour(
    org.id,
    now.toISOString().substring(0, 13),
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
      lastHour.toISOString().substring(0, 13),
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
  req: AuthRequest<
    {
      neverStale: boolean;
      autoPublish?: boolean;
      draftVersion?: number;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const {
    neverStale,
    autoPublish,
    draftVersion: reqDraftVersion,
    forceNewDraft,
  } = req.body;

  if (typeof neverStale !== "boolean") {
    throw new Error("Missing required field: neverStale (boolean)");
  }

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const comment = neverStale
    ? "Disable stale detection"
    : "Enable stale detection";

  if (autoPublish) {
    if ((feature.neverStale ?? false) === neverStale) {
      return res.status(200).json({ status: 200 });
    }
    const environments = getEnvironmentIdsFromOrg(context.org);
    const revision = await createRevision({
      context,
      feature,
      user: context.auditUser,
      environments,
      baseVersion: feature.version,
      changes: { metadata: { neverStale } },
      publish: false,
      comment,
      org: context.org,
    });
    await assertCanAutoPublish(context, feature, revision);
    await publishRevision({
      context,
      feature,
      revision,
      result: { metadata: { neverStale } },
      bypassLockdown: context.permissions.canBypassApprovalChecks(feature),
    });
    return res
      .status(200)
      .json({ status: 200, draftVersion: revision.version });
  }

  // Non-autoPublish: write into the specified draft or the active draft.
  const draft = await createOrUpdateDraftWithChanges(
    context,
    feature,
    { metadata: { neverStale } },
    {
      user: context.auditUser,
      action: "update",
      subject: "neverStale",
      value: JSON.stringify({ neverStale }),
    },
    reqDraftVersion,
    forceNewDraft,
  );
  return res.status(200).json({ status: 200, draftVersion: draft.version });
}

/** Resolves the base draft for prerequisite mutations based on caller-provided hints. */
async function resolvePrerequisiteBaseDraft(
  context: ReqContext,
  feature: FeatureInterface,
  targetDraftVersion?: number,
  forceNewDraft?: boolean,
): Promise<FeatureRevisionInterface | null> {
  if (forceNewDraft) return null;
  if (targetDraftVersion) {
    return await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: targetDraftVersion,
    });
  }
  return await getActiveDraft(context, feature);
}

export async function postPrerequisite(
  req: AuthRequest<
    {
      prerequisite: FeaturePrerequisite;
      targetDraftVersion?: number;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { prerequisite, targetDraftVersion, forceNewDraft } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const baseDraft = await resolvePrerequisiteBaseDraft(
    context,
    feature,
    targetDraftVersion,
    forceNewDraft,
  );
  const basePrerequisites =
    baseDraft?.prerequisites ?? feature.prerequisites ?? [];
  const newPrerequisites = [...basePrerequisites, prerequisite];
  const draft = await createOrUpdateDraftWithChanges(
    context,
    feature,
    { prerequisites: newPrerequisites },
    {
      user: context.auditUser,
      action: "update",
      subject: "add prerequisite",
      value: JSON.stringify({ prerequisite }),
    },
    baseDraft?.version,
    forceNewDraft,
  );
  await recordRevisionUpdate(context, feature, draft, "prerequisites");
  return res.status(200).json({ status: 200, draftVersion: draft.version });
}

export async function putPrerequisite(
  req: AuthRequest<
    {
      prerequisite: FeaturePrerequisite;
      i: number;
      targetDraftVersion?: number;
      forceNewDraft?: boolean;
    },
    { id: string }
  >,
  res: Response<
    { status: 200; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { prerequisite, i, targetDraftVersion, forceNewDraft } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const baseDraftPut = await resolvePrerequisiteBaseDraft(
    context,
    feature,
    targetDraftVersion,
    forceNewDraft,
  );
  const basePrerequisites =
    baseDraftPut?.prerequisites ?? feature.prerequisites ?? [];
  const newPrerequisites = [...basePrerequisites];
  if (!newPrerequisites[i]) {
    throw new Error("Unknown prerequisite");
  }
  newPrerequisites[i] = prerequisite;
  const putDraft = await createOrUpdateDraftWithChanges(
    context,
    feature,
    { prerequisites: newPrerequisites },
    {
      user: context.auditUser,
      action: "update",
      subject: `update prerequisite ${i}`,
      value: JSON.stringify({ prerequisite }),
    },
    baseDraftPut?.version,
    forceNewDraft,
  );
  await recordRevisionUpdate(context, feature, putDraft, "prerequisites");
  return res.status(200).json({ status: 200, draftVersion: putDraft.version });
}

export async function deletePrerequisite(
  req: AuthRequest<
    { i: number; targetDraftVersion?: number; forceNewDraft?: boolean },
    { id: string }
  >,
  res: Response<
    { status: 200; draftVersion?: number },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const { i, targetDraftVersion, forceNewDraft } = req.body;

  const feature = await getFeature(context, id);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const baseDraftDel = await resolvePrerequisiteBaseDraft(
    context,
    feature,
    targetDraftVersion,
    forceNewDraft,
  );
  const basePrerequisites =
    baseDraftDel?.prerequisites ?? feature.prerequisites ?? [];
  const newPrerequisites = [...basePrerequisites];
  if (!newPrerequisites[i]) {
    throw new Error("Unknown prerequisite");
  }
  newPrerequisites.splice(i, 1);
  const deleteDraft = await createOrUpdateDraftWithChanges(
    context,
    feature,
    { prerequisites: newPrerequisites },
    {
      user: context.auditUser,
      action: "update",
      subject: `delete prerequisite ${i}`,
      value: JSON.stringify({ index: i }),
    },
    baseDraftDel?.version,
    forceNewDraft,
  );
  await recordRevisionUpdate(context, feature, deleteDraft, "prerequisites");
  return res
    .status(200)
    .json({ status: 200, draftVersion: deleteDraft.version });
}

// Evaluate prerequisite states with JIT feature loading for cross-project prerequisites
export async function getPrerequisiteStates(
  req: AuthRequest<
    null,
    { id: string },
    { environments?: string; skipRootConditions?: string; version?: string }
  >,
  res: Response<
    {
      status: 200;
      states: Record<string, PrerequisiteStateResult>;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const baseFeature = await getFeature(context, id);
  if (!baseFeature) {
    throw new Error("Could not find feature");
  }

  let envIds: string[];
  if (req.query.environments) {
    envIds = req.query.environments.split(",");
  } else {
    const allEnvironments = getEnvironments(org);
    const featureEnvironments = filterEnvironmentsByFeature(
      allEnvironments,
      baseFeature,
    );
    envIds = featureEnvironments.map((e) => e.id);
  }

  // If a revision version is provided, merge it onto the base feature so that
  // draft prerequisites and kill-switch states are reflected in the evaluation.
  let feature = baseFeature;
  if (req.query.version) {
    const versionNum = parseInt(req.query.version, 10);
    if (!Number.isNaN(versionNum) && versionNum !== baseFeature.version) {
      const revision = await getRevision({
        context,
        organization: baseFeature.organization,
        featureId: baseFeature.id,
        feature: baseFeature,
        version: versionNum,
      });
      if (revision) {
        feature = mergeRevision(baseFeature, revision, envIds);
      }
    }
  }

  const skipRootConditions = req.query.skipRootConditions === "true";

  const states: Record<string, PrerequisiteStateResult> = {};
  const featuresMap = new Map<string, FeatureInterface>();
  featuresMap.set(feature.id, feature);

  for (const env of envIds) {
    states[env] = await evaluatePrerequisiteStateAsync(
      context,
      feature,
      env,
      featuresMap,
      skipRootConditions,
    );
  }

  res.status(200).json({
    status: 200,
    states,
  });
}

// Batch evaluate prerequisite states with optional base feature (for cyclic checks)
export async function postBatchPrerequisiteStates(
  req: AuthRequest<{
    featureIds: string[];
    environments: string[];
    baseFeatureId?: string;
  }>,
  res: Response<
    {
      status: 200;
      results: Record<
        string,
        {
          states: Record<string, PrerequisiteStateResult>;
          wouldBeCyclic: boolean;
        }
      >;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { featureIds, environments, baseFeatureId } = req.body;

  if (!featureIds || !featureIds.length) {
    throw new Error("Must provide featureIds");
  }
  if (!environments || !environments.length) {
    throw new Error("Must provide environments");
  }

  let baseFeature: FeatureInterface | null = null;
  if (baseFeatureId) {
    baseFeature = await getFeature(context, baseFeatureId);
    if (!baseFeature) {
      throw new Error("Could not find base feature");
    }
  }

  return await evaluateBatchPrerequisiteStates({
    context,
    featureIds,
    environments,
    baseFeature,
    res,
  });
}

function buildPrerequisiteAdjacency(
  features: FeatureInterface[],
  environments: string[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const f of features) {
    const deps = new Set<string>();
    for (const p of f.prerequisites || []) {
      deps.add(p.id);
    }
    for (const rule of f.rules ?? []) {
      const applies =
        rule.allEnvironments ||
        (rule.environments || []).some((e) => environments.includes(e));
      if (!applies) continue;
      for (const p of rule.prerequisites ?? []) {
        deps.add(p.id);
      }
    }
    if (deps.size > 0) {
      adj.set(f.id, deps);
    }
  }
  return adj;
}

// Returns the set of features that transitively depend on targetId.
function computeAncestors(
  targetId: string,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  const reverse = new Map<string, Set<string>>();
  for (const [featureId, deps] of adjacency) {
    for (const dep of deps) {
      let set = reverse.get(dep);
      if (!set) {
        set = new Set();
        reverse.set(dep, set);
      }
      set.add(featureId);
    }
  }

  const ancestors = new Set<string>();
  const queue = [targetId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const dependents = reverse.get(current);
    if (!dependents) continue;
    for (const dep of dependents) {
      if (!ancestors.has(dep)) {
        ancestors.add(dep);
        queue.push(dep);
      }
    }
  }
  return ancestors;
}

async function evaluateBatchPrerequisiteStates({
  context,
  featureIds,
  environments,
  baseFeature,
  res,
}: {
  context: ReqContext;
  featureIds: string[];
  environments: string[];
  baseFeature: FeatureInterface | null;
  res: Response;
}) {
  // Load all org features so the adjacency graph is complete for cycle
  // detection (cross-project intermediaries, etc.). State evaluation is
  // still bounded to the requested featureIds.
  const allFeatures = await getAllFeatures(context, {});
  const featuresMap = new Map<string, FeatureInterface>(
    allFeatures.map((f) => [f.id, f]),
  );

  const stateCache = new Map<string, PrerequisiteStateResult>();

  let ancestorsOfBase: Set<string> | null = null;
  if (baseFeature) {
    const graphFeatures = [...allFeatures];
    if (!featuresMap.has(baseFeature.id)) {
      graphFeatures.push(baseFeature);
    }

    const adjacency = buildPrerequisiteAdjacency(graphFeatures, environments);
    ancestorsOfBase = computeAncestors(baseFeature.id, adjacency);
  }

  const results: Record<
    string,
    {
      states: Record<string, PrerequisiteStateResult>;
      wouldBeCyclic: boolean;
    }
  > = {};

  for (let i = 0; i < featureIds.length; i++) {
    await yieldEventLoop(i);
    const featureId = featureIds[i];
    const optionFeature = featuresMap.get(featureId);
    if (!optionFeature) continue;

    const states: Record<string, PrerequisiteStateResult> = {};
    for (const env of environments) {
      states[env] = await evaluatePrerequisiteStateAsync(
        context,
        optionFeature,
        env,
        featuresMap,
        false,
        stateCache,
      );
    }

    const wouldBeCyclic = ancestorsOfBase
      ? ancestorsOfBase.has(featureId)
      : false;

    results[featureId] = {
      states,
      wouldBeCyclic,
    };
  }

  res.status(200).json({
    status: 200,
    results,
  });
}

const PREREQUISITE_MAX_DEPTH = 100;

type PrerequisiteState = "deterministic" | "conditional" | "cyclic";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrerequisiteValue = any;
type PrerequisiteStateResult = {
  state: PrerequisiteState;
  value: PrerequisiteValue;
};

async function evaluatePrerequisiteStateAsync(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  env: string,
  existingFeaturesMap?: Map<string, FeatureInterface>,
  skipRootConditions: boolean = false,
  stateCache?: Map<string, PrerequisiteStateResult>,
): Promise<PrerequisiteStateResult> {
  const cacheKey = `${feature.id}:${env}`;
  if (stateCache && !skipRootConditions) {
    const cached = stateCache.get(cacheKey);
    if (cached) return cached;
  }

  const featuresMap =
    existingFeaturesMap || new Map<string, FeatureInterface>();

  if (!featuresMap.has(feature.id)) {
    featuresMap.set(feature.id, feature);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  const checkCyclic = async (
    f: FeatureInterface,
    depth: number = 0,
  ): Promise<boolean> => {
    if (depth >= PREREQUISITE_MAX_DEPTH) return true;
    if (visited.has(f.id)) return false;
    if (visiting.has(f.id)) return true;

    visiting.add(f.id);

    const prerequisites = f.prerequisites || [];
    for (const prereq of prerequisites) {
      let prereqFeature = featuresMap.get(prereq.id);
      if (!prereqFeature) {
        const features = await getFeaturesByIds(context, [prereq.id]);
        prereqFeature = features[0];
        if (prereqFeature) {
          featuresMap.set(prereq.id, prereqFeature);
        }
      }
      if (prereqFeature && (await checkCyclic(prereqFeature, depth + 1))) {
        return true;
      }
    }

    visiting.delete(f.id);
    visited.add(f.id);
    return false;
  };

  if (await checkCyclic(feature, 0)) {
    const result: PrerequisiteStateResult = { state: "cyclic", value: null };
    if (stateCache && !skipRootConditions) stateCache.set(cacheKey, result);
    return result;
  }

  let isTopLevel = true;

  const visit = async (
    f: FeatureInterface,
    depth: number = 0,
  ): Promise<PrerequisiteStateResult> => {
    if (depth >= PREREQUISITE_MAX_DEPTH) {
      return { state: "cyclic", value: null };
    }

    if (!isTopLevel && stateCache) {
      const innerKey = `${f.id}:${env}`;
      const cached = stateCache.get(innerKey);
      if (cached) return cached;
    }

    if (!f.environmentSettings[env]) {
      return { state: "deterministic", value: null };
    }
    if (!f.environmentSettings[env].enabled) {
      return { state: "deterministic", value: null };
    }

    let state: PrerequisiteState = "deterministic";
    let value: PrerequisiteValue = f.defaultValue;

    if (f.valueType === "boolean") {
      value = f.defaultValue !== "false";
    } else if (f.valueType === "number") {
      value = parseFloat(f.defaultValue);
    } else if (f.valueType === "json") {
      try {
        value = JSON.parse(f.defaultValue);
      } catch (e) {
        // ignore
      }
    }

    if (!skipRootConditions || !isTopLevel) {
      const envRules = getRulesForEnvironment(f.rules ?? [], env);
      if (envRules.filter((r) => !!r.enabled).length) {
        state = "conditional";
        value = undefined;
      }
    }

    isTopLevel = false;
    const prerequisites = f.prerequisites || [];
    for (const prereq of prerequisites) {
      let prereqFeature = featuresMap.get(prereq.id);
      if (!prereqFeature) {
        const features = await getFeaturesByIds(context, [prereq.id]);
        prereqFeature = features[0];
        if (prereqFeature) {
          featuresMap.set(prereq.id, prereqFeature);
        }
      }

      if (!prereqFeature) {
        state = "deterministic";
        value = null;
        break;
      }

      const { state: prereqState, value: prereqValue } = await visit(
        prereqFeature,
        depth + 1,
      );

      if (prereqState === "deterministic") {
        const evaled = evalDeterministicPrereqValueBackend(
          prereqValue ?? null,
          prereq.condition,
        );
        if (evaled === "fail") {
          state = "deterministic";
          value = null;
          break;
        }
      } else if (prereqState === "conditional") {
        state = "conditional";
        value = undefined;
      }
    }

    const result = { state, value };
    if (stateCache && !isTopLevel) {
      stateCache.set(`${f.id}:${env}`, result);
    }
    return result;
  };

  const result = await visit(feature, 0);
  if (stateCache && !skipRootConditions) stateCache.set(cacheKey, result);
  return result;
}

function evalDeterministicPrereqValueBackend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  condition: string,
): "pass" | "fail" {
  try {
    const conditionObj = JSON.parse(condition || "{}");
    // Empty condition means "is truthy"
    if (Object.keys(conditionObj).length === 0) {
      return value ? "pass" : "fail";
    }
    // Check if condition references "value" field
    if ("value" in conditionObj) {
      const valueCondition = conditionObj.value;
      // Handle $exists checks
      if (typeof valueCondition === "object" && valueCondition !== null) {
        if ("$exists" in valueCondition) {
          return valueCondition.$exists ===
            (value !== null && value !== undefined)
            ? "pass"
            : "fail";
        }
        if ("$eq" in valueCondition) {
          return valueCondition.$eq === value ? "pass" : "fail";
        }
        if ("$ne" in valueCondition) {
          return valueCondition.$ne !== value ? "pass" : "fail";
        }
        if ("$in" in valueCondition && Array.isArray(valueCondition.$in)) {
          return valueCondition.$in.includes(value) ? "pass" : "fail";
        }
        if ("$nin" in valueCondition && Array.isArray(valueCondition.$nin)) {
          return !valueCondition.$nin.includes(value) ? "pass" : "fail";
        }
      }
      // Direct value comparison
      return valueCondition === value ? "pass" : "fail";
    }
    // Default: value must be truthy
    return value ? "pass" : "fail";
  } catch (e) {
    return "fail";
  }
}

// Return lightweight feature metadata for UI components
export async function getFeatureMetaInfo(
  req: AuthRequest<
    null,
    null,
    { defaultValue?: string; project?: string; ids?: string }
  >,
  res: Response<
    { status: 200; features: FeatureMetaInfo[] },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const { defaultValue, project, ids } = req.query;

  const features = await getFeatureMetaInfoById(context, {
    includeDefaultValue: defaultValue === "1",
    project: project || undefined,
    ids: ids ? ids.split(",").filter(Boolean) : undefined,
  });

  res.status(200).json({ status: 200, features });
}

export async function getFeatureDraftStates(
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response<
    {
      status: 200;
      features: Record<string, DraftStatusCounts>;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const featureIds = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;
  const features = await getActiveDraftStates(context.org.id, featureIds);
  res.status(200).json({ status: 200, features });
}

// TODO: consider adding a force-recompute option that writes results back
export async function getFeaturesStaleStates(
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response<
    {
      status: 200;
      features: Record<
        string,
        IsFeatureStaleResult & { neverStale: boolean; computedAt: string }
      >;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const featureIds = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;

  const [allFeatures, allExperiments, draftRevisions] = await Promise.all([
    getAllFeaturesForStaleGraph(context),
    getAllExperimentsForStaleGraph(context),
    getRevisionsByStatus(context as ReqContext, [...ACTIVE_DRAFT_STATUSES], {
      sparse: true,
    }),
  ]);

  const mostRecentDraftDateByFeatureId = new Map<string, Date>();
  for (const rev of draftRevisions) {
    const existing = mostRecentDraftDateByFeatureId.get(rev.featureId);
    const revDate = new Date(rev.dateUpdated ?? 0);
    if (!existing || revDate > existing) {
      mostRecentDraftDateByFeatureId.set(rev.featureId, revDate);
    }
  }

  const targetFeatures = featureIds
    ? allFeatures.filter((f) => featureIds.includes(f.id))
    : allFeatures;

  const lookups = buildFeatureLookups(allFeatures, allExperiments);

  const computedAt = new Date().toISOString();
  const result: Record<
    string,
    IsFeatureStaleResult & { neverStale: boolean; computedAt: string }
  > = {};

  for (let i = 0; i < targetFeatures.length; i++) {
    await yieldEventLoop(i);
    const feature = targetFeatures[i];

    const applicableEnvIds = getEnvironments(context.org)
      .filter(
        (env) =>
          !feature.project ||
          !env.projects?.length ||
          env.projects.includes(feature.project as string),
      )
      .map((env) => env.id);

    const staleResult = isFeatureStale({
      feature,
      features: allFeatures,
      environments: applicableEnvIds,
      ...lookups,
      mostRecentDraftDate:
        mostRecentDraftDateByFeatureId.get(feature.id) ?? null,
    });

    result[feature.id] = {
      ...staleResult,
      neverStale: feature.neverStale ?? false,
      computedAt,
    };
  }

  res.status(200).json({ status: 200, features: result });
}

export async function getFeaturesStatus(
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response<
    {
      status: 200;
      features: Record<string, Record<string, boolean>>;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const featureIds = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;

  const raw = await getFeatureEnvStatus(context, featureIds);

  const features: Record<string, Record<string, boolean>> = {};
  for (const f of raw) {
    const envMap: Record<string, boolean> = {};
    for (const [envId, settings] of Object.entries(
      f.environmentSettings || {},
    )) {
      envMap[envId] = settings.enabled ?? false;
    }
    features[f.id] = envMap;
  }

  res.status(200).json({ status: 200, features });
}

export async function getFeaturesDependents(
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response<
    {
      status: 200;
      dependents: Record<
        string,
        { features: string[]; experiments: { id: string; name: string }[] }
      >;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const featureIds = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : [];

  if (!featureIds.length) {
    return res.status(200).json({ status: 200, dependents: {} });
  }

  const allEnvIds = getEnvironments(context.org).map((e) => e.id);

  const [allFeatures, allExperiments] = await Promise.all([
    getAllFeaturesForStaleGraph(context, { includeArchived: true }),
    getAllExperimentsForStaleGraph(context, { includeArchived: true }),
  ]);

  const {
    featuresMap,
    reverseDependencyIndex,
    experiments,
    experimentDependencyIndex,
  } = buildFeatureLookups(allFeatures, allExperiments);

  const dependents: Record<
    string,
    { features: string[]; experiments: { id: string; name: string }[] }
  > = {};

  for (let i = 0; i < featureIds.length; i++) {
    await yieldEventLoop(i);
    const featureId = featureIds[i];
    const feature = featuresMap.get(featureId);
    if (!feature) {
      dependents[featureId] = { features: [], experiments: [] };
      continue;
    }
    dependents[featureId] = {
      features: getDependentFeatures(
        feature,
        allFeatures,
        allEnvIds,
        reverseDependencyIndex,
        featuresMap,
      ),
      experiments: getDependentExperiments(
        feature,
        experiments,
        experimentDependencyIndex,
      ).map((e) => ({
        id: e.id,
        name: e.name,
      })),
    };
  }

  return res.status(200).json({ status: 200, dependents });
}

// ---------------------------------------------------------------------------
// Advanced search endpoints
// ---------------------------------------------------------------------------

function extractAttributesFromCondition(condition: string): string[] {
  try {
    const parsed = JSON.parse(condition);
    if (!parsed || typeof parsed !== "object") return [];
    return extractKeysFromConditionObj(parsed);
  } catch {
    return [];
  }
}

function extractKeysFromConditionObj(obj: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("$")) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") {
            keys.push(...extractKeysFromConditionObj(item));
          }
        }
      }
    } else {
      keys.push(key);
    }
  }
  return keys;
}

function extractValuesFromRule(rule: FeatureRule): string[] {
  const values: string[] = [];
  if (rule.type === "force") {
    values.push(rule.value);
  } else if (rule.type === "rollout") {
    values.push(rule.value);
  } else if (rule.type === "experiment") {
    for (const v of rule.values) values.push(v.value);
  } else if (rule.type === "experiment-ref") {
    for (const v of rule.variations) values.push(v.value);
  } else if (rule.type === "safe-rollout") {
    values.push(rule.controlValue, rule.variationValue);
  }
  return values;
}

function extractAttributesFromRule(rule: FeatureRule): string[] {
  const attrs: string[] = [];
  if (rule.condition) {
    attrs.push(...extractAttributesFromCondition(rule.condition));
  }
  if ("hashAttribute" in rule && rule.hashAttribute) {
    attrs.push(rule.hashAttribute);
  }
  if ("fallbackAttribute" in rule && rule.fallbackAttribute) {
    attrs.push(rule.fallbackAttribute);
  }
  return attrs;
}

function extractSavedGroupIdsFromRule(rule: FeatureRule): string[] {
  const ids: string[] = [];
  for (const sg of rule.savedGroups ?? []) {
    ids.push(...sg.ids);
  }
  return ids;
}

function extractPrerequisiteIdsFromFeature(
  feature: FeatureInterface,
  rules: FeatureRule[],
): string[] {
  const ids: string[] = [];
  for (const p of feature.prerequisites ?? []) ids.push(p.id);
  for (const r of rules) {
    for (const p of r.prerequisites ?? []) ids.push(p.id);
  }
  for (const env of Object.values(feature.environmentSettings ?? {})) {
    for (const p of env.prerequisites ?? []) ids.push(p.id);
  }
  return ids;
}

export async function getFeatureContentSearch(
  req: AuthRequest<
    null,
    Record<string, never>,
    {
      valueContains?: string;
      attribute?: string;
      savedGroup?: string;
      prerequisite?: string;
      experiment?: string;
      bandit?: string;
    }
  >,
  res: Response<
    { status: 200; matchingIds: string[] },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const {
    valueContains,
    attribute,
    savedGroup,
    prerequisite,
    experiment,
    bandit,
  } = req.query;

  if (
    !valueContains &&
    !attribute &&
    !savedGroup &&
    !prerequisite &&
    !experiment &&
    !bandit
  ) {
    return res.status(200).json({ status: 200, matchingIds: [] });
  }

  const [allFeatures, draftRevisions] = await Promise.all([
    getAllFeatures(context, {}),
    getRevisionsByStatus(context as ReqContext, [...ACTIVE_DRAFT_STATUSES]),
  ]);

  const draftsByFeatureId = new Map<
    string,
    { defaultValues: string[]; rules: FeatureRule[] }
  >();
  for (const rev of draftRevisions) {
    const existing = draftsByFeatureId.get(rev.featureId);
    if (existing) {
      existing.defaultValues.push(rev.defaultValue);
      existing.rules.push(...rev.rules);
    } else {
      draftsByFeatureId.set(rev.featureId, {
        defaultValues: [rev.defaultValue],
        rules: [...rev.rules],
      });
    }
  }

  const matchingIds: string[] = [];

  for (let i = 0; i < allFeatures.length; i++) {
    await yieldEventLoop(i);
    const feature = allFeatures[i];
    const draft = draftsByFeatureId.get(feature.id);

    const liveRules = feature.rules;
    const allRules = draft ? [...liveRules, ...draft.rules] : liveRules;
    const allDefaults = draft
      ? [feature.defaultValue, ...draft.defaultValues]
      : [feature.defaultValue];

    if (valueContains) {
      const pattern = valueContains.toLowerCase();
      const allValues = [
        ...allDefaults,
        ...allRules.flatMap(extractValuesFromRule),
      ];
      if (!allValues.some((v) => v.toLowerCase().includes(pattern))) continue;
    }

    if (attribute) {
      const allAttrs = allRules.flatMap(extractAttributesFromRule);
      if (!allAttrs.includes(attribute)) continue;
    }

    if (savedGroup) {
      const allSgIds = allRules.flatMap(extractSavedGroupIdsFromRule);
      if (!allSgIds.includes(savedGroup)) continue;
    }

    if (prerequisite) {
      const allPrereqIds = extractPrerequisiteIdsFromFeature(feature, allRules);
      if (!allPrereqIds.includes(prerequisite)) continue;
    }

    if (experiment) {
      const linked = feature.linkedExperiments ?? [];
      if (!linked.includes(experiment)) continue;
    }

    if (bandit) {
      const linked = feature.linkedExperiments ?? [];
      if (!linked.includes(bandit)) continue;
    }

    matchingIds.push(feature.id);
  }

  res.status(200).json({ status: 200, matchingIds });
}

export async function getFeatureDependencyIndex(
  req: AuthRequest,
  res: Response<
    { status: 200; prerequisiteFeatureIds: string[] },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const allFeatures = await getAllFeatures(context, { includeArchived: true });

  const prereqIds = new Set<string>();
  for (let i = 0; i < allFeatures.length; i++) {
    await yieldEventLoop(i);
    const feature = allFeatures[i];
    for (const p of feature.prerequisites ?? []) prereqIds.add(p.id);
    for (const r of feature.rules) {
      for (const p of r.prerequisites ?? []) prereqIds.add(p.id);
    }
    for (const env of Object.values(feature.environmentSettings ?? {})) {
      for (const p of env.prerequisites ?? []) prereqIds.add(p.id);
    }
  }

  res.status(200).json({ status: 200, prerequisiteFeatureIds: [...prereqIds] });
}

export async function getFeatureRampStates(
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response<
    {
      status: 200;
      features: Record<string, { id: string; name: string; status: string }>;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const featureIds = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;

  const NON_TERMINAL_STATUSES = [
    "pending",
    "ready",
    "running",
    "paused",
    "pending-approval",
  ];

  const allSchedules = await context.models.rampSchedules.getAll();
  const activeSchedules = allSchedules.filter((s) =>
    NON_TERMINAL_STATUSES.includes(s.status),
  );

  const result: Record<string, { id: string; name: string; status: string }> =
    {};

  for (const schedule of activeSchedules) {
    if (schedule.entityType !== "feature") continue;
    const entityId = schedule.entityId;
    if (featureIds && !featureIds.includes(entityId)) continue;
    if (!result[entityId]) {
      result[entityId] = {
        id: schedule.id,
        name: schedule.name,
        status: schedule.status,
      };
    }
  }

  res.status(200).json({ status: 200, features: result });
}

export async function getFeatureExperimentStates(
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response<
    {
      status: 200;
      features: Record<
        string,
        {
          hasTempRollout: boolean;
        }
      >;
    },
    EventUserForResponseLocals
  >,
) {
  const context = getContextFromReq(req);
  const featureIds = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : undefined;

  const allExperiments = await getAllExperimentsForStaleGraph(context);

  const tempRolloutExpIds = new Set<string>();

  for (const exp of allExperiments) {
    if (
      exp.status === "stopped" &&
      !exp.excludeFromPayload &&
      (exp.linkedFeatures?.length ||
        exp.hasURLRedirects ||
        exp.hasVisualChangesets)
    ) {
      tempRolloutExpIds.add(exp.id);
    }
  }

  const allFeatures = await getAllFeatures(context, {});
  const targetFeatures = featureIds
    ? allFeatures.filter((f) => featureIds.includes(f.id))
    : allFeatures;

  const result: Record<string, { hasTempRollout: boolean }> = {};

  for (let i = 0; i < targetFeatures.length; i++) {
    await yieldEventLoop(i);
    const feature = targetFeatures[i];
    const linked = feature.linkedExperiments ?? [];

    const hasTempRollout = linked.some((id) => tempRolloutExpIds.has(id));

    if (hasTempRollout) {
      result[feature.id] = { hasTempRollout };
    }
  }

  res.status(200).json({ status: 200, features: result });
}

export async function getFeatureWatchers(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const watchers = await context.models.watch.getFeatureWatchers(id);
  res.status(200).json({
    status: 200,
    userIds: watchers,
  });
}
