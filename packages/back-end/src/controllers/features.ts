import { Request, Response } from "express";
import { evaluateFeatures } from "@growthbook/proxy-eval";
import { isEqual } from "lodash";
import { MergeResultChanges, MergeStrategy, autoMerge } from "shared/util";
import { ReadAccessFilter, hasPermission } from "shared/permissions";
import {
  getConnectionSDKCapabilities,
  SDKCapability,
} from "shared/sdk-versioning";
import {
  ExperimentRefRule,
  FeatureInterface,
  FeatureRule,
  FeatureTestResult,
} from "../../types/feature";
import { AuthRequest } from "../types/AuthRequest";
import {
  getEnvironments,
  getEnvironmentIdsFromOrg,
  getOrgFromReq,
} from "../services/organizations";
import {
  addFeatureRule,
  createFeature,
  deleteFeature,
  editFeatureRule,
  getFeature,
  setDefaultValue,
  toggleFeatureEnvironment,
  updateFeature,
  archiveFeature,
  setJsonSchema,
  getAllFeaturesWithLinkedExperiments,
  publishRevision,
  migrateDraft,
  applyRevisionChanges,
  addLinkedExperiment,
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
  auditDetailsUpdate,
  auditDetailsDelete,
} from "../services/audit";
import {
  cleanUpPreviousRevisions,
  createInitialRevision,
  createRevision,
  discardRevision,
  getRevision,
  getRevisions,
  hasDraft,
  markRevisionAsPublished,
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
  EventAuditUser,
  EventAuditUserForResponseLocals,
} from "../events/event-types";
import {
  FASTLY_SERVICE_ID,
  CACHE_CONTROL_MAX_AGE,
  CACHE_CONTROL_STALE_IF_ERROR,
  CACHE_CONTROL_STALE_WHILE_REVALIDATE,
} from "../util/secrets";
import { upsertWatch } from "../models/WatchModel";
import { getSurrogateKeysFromEnvironments } from "../util/cdn.util";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import {
  addLinkedFeatureToExperiment,
  getExperimentById,
  getExperimentsByIds,
  getExperimentsByTrackingKeys,
  getAllPayloadExperiments,
} from "../models/ExperimentModel";
import { OrganizationInterface } from "../../types/organization";
import { ExperimentInterface } from "../../types/experiment";
import { getTeamsForOrganization } from "../models/TeamModel";
import { getUserPermissions } from "../util/organization.util";

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
  hashSecureAttributes?: boolean;
  remoteEvalEnabled?: boolean;
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
      hashSecureAttributes: connection.hashSecureAttributes,
      remoteEvalEnabled: connection.remoteEvalEnabled,
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
      hashSecureAttributes,
      remoteEvalEnabled,
    } = await getPayloadParamsFromApiKey(key, req);

    if (remoteEvalEnabled) {
      throw new UnrecoverableApiError(
        "Remote evaluation required for this connection"
      );
    }

    const defs = await getFeatureDefinitions({
      organization,
      capabilities,
      environment,
      projects,
      encryptionKey: encrypted ? encryptionKey : "",
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      hashSecureAttributes,
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
      hashSecureAttributes,
      remoteEvalEnabled,
    } = await getPayloadParamsFromApiKey(key, req);

    if (!remoteEvalEnabled) {
      throw new UnrecoverableApiError(
        "Remote evaluation disabled for this connection"
      );
    }

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
      organization,
      capabilities,
      environment,
      projects,
      encryptionKey: encrypted ? encryptionKey : "",
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
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
    EventAuditUserForResponseLocals
  >
) {
  const { id, environmentSettings, ...otherProps } = req.body;
  const {
    org,
    userId,
    userName,
    environments,
    readAccessFilter,
  } = getOrgFromReq(req);

  req.checkPermissions("manageFeatures", otherProps.project);
  req.checkPermissions("createFeatureDrafts", otherProps.project);

  if (!id) {
    throw new Error("Must specify feature key");
  }

  if (!environmentSettings) {
    throw new Error("Feature missing initial environment toggle settings");
  }

  if (!id.match(/^[a-zA-Z0-9_.:|-]+$/)) {
    throw new Error(
      "Feature keys can only include letters, numbers, hyphens, and underscores."
    );
  }
  const existing = await getFeature(org.id, id, readAccessFilter);
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
    environmentSettings: Object.fromEntries(
      Object.entries(environmentSettings).filter(([env]) =>
        environments.includes(env)
      )
    ),
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id: id.toLowerCase(),
    archived: false,
    version: 1,
    hasDrafts: false,
    jsonSchema: {
      schema: "",
      date: new Date(),
      enabled: false,
    },
  };

  // Require publish permission for any enabled environments
  req.checkPermissions(
    "publishFeatures",
    feature.project,
    getEnabledEnvironments(feature, environments)
  );

  addIdsToRules(feature.environmentSettings, feature.id);

  await createFeature(org, res.locals.eventAudit, feature, readAccessFilter);
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
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { strategies, mergeResultSerialized } = req.body;
  const { id, version } = req.params;
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }
  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const revisions = await getRevisions(org.id, feature.id);

  const revision = revisions.find((r) => r.version === parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only fix conflicts for Draft revisions");
  }

  const live = revisions.find((r) => r.version === feature.version);
  const base = revisions.find((r) => r.version === revision.baseVersion);

  if (!live || !base) {
    throw new Error("Could not lookup feature history");
  }

  const mergeResult = autoMerge(
    live,
    base,
    revision,
    environments,
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
  environments.forEach((env) => {
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
    }
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
    },
    { id: string; version: string }
  >,
  res: Response
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { comment, mergeResultSerialized } = req.body;
  const { id, version } = req.params;
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }
  req.checkPermissions("manageFeatures", feature.project);

  const revisions = await getRevisions(org.id, feature.id);

  const revision = revisions.find((r) => r.version === parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only publish Draft revisions");
  }

  const live = revisions.find((r) => r.version === feature.version);
  const base = revisions.find((r) => r.version === revision.baseVersion);

  if (!live || !base) {
    throw new Error("Could not lookup feature history");
  }

  const mergeResult = autoMerge(live, base, revision, environments, {});
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
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      getEnabledEnvironments(feature, environments)
    );
  }
  // Otherwise, only the environments with rule changes are affected
  else {
    const changedEnvs = Object.keys(mergeResult.result.rules || {});
    if (changedEnvs.length > 0) {
      req.checkPermissions("publishFeatures", feature.project, changedEnvs);
    }
  }

  const updatedFeature = await publishRevision(
    org,
    feature,
    revision,
    mergeResult.result,
    res.locals.eventAudit,
    readAccessFilter,
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
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;
  const { comment } = req.body;

  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (revision.version === feature.version || revision.status !== "published") {
    throw new Error("Can only revert to previously published revisions");
  }

  req.checkPermissions("manageFeatures", feature.project);

  const changes: MergeResultChanges = {};

  if (revision.defaultValue !== feature.defaultValue) {
    // If changing the default value, it affects all enabled environments
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      getEnabledEnvironments(feature, environments)
    );
    changes.defaultValue = revision.defaultValue;
  }

  const changedEnvs: string[] = [];
  environments.forEach((env) => {
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
    req.checkPermissions("publishFeatures", feature.project, changedEnvs);
  }

  const updatedFeature = await applyRevisionChanges(
    org,
    feature,
    revision,
    changes,
    res.locals.eventAudit,
    readAccessFilter
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
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;

  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const newRevision = await createRevision({
    feature,
    user: res.locals.eventAudit,
    baseVersion: revision.version,
    changes: revision,
    environments,
  });
  await updateFeature(
    org,
    res.locals.eventAudit,
    feature,
    {
      hasDrafts: true,
    },
    readAccessFilter
  );

  res.status(200).json({
    status: 200,
    version: newRevision.version,
  });
}

export async function postFeatureDiscard(
  req: AuthRequest<never, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;

  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  if (revision.status !== "draft") {
    throw new Error("Can only discard draft revisions");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  await discardRevision(revision, res.locals.eventAudit);

  const hasDrafts = await hasDraft(org.id, feature, [revision.version]);
  if (!hasDrafts) {
    await updateFeature(
      org,
      res.locals.eventAudit,
      feature,
      {
        hasDrafts: false,
      },
      readAccessFilter
    );
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
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;
  const { environment, rule } = req.body;

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const revision = await getDraftRevision(
    org,
    feature,
    parseInt(version),
    res.locals.eventAudit,
    readAccessFilter
  );

  await addFeatureRule(revision, environment, rule, res.locals.eventAudit);

  // If referencing a new experiment, add it to linkedExperiments
  if (
    rule.type === "experiment-ref" &&
    !feature.linkedExperiments?.includes(rule.experimentId)
  ) {
    await addLinkedFeatureToExperiment(
      org,
      res.locals.eventAudit,
      rule.experimentId,
      feature.id,
      readAccessFilter
    );
    await addLinkedExperiment(feature, rule.experimentId);
  }

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureExperimentRefRule(
  req: AuthRequest<{ rule: ExperimentRefRule }, { id: string }>,
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
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

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);

  req.checkPermissions(
    "publishFeatures",
    feature.project,
    getEnabledEnvironments(feature, environments)
  );

  const experiment = await getExperimentById(
    org.id,
    rule.experimentId,
    readAccessFilter
  );
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
    feature,
    user: res.locals.eventAudit,
    baseVersion: feature.version,
    publish: true,
    changes,
    environments,
    comment: `Add Experiment - ${experiment.name}`,
  });

  updates.version = revision.version;

  if (!feature.linkedExperiments?.includes(experiment.id)) {
    updates.linkedExperiments = feature.linkedExperiments || [];
    updates.linkedExperiments.push(experiment.id);
  }

  const updatedFeature = await updateFeature(
    org,
    res.locals.eventAudit,
    feature,
    updates,
    readAccessFilter
  );

  await addLinkedFeatureToExperiment(
    org,
    res.locals.eventAudit,
    rule.experimentId,
    feature.id,
    readAccessFilter,
    experiment
  );

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

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

async function getDraftRevision(
  org: OrganizationInterface,
  feature: FeatureInterface,
  version: number,
  user: EventAuditUser,
  readAccessFilter: ReadAccessFilter
): Promise<FeatureRevisionInterface> {
  // This is the published version, create a new draft revision
  if (version === feature.version) {
    const newRevision = await createRevision({
      feature,
      user,
      environments: getEnvironmentIdsFromOrg(org),
    });

    await updateFeature(
      org,
      user,
      feature,
      {
        hasDrafts: true,
      },
      readAccessFilter
    );

    return newRevision;
  }

  // If this is already a draft, return it
  const revision = await getRevision(feature.organization, feature.id, version);
  if (!revision) {
    throw new Error("Cannot find revision");
  }
  if (revision.status !== "draft") {
    throw new Error("Can only make changes to draft revisions");
  }

  return revision;
}

export async function putRevisionComment(
  req: AuthRequest<{ comment: string }, { id: string; version: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;
  const { comment } = req.body;

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  await updateRevision(
    revision,
    { comment },
    {
      user: res.locals.eventAudit,
      action: "edit comment",
      subject: "",
      value: JSON.stringify({ comment }),
    }
  );

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureDefaultValue(
  req: AuthRequest<{ defaultValue: string }, { id: string; version: string }>,
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;
  const { defaultValue } = req.body;

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const revision = await getDraftRevision(
    org,
    feature,
    parseInt(version),
    res.locals.eventAudit,
    readAccessFilter
  );

  await setDefaultValue(revision, defaultValue, res.locals.eventAudit);

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureSchema(
  req: AuthRequest<{ schema: string; enabled: boolean }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org, readAccessFilter } = getOrgFromReq(req);
  const { id } = req.params;
  const { schema, enabled } = req.body;
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const updatedFeature = await setJsonSchema(
    org,
    res.locals.eventAudit,
    feature,
    schema,
    readAccessFilter,
    enabled
  );

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
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;
  const { environment, rule, i } = req.body;

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const revision = await getDraftRevision(
    org,
    feature,
    parseInt(version),
    res.locals.eventAudit,
    readAccessFilter
  );

  await editFeatureRule(revision, environment, i, rule, res.locals.eventAudit);

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function postFeatureToggle(
  req: AuthRequest<{ environment: string; state: boolean }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, state } = req.body;
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("publishFeatures", feature.project, [environment]);

  const currentState =
    feature.environmentSettings?.[environment]?.enabled || false;

  // If we're already in the desired state, no need to update
  // This can be caused by race conditions (e.g. two people with the feature open, both toggling at the same time)
  if (currentState === state) {
    return res.status(200).json({
      status: 200,
    });
  }

  await toggleFeatureEnvironment(
    org,
    res.locals.eventAudit,
    feature,
    environment,
    state,
    readAccessFilter
  );

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
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;
  const { environment, from, to } = req.body;
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }
  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const revision = await getDraftRevision(
    org,
    feature,
    parseInt(version),
    res.locals.eventAudit,
    readAccessFilter
  );

  const changes = { rules: revision.rules || {} };
  const rules = changes.rules[environment];
  if (!rules || !rules[from] || !rules[to]) {
    throw new Error("Invalid rule index");
  }
  const rule = rules[from];
  changes.rules[environment] = arrayMove(rules, from, to);

  await updateRevision(revision, changes, {
    user: res.locals.eventAudit,
    action: "move rule",
    subject: `in ${environment} from position ${from + 1} to ${to + 1}`,
    value: JSON.stringify(rule),
  });

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function deleteFeatureRule(
  req: AuthRequest<
    { environment: string; i: number },
    { id: string; version: string }
  >,
  res: Response<
    { status: 200; version: number },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;
  const { environment, i } = req.body;

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }
  if (!environments.includes(environment)) {
    throw new Error("Invalid environment");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const revision = await getDraftRevision(
    org,
    feature,
    parseInt(version),
    res.locals.eventAudit,
    readAccessFilter
  );

  const changes = { rules: revision.rules || {} };
  const rules = changes.rules[environment];
  if (!rules || !rules[i]) {
    throw new Error("Invalid rule index");
  }

  const rule = rules[i];

  changes.rules[environment] = rules.slice();
  changes.rules[environment].splice(i, 1);

  await updateRevision(revision, changes, {
    user: res.locals.eventAudit,
    action: "delete rule",
    subject: `in ${environment} (position ${i + 1})`,
    value: JSON.stringify(rule),
  });

  res.status(200).json({
    status: 200,
    version: revision.version,
  });
}

export async function putFeature(
  req: AuthRequest<Partial<FeatureInterface>, { id: string }>,
  res: Response<
    { status: 200; feature: FeatureInterface },
    EventAuditUserForResponseLocals
  >
) {
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);

  const updates = req.body;

  // Changing the project can affect whether or not it's published if using project-scoped api keys
  if ("project" in updates) {
    // Make sure they have access in both the old and new environments
    req.checkPermissions("manageFeatures", updates.project);
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      getEnabledEnvironments(feature, environments)
    );
    req.checkPermissions(
      "publishFeatures",
      updates.project,
      getEnabledEnvironments(feature, environments)
    );
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

  const updatedFeature = await updateFeature(
    org,
    res.locals.eventAudit,
    feature,
    updates,
    readAccessFilter
  );

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
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { id } = req.params;
  const { org, environments, readAccessFilter } = getOrgFromReq(req);

  const feature = await getFeature(org.id, id, readAccessFilter);

  if (feature) {
    req.checkPermissions("manageFeatures", feature.project);
    req.checkPermissions("createFeatureDrafts", feature.project);
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      getEnabledEnvironments(feature, environments)
    );
    await deleteFeature(org, res.locals.eventAudit, feature, readAccessFilter);
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
    { attributes: Record<string, boolean | string | number | object> },
    { id: string; version: string }
  >,
  res: Response<
    { status: 200; results: FeatureTestResult[] },
    EventAuditUserForResponseLocals
  >
) {
  const { id, version } = req.params;
  const { org, readAccessFilter } = getOrgFromReq(req);
  const { attributes } = req.body;

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  const groupMap = await getSavedGroupMap(org);
  const experimentMap = await getAllPayloadExperiments(org.id);
  const environments = getEnvironments(org);
  const results = evaluateFeature({
    feature,
    revision,
    attributes,
    groupMap,
    experimentMap,
    environments,
  });

  res.status(200).json({
    status: 200,
    results: results,
  });
}

export async function postFeatureArchive(
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { id } = req.params;
  const { org, environments, readAccessFilter } = getOrgFromReq(req);
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }
  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions(
    "publishFeatures",
    feature.project,
    getEnabledEnvironments(feature, environments)
  );
  const updatedFeature = await archiveFeature(
    org,
    res.locals.eventAudit,
    feature,
    !feature.archived,
    readAccessFilter
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
  req: AuthRequest<unknown, unknown, { project?: string }>,
  res: Response
) {
  const { org, userId, readAccessFilter } = getOrgFromReq(req);

  const teams = await getTeamsForOrganization(org.id);

  const currentUserPermissions = getUserPermissions(userId, org, teams || []);

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const { features, experiments } = await getAllFeaturesWithLinkedExperiments(
    org.id,
    readAccessFilter,
    project
  );

  const filteredFeatures = features.filter((feature) =>
    hasPermission(currentUserPermissions, "readData", feature.project)
  );

  const filteredExperiments = experiments.filter((experiment) =>
    hasPermission(currentUserPermissions, "readData", experiment.project)
  );

  res.status(200).json({
    status: 200,
    features: filteredFeatures,
    linkedExperiments: filteredExperiments,
  });
}

export async function getRevisionLog(
  req: AuthRequest<null, { id: string; version: string }>,
  res: Response
) {
  const { org, readAccessFilter } = getOrgFromReq(req);
  const { id, version } = req.params;

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  const revision = await getRevision(org.id, feature.id, parseInt(version));
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  res.json({
    status: 200,
    log: revision.log || [],
  });
}

export async function getFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org, environments, userId, readAccessFilter } = getOrgFromReq(req);
  const { id } = req.params;

  const teams = await getTeamsForOrganization(org.id);

  const currentUserPermissions = getUserPermissions(userId, org, teams || []);

  const feature = await getFeature(org.id, id, readAccessFilter);
  if (!feature) {
    throw new Error("Could not find feature");
  }

  if (!hasPermission(currentUserPermissions, "readData", feature.project)) {
    throw new Error("You do not have access to view this feature.");
  }

  let revisions = await getRevisions(org.id, id);

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
    const exps = await getExperimentsByTrackingKeys(
      org.id,
      [...trackingKeys],
      readAccessFilter
    );
    exps.forEach((exp) => {
      experimentsMap.set(exp.id, exp);
      experimentIds.delete(exp.id);
    });
  }
  if (experimentIds.size) {
    const exps = await getExperimentsByIds(
      org.id,
      [...experimentIds],
      readAccessFilter
    );
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

  res.status(200).json({
    status: 200,
    feature,
    revisions,
    experiments: [...experimentsMap.values()],
  });
}

export async function getRealtimeUsage(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
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
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { id } = req.params;
  const { org, readAccessFilter } = getOrgFromReq(req);
  const feature = await getFeature(org.id, id, readAccessFilter);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);

  await updateFeature(
    org,
    res.locals.eventAudit,
    feature,
    {
      neverStale: !feature.neverStale,
    },
    readAccessFilter
  );

  res.status(200).json({
    status: 200,
  });
}
