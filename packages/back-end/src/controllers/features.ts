import { Request, Response } from "express";
import {
  ExperimentRefRule,
  FeatureDraftChanges,
  FeatureInterface,
  FeatureRule,
} from "../../types/feature";
import { AuthRequest } from "../types/AuthRequest";
import { getOrgFromReq } from "../services/organizations";
import {
  addFeatureRule,
  createFeature,
  deleteFeature,
  setFeatureDraftRules,
  editFeatureRule,
  getAllFeatures,
  getFeature,
  publishLegacyDraft,
  setDefaultValue,
  toggleFeatureEnvironment,
  updateFeature,
  archiveFeature,
  getDraftRules,
  discardDraft,
  updateLegacyDraft,
  setJsonSchema,
  addExperimentRefRule,
  deleteExperimentRefRule,
} from "../models/FeatureModel";
import { getRealtimeUsageByHour } from "../models/RealtimeModel";
import { lookupOrganizationByApiKey } from "../models/ApiKeyModel";
import {
  addIdsToRules,
  arrayMove,
  getFeatureDefinitions,
  verifyDraftsAreEqual,
} from "../services/features";
import {
  getExperimentByTrackingKey,
  getExperimentsByIds,
} from "../models/ExperimentModel";
import { FeatureUsageRecords } from "../../types/realtime";
import {
  auditDetailsCreate,
  auditDetailsUpdate,
  auditDetailsDelete,
} from "../services/audit";
import { getPublishedFeatureRevisions } from "../models/FeatureRevisionModel";
import { getEnabledEnvironments } from "../util/features";
import { ExperimentInterface } from "../../types/experiment";
import {
  findSDKConnectionByKey,
  markSDKConnectionUsed,
} from "../models/SdkConnectionModel";
import { logger } from "../util/logger";
import { addTagsDiff } from "../models/TagModel";
import { FASTLY_SERVICE_ID } from "../util/secrets";
import { EventAuditUserForResponseLocals } from "../events/event-types";
import { upsertWatch } from "../models/WatchModel";
import { getSurrogateKeysFromSDKPayloadKeys } from "../util/cdn.util";
import { SDKPayloadKey } from "../../types/sdk-payload";

class UnrecoverableApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableApiError";
  }
}

async function getPayloadParamsFromApiKey(
  key: string,
  req: Request
): Promise<{
  organization: string;
  project: string;
  environment: string;
  encrypted: boolean;
  encryptionKey?: string;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  hashSecureAttributes?: boolean;
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
      environment: connection.environment,
      project: connection.project,
      encrypted: connection.encryptPayload,
      encryptionKey: connection.encryptionKey,
      includeVisualExperiments: connection.includeVisualExperiments,
      includeDraftExperiments: connection.includeDraftExperiments,
      includeExperimentNames: connection.includeExperimentNames,
      hashSecureAttributes: connection.hashSecureAttributes,
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
      environment: environment || "production",
      project: projectFilter,
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
      environment,
      encrypted,
      project,
      encryptionKey,
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      hashSecureAttributes,
    } = await getPayloadParamsFromApiKey(key, req);

    const defs = await getFeatureDefinitions({
      organization,
      environment,
      project,
      encryptionKey: encrypted ? encryptionKey : "",
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      hashSecureAttributes,
    });

    // Cache for 30 seconds, serve stale up to 1 hour (10 hours if origin is down)
    res.set(
      "Cache-control",
      "public, max-age=30, stale-while-revalidate=3600, stale-if-error=36000"
    );

    // If using Fastly, add surrogate key header for cache purging
    if (FASTLY_SERVICE_ID) {
      // Purge by org, API Key, or payload contents
      const payloadKey: SDKPayloadKey = { environment, project };
      const surrogateKeys = [
        organization,
        key,
        ...getSurrogateKeysFromSDKPayloadKeys(organization, [payloadKey]),
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

export async function postFeatures(
  req: AuthRequest<Partial<FeatureInterface>>,
  res: Response<
    { status: 200; feature: FeatureInterface },
    EventAuditUserForResponseLocals
  >
) {
  const { id, environmentSettings, ...otherProps } = req.body;
  const { org, userId, email, userName } = getOrgFromReq(req);

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
  const existing = await getFeature(org.id, id);
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
    environmentSettings,
    ...otherProps,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    id: id.toLowerCase(),
    archived: false,
    revision: {
      version: 1,
      comment: "New feature",
      date: new Date(),
      publishedBy: {
        id: userId,
        email,
        name: userName,
      },
    },
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
    getEnabledEnvironments(feature)
  );

  addIdsToRules(feature.environmentSettings, feature.id);

  await createFeature(org, res.locals.eventAudit, feature);
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

// todo: deprecate this maybe?
export async function postFeaturePublish(
  req: AuthRequest<
    { draft: FeatureDraftChanges; comment?: string },
    { id: string }
  >,
  res: Response
) {
  const { org, email, userId, userName } = getOrgFromReq(req);
  const { id } = req.params;
  const { draft, comment } = req.body;

  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  // todo: check revisions
  if (!feature.draft?.active) {
    throw new Error("There are no changes to publish.");
  }

  req.checkPermissions("manageFeatures", feature.project);

  // If changing the default value, it affects all enabled environments
  if ("defaultValue" in draft) {
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      getEnabledEnvironments(feature)
    );
  }
  // Otherwise, only the environments with rule changes are affected
  else {
    const draftRules = draft.rules || {};
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      [...getEnabledEnvironments(feature)].filter((e) => e in draftRules)
    );
  }

  verifyDraftsAreEqual(feature.draft, draft);

  // todo: save draft FeatureRevision
  const updatedFeature = await publishLegacyDraft(
    org,
    feature,
    {
      id: userId,
      name: userName,
      email,
    },
    comment
  );

  await req.audit({
    event: "feature.publish",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: updatedFeature.revision?.version || 1,
      comment,
    }),
  });

  res.status(200).json({
    status: 200,
  });
}

// todo: use this
export async function postFeatureDiscard(
  req: AuthRequest<{ draft: FeatureDraftChanges }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { draft } = req.body;

  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  verifyDraftsAreEqual(feature.draft, draft);

  await discardDraft(org, res.locals.eventAudit, feature);

  res.status(200).json({
    status: 200,
  });
}

// todo: edit this
export async function postFeatureDraft(
  req: AuthRequest<
    {
      defaultValue: string;
      rules: Record<string, FeatureRule[]>;
      comment: string;
    },
    { id: string }
  >,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { defaultValue, rules, comment } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  // todo: replace with new draft editing functionality
  await updateLegacyDraft(org, res.locals.eventAudit, feature, {
    active: true,
    comment,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue,
    rules,
  });

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureRule(
  req: AuthRequest<{ rule: FeatureRule; environment: string }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, rule } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  await addFeatureRule(org, res.locals.eventAudit, feature, environment, rule);

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureExperimentRefRule(
  req: AuthRequest<{ rule: ExperimentRefRule }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { rule } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }
  if (
    rule.type !== "experiment-ref" ||
    !rule.experimentId ||
    !rule.variations ||
    !rule.variations.length
  ) {
    throw new Error("Invalid experiment rule");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  await addExperimentRefRule(org, res.locals.eventAudit, feature, rule);

  res.status(200).json({
    status: 200,
  });
}

export async function deleteFeatureExperimentRefRule(
  req: AuthRequest<{ experimentId: string }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { experimentId } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  await deleteExperimentRefRule(
    org,
    res.locals.eventAudit,
    feature,
    experimentId
  );

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureDefaultValue(
  req: AuthRequest<{ defaultValue: string }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { defaultValue } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  await setDefaultValue(org, res.locals.eventAudit, feature, defaultValue);

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureSchema(
  req: AuthRequest<{ schema: string; enabled: boolean }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { schema, enabled } = req.body;
  const feature = await getFeature(org.id, id);

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
    { id: string }
  >,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, rule, i } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  await editFeatureRule(
    org,
    res.locals.eventAudit,
    feature,
    environment,
    i,
    rule
  );

  res.status(200).json({
    status: 200,
  });
}

export async function postFeatureToggle(
  req: AuthRequest<{ environment: string; state: boolean }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, state } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("publishFeatures", feature.project, [environment]);

  const currentState =
    feature.environmentSettings?.[environment]?.enabled || false;

  await toggleFeatureEnvironment(
    org,
    res.locals.eventAudit,
    feature,
    environment,
    state
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
    { id: string }
  >,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, from, to } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const rules = getDraftRules(feature, environment);
  if (!rules[from] || !rules[to]) {
    throw new Error("Invalid rule index");
  }

  const newRules = arrayMove(rules, from, to);

  await setFeatureDraftRules(
    org,
    res.locals.eventAudit,
    feature,
    environment,
    newRules
  );

  res.status(200).json({
    status: 200,
  });
}

export async function deleteFeatureRule(
  req: AuthRequest<{ environment: string; i: number }, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { environment, i } = req.body;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions("createFeatureDrafts", feature.project);

  const rules = getDraftRules(feature, environment);

  const newRules = rules.slice();
  newRules.splice(i, 1);

  await setFeatureDraftRules(
    org,
    res.locals.eventAudit,
    feature,
    environment,
    newRules
  );

  res.status(200).json({
    status: 200,
  });
}

export async function putFeature(
  req: AuthRequest<Partial<FeatureInterface>, { id: string }>,
  res: Response<
    { status: 200; feature: FeatureInterface },
    EventAuditUserForResponseLocals
  >
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

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
      getEnabledEnvironments(feature)
    );
    req.checkPermissions(
      "publishFeatures",
      updates.project,
      getEnabledEnvironments(feature)
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
    updates
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
  const { org } = getOrgFromReq(req);

  const feature = await getFeature(org.id, id);

  if (feature) {
    req.checkPermissions("manageFeatures", feature.project);
    req.checkPermissions("createFeatureDrafts", feature.project);
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      getEnabledEnvironments(feature)
    );
    await deleteFeature(org, res.locals.eventAudit, feature);
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

export async function postFeatureArchive(
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }, EventAuditUserForResponseLocals>
) {
  const { id } = req.params;
  const { org } = getOrgFromReq(req);
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }
  req.checkPermissions("manageFeatures", feature.project);
  req.checkPermissions(
    "publishFeatures",
    feature.project,
    getEnabledEnvironments(feature)
  );
  const updatedFeature = await archiveFeature(
    org,
    res.locals.eventAudit,
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
  req: AuthRequest<unknown, unknown, { project?: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  let project = "";
  if (typeof req.query?.project === "string") {
    project = req.query.project;
  }

  const features = await getAllFeatures(org.id, project);

  res.status(200).json({
    status: 200,
    features,
  });
}

export async function getFeatureById(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const feature = await getFeature(org.id, id);

  if (!feature) {
    throw new Error("Could not find feature");
  }

  // Get linked experiments from rule and draft rules
  const experimentIds: Set<string> = new Set();
  const trackingKeys: Set<string> = new Set();
  if (feature.environmentSettings) {
    Object.values(feature.environmentSettings).forEach((env) => {
      env.rules?.forEach((r) => {
        if (r.type === "experiment") {
          trackingKeys.add(r.trackingKey || feature.id);
        } else if (r.type === "experiment-ref") {
          experimentIds.add(r.experimentId);
        }
      });
    });
  }
  if (feature.draft && feature.draft.active && feature.draft.rules) {
    Object.values(feature.draft.rules).forEach((rules) => {
      rules.forEach((r) => {
        if (r.type === "experiment") {
          trackingKeys.add(r.trackingKey || feature.id);
        } else if (r.type === "experiment-ref") {
          experimentIds.add(r.experimentId);
        }
      });
    });
  }

  const experiments: { [key: string]: ExperimentInterface } = {};
  if (trackingKeys.size > 0) {
    await Promise.all(
      Array.from(trackingKeys).map(async (key) => {
        const exp = await getExperimentByTrackingKey(org.id, key);
        if (exp) {
          experiments[exp.id] = exp;
        }
      })
    );
  }
  if (experimentIds.size > 0) {
    const docs = await getExperimentsByIds(org.id, Array.from(experimentIds));
    docs.forEach((doc) => {
      experiments[doc.id] = doc;
    });
  }

  const revisions = await getPublishedFeatureRevisions(org.id, id);

  res.status(200).json({
    status: 200,
    feature,
    experiments,
    revisions,
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
