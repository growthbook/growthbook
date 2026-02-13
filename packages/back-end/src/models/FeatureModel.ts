import lodash from "lodash";
import mongoose, { FilterQuery } from "mongoose";
import { MergeResultChanges, getApiFeatureEnabledEnvs } from "shared/util";
import {
  SafeRolloutInterface,
  SafeRolloutRule,
  simpleSchemaValidator,
} from "shared/validators";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureMetaInfo,
  FeatureRule,
  JSONSchemaDef,
  LegacyFeatureInterface,
} from "shared/types/feature";
import { EventUser } from "shared/types/events/event-types";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ResourceEvents } from "shared/types/events/base-types";
import { DiffResult } from "shared/types/events/diff";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import {
  generateRuleId,
  getApiFeatureObj,
  getNextScheduledUpdate,
  getSavedGroupMap,
  queueSDKPayloadRefresh,
} from "back-end/src/services/features";
import { upgradeFeatureInterface } from "back-end/src/util/migrations";
import { ReqContext } from "back-end/types/request";
import {
  applyEnvironmentInheritance,
  getAffectedSDKPayloadKeys,
  getSDKPayloadKeysByDiff,
} from "back-end/src/util/features";
import { logger } from "back-end/src/util/logger";
import {
  getContextForAgendaJobByOrgId,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { ApiReqContext } from "back-end/types/api";
import { getChangedApiFeatureEnvironments } from "back-end/src/events/handlers/utils";
import { determineNextSafeRolloutSnapshotAttempt } from "back-end/src/enterprise/saferollouts/safeRolloutUtils";
import {
  createVercelExperimentationItemFromFeature,
  updateVercelExperimentationItemFromFeature,
  deleteVercelExperimentationItemFromFeature,
} from "back-end/src/services/vercel-native-integration.service";
import { getObjectDiff } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { runValidateFeatureHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  createEvent,
  hasPreviousObject,
  CreateEventData,
  CreateEventParams,
} from "./EventModel.js";
import {
  addLinkedFeatureToExperiment,
  getExperimentMapForFeature,
  removeLinkedFeatureFromExperiment,
} from "./ExperimentModel.js";
import {
  createInitialRevision,
  createRevisionFromLegacyDraft,
  deleteAllRevisionsForFeature,
  getRevision,
  hasDraft,
  markRevisionAsPublished,
  updateRevision,
} from "./FeatureRevisionModel.js";

const { cloneDeep, omit, isEqual } = lodash;

const featureSchema = new mongoose.Schema({
  id: String,
  archived: Boolean,
  description: String,
  organization: String,
  nextScheduledUpdate: Date,
  owner: String,
  project: String,
  dateCreated: Date,
  dateUpdated: Date,
  version: Number,
  valueType: String,
  defaultValue: String,
  environments: [String],
  tags: [String],
  rules: [
    {
      _id: false,
      id: String,
      type: {
        type: String,
      },
      trackingKey: String,
      value: String,
      coverage: Number,
      hashAttribute: String,
      fallbackAttribute: String,
      disableStickyBucketing: Boolean,
      bucketVersion: Number,
      minBucketVersion: Number,
      enabled: Boolean,
      condition: String,
      savedGroups: [
        {
          _id: false,
          ids: [String],
          match: String,
        },
      ],
      description: String,
      experimentId: String,
      values: [
        {
          _id: false,
          value: String,
          weight: Number,
        },
      ],
      variations: [
        {
          _id: false,
          variationId: String,
          value: String,
        },
      ],
      namespace: {},
      scheduleRules: [
        {
          timestamp: String,
          enabled: Boolean,
        },
      ],
    },
  ],
  prerequisites: [
    {
      _id: false,
      id: String,
      condition: String,
    },
  ],
  environmentSettings: {},
  draft: {},
  legacyDraftMigrated: Boolean,
  hasDrafts: Boolean,
  revision: {},
  linkedExperiments: [String],
  jsonSchema: {},
  neverStale: Boolean,
  customFields: {},
  holdout: {
    id: String,
    value: String,
  },
});

featureSchema.index({ id: 1, organization: 1 }, { unique: true });
featureSchema.index({ organization: 1, project: 1 });

type FeatureDocument = mongoose.Document & LegacyFeatureInterface;

export const FeatureModel = mongoose.model<LegacyFeatureInterface>(
  "Feature",
  featureSchema,
);

/**
 * Convert the Mongo document to an FeatureInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (
  doc: FeatureDocument,
  context: ReqContext | ApiReqContext,
): FeatureInterface => {
  const featureInterface = omit(doc.toJSON<FeatureDocument>(), ["__v", "_id"]);
  featureInterface.environmentSettings = applyEnvironmentInheritance(
    context.org.settings?.environments || [],
    featureInterface.environmentSettings || {},
  );
  return featureInterface;
};

export async function getAllFeatures(
  context: ReqContext | ApiReqContext,
  {
    projects,
    includeArchived = false,
  }: { projects?: string[]; includeArchived?: boolean } = {},
): Promise<FeatureInterface[]> {
  const q: FilterQuery<FeatureDocument> = { organization: context.org.id };
  if (projects && projects.length === 1) {
    q.project = projects[0];
  } else if (projects && projects.length > 1) {
    q.project = { $in: projects };
  }

  if (!includeArchived) {
    q.archived = { $ne: true };
  }

  const features = (await FeatureModel.find(q)).map((m) =>
    upgradeFeatureInterface(toInterface(m, context)),
  );

  return features.filter((feature) =>
    context.permissions.canReadSingleProjectResource(feature.project),
  );
}

function featureListQuery(
  orgId: string,
  opts: { project?: string; projectIds?: string[]; includeArchived?: boolean },
): FilterQuery<FeatureDocument> {
  const { project, projectIds, includeArchived = false } = opts;
  return {
    organization: orgId,
    ...(project != null
      ? { project }
      : projectIds != null
        ? { project: { $in: projectIds } }
        : {}),
    ...(includeArchived ? {} : { archived: { $ne: true } }),
  };
}

export async function getFeaturesPage(
  context: ReqContext | ApiReqContext,
  {
    project,
    projectIds,
    includeArchived = false,
    limit = 10,
    offset = 0,
  }: {
    project?: string;
    projectIds?: string[];
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<FeatureInterface[]> {
  if (projectIds?.length === 0) return [];
  const q = featureListQuery(context.org.id, {
    project,
    projectIds,
    includeArchived,
  });
  const docs = await FeatureModel.find(q)
    .sort({ _id: 1 })
    .skip(offset)
    .limit(limit);
  return docs
    .map((m) => upgradeFeatureInterface(toInterface(m, context)))
    .filter((feature) =>
      context.permissions.canReadSingleProjectResource(feature.project),
    );
}

export async function countFeatures(
  context: ReqContext | ApiReqContext,
  {
    project,
    projectIds,
    includeArchived = false,
  }: { project?: string; projectIds?: string[]; includeArchived?: boolean },
): Promise<number> {
  if (projectIds?.length === 0) return 0;
  return FeatureModel.countDocuments(
    featureListQuery(context.org.id, { project, projectIds, includeArchived }),
  );
}

export async function hasArchivedFeatures(
  context: ReqContext | ApiReqContext,
  project?: string,
): Promise<boolean> {
  const q: FilterQuery<FeatureDocument> = {
    organization: context.org.id,
    archived: true,
  };
  if (project) {
    q.project = project;
  }

  const f = await FeatureModel.findOne(q);
  return !!f;
}

export async function getFeature(
  context: ReqContext | ApiReqContext,
  id: string,
): Promise<FeatureInterface | null> {
  const feature = await FeatureModel.findOne({
    organization: context.org.id,
    id,
  });
  if (!feature) return null;

  return context.permissions.canReadSingleProjectResource(feature.project)
    ? upgradeFeatureInterface(toInterface(feature, context))
    : null;
}

export async function migrateDraft(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  if (!feature.legacyDraft || feature.legacyDraftMigrated) return null;

  try {
    const draft = await createRevisionFromLegacyDraft(context, feature);
    await FeatureModel.updateOne(
      {
        organization: feature.organization,
        id: feature.id,
      },
      {
        $set: {
          legacyDraftMigrated: true,
          hasDrafts: true,
        },
      },
    );
    return draft;
  } catch (e) {
    logger.error(e, "Error migrating old feature draft");
  }
  return null;
}

export async function getFeaturesByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<FeatureInterface[]> {
  if (!ids.length) return [];
  const features = (
    await FeatureModel.find({ organization: context.org.id, id: { $in: ids } })
  ).map((m) => upgradeFeatureInterface(toInterface(m, context)));

  return features.filter((feature) =>
    context.permissions.canReadSingleProjectResource(feature.project),
  );
}

export async function createFeature(
  context: ReqContext | ApiReqContext,
  data: FeatureInterface,
) {
  const { org } = context;

  const linkedExperiments = getLinkedExperiments(
    data,
    getEnvironmentIdsFromOrg(org),
  );

  const featureToCreate = {
    ...data,
    linkedExperiments,
  };

  // Run any custom hooks for this feature
  await runValidateFeatureHooks({
    context,
    feature: featureToCreate,
    original: null,
  });

  const feature = await FeatureModel.create(featureToCreate);

  // Historically, we haven't properly removed revisions when deleting a feature
  // So, clean up any conflicting revisions first before creating a new one
  await deleteAllRevisionsForFeature(org.id, feature.id);

  await createInitialRevision(
    context,
    toInterface(feature, context),
    context.auditUser,
    getEnvironmentIdsFromOrg(org),
  );

  if (linkedExperiments.length > 0) {
    await Promise.all(
      linkedExperiments.map(async (exp) => {
        await addLinkedFeatureToExperiment(context, exp, data.id);
      }),
    );
  }

  onFeatureCreate(context, feature).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on feature create");
  });
}

export async function deleteFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  await FeatureModel.deleteOne({
    organization: context.org.id,
    id: feature.id,
  });
  await deleteAllRevisionsForFeature(context.org.id, feature.id);
  await context.models.featureRevisionLogs.deleteAllByFeature(feature);

  if (feature.linkedExperiments) {
    await Promise.all(
      feature.linkedExperiments.map(async (exp) => {
        await removeLinkedFeatureFromExperiment(context, exp, feature.id);
      }),
    );
  }

  onFeatureDelete(context, feature).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on feature delete");
  });
}

/**
 * Deletes all features belonging to a project
 * @param projectId
 * @param organization
 */
export async function deleteAllFeaturesForAProject({
  projectId,
  context,
}: {
  projectId: string;
  context: ReqContext | ApiReqContext;
}) {
  const featuresToDelete = await FeatureModel.find({
    organization: context.org.id,
    project: projectId,
  });

  for (const feature of featuresToDelete) {
    await deleteFeature(context, feature);
  }
}

export const createFeatureEvent = async <
  Event extends ResourceEvents<"feature">,
>(eventData: {
  context: ReqContext;
  event: Event;
  data: CreateEventData<"feature", Event, FeatureInterface>;
}) => {
  const event: CreateEventParams<"feature", Event> = await (async () => {
    const groupMap = await getSavedGroupMap(eventData.context);
    const experimentMap = await getExperimentMapForFeature(
      eventData.context,
      eventData.data.object.id,
    );

    const currentRevision = await getRevision({
      context: eventData.context,
      organization: eventData.data.object.organization,
      featureId: eventData.data.object.id,
      version: eventData.data.object.version,
    });

    const safeRolloutMap =
      await eventData.context.models.safeRollout.getAllPayloadSafeRollouts();

    const currentApiFeature = getApiFeatureObj({
      feature: eventData.data.object,
      organization: eventData.context.org,
      groupMap,
      experimentMap,
      revision: currentRevision,
      safeRolloutMap,
    });

    if (!hasPreviousObject<"feature", Event, FeatureInterface>(eventData.data))
      return {
        ...eventData,
        object: "feature",
        data: {
          object: currentApiFeature,
        },
        projects: [currentApiFeature.project],
        tags: currentApiFeature.tags,
        environments: getApiFeatureEnabledEnvs(currentApiFeature),
        containsSecrets: false,
      } as CreateEventParams<"feature", Event>;

    const previousRevision = await getRevision({
      context: eventData.context,
      organization: eventData.data.previous_object.organization,
      featureId: eventData.data.previous_object.id,
      version: eventData.data.previous_object.version,
    });

    const previousApiFeature = getApiFeatureObj({
      feature: eventData.data.previous_object,
      organization: eventData.context.org,
      groupMap,
      experimentMap,
      revision: previousRevision,
      safeRolloutMap,
    });

    let changes: DiffResult | undefined;
    try {
      changes = getObjectDiff(previousApiFeature, currentApiFeature, {
        ignoredKeys: ["dateUpdated", "date"],
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "id",
            ignoredKeys: ["definition", "savedGroups"],
            arrayField: "rules",
          },
        ],
      });
    } catch (e) {
      logger.error(e, "error creating change patch");
    }

    return {
      ...eventData,
      object: "feature",
      objectId: eventData.data.object.id,
      data: {
        object: currentApiFeature,
        previous_object: previousApiFeature,
        changes,
      },
      projects: Array.from(
        new Set([previousApiFeature.project, currentApiFeature.project]),
      ),
      tags: Array.from(
        new Set([...previousApiFeature.tags, ...currentApiFeature.tags]),
      ),
      environments: getChangedApiFeatureEnvironments(
        previousApiFeature,
        currentApiFeature,
      ),
      containsSecrets: false,
    } as CreateEventParams<"feature", Event>;
  })();

  await createEvent<"feature", Event>(event);
};

/**
 * Given the common {@link FeatureInterface} for both previous and next states, and the organization,
 * will log an update event in the events collection
 * @param organization
 * @param previous
 * @param current
 */
export const logFeatureUpdatedEvent = async (
  context: ReqContext | ApiReqContext,
  previous: FeatureInterface,
  current: FeatureInterface,
) =>
  createFeatureEvent({
    context,
    event: "updated",
    data: {
      object: current,
      previous_object: previous,
    },
  });

/**
 * @param organization
 * @param feature
 * @returns event.id
 */
export const logFeatureCreatedEvent = async (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) =>
  createFeatureEvent({
    context,
    event: "created",
    data: {
      object: feature,
    },
  });

/**
 * @param organization
 * @param previousFeature
 */
export const logFeatureDeletedEvent = async (
  context: ReqContext | ApiReqContext,
  previousFeature: FeatureInterface,
) =>
  createFeatureEvent({
    context,
    event: "deleted",
    data: {
      object: previousFeature,
    },
  });

async function onFeatureCreate(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(context.org),
    ),
    auditContext: {
      event: "created",
      model: "feature",
      id: feature.id,
    },
  });

  await logFeatureCreatedEvent(context, feature);

  if (context.org.isVercelIntegration)
    await createVercelExperimentationItemFromFeature({
      feature,
      organization: context.org,
    });
}

async function onFeatureDelete(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(context.org),
    ),
    auditContext: {
      event: "deleted",
      model: "feature",
      id: feature.id,
    },
  });

  await logFeatureDeletedEvent(context, feature);

  if (context.org.isVercelIntegration)
    await deleteVercelExperimentationItemFromFeature({
      feature,
      organization: context.org,
    });
}

export async function onFeatureUpdate(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  updatedFeature: FeatureInterface,
  skipRefreshForProject?: string,
) {
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getSDKPayloadKeysByDiff(
      feature,
      updatedFeature,
      getEnvironmentIdsFromOrg(context.org),
    ),
    skipRefreshForProject,
    auditContext: {
      event: "updated",
      model: "feature",
      id: feature.id,
    },
  });

  // Don't fire webhooks if only `dateUpdated` changes (ex: creating/modifying a unpublished draft)
  if (
    !isEqual(
      omit(feature, ["dateUpdated", "hasDrafts"]),
      omit(updatedFeature, ["dateUpdated", "hasDrafts"]),
    )
  ) {
    // Event-based webhooks
    await logFeatureUpdatedEvent(context, feature, updatedFeature);
  }

  if (context.org.isVercelIntegration)
    await updateVercelExperimentationItemFromFeature({
      feature: updatedFeature,
      organization: context.org,
    });
}

export async function updateFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  updates: Partial<FeatureInterface>,
): Promise<FeatureInterface> {
  const allUpdates = {
    ...updates,
    dateUpdated: new Date(),
  };
  const updatedFeature = {
    ...feature,
    ...allUpdates,
  };

  // Refresh linkedExperiments if needed
  const linkedExperiments = getLinkedExperiments(
    updatedFeature,
    getEnvironmentIdsFromOrg(context.org),
  );
  const experimentsAdded = new Set<string>();
  if (!isEqual(linkedExperiments, feature.linkedExperiments)) {
    allUpdates.linkedExperiments = linkedExperiments;
    updatedFeature.linkedExperiments = linkedExperiments;

    // New experiments this feature was added to
    linkedExperiments.forEach((exp) => {
      if (!feature.linkedExperiments?.includes(exp)) {
        experimentsAdded.add(exp);
      }
    });
  }

  await runValidateFeatureHooks({
    context,
    feature: updatedFeature,
    original: feature,
  });

  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    {
      $set: allUpdates,
    },
  );

  if (experimentsAdded.size > 0) {
    await Promise.all(
      [...experimentsAdded].map(async (exp) => {
        await addLinkedFeatureToExperiment(context, exp, feature.id);
      }),
    );
  }

  onFeatureUpdate(context, feature, updatedFeature).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on feature update");
  });

  return updatedFeature;
}

export async function addLinkedExperiment(
  feature: FeatureInterface,
  experimentId: string,
) {
  if (feature.linkedExperiments?.includes(experimentId)) return;

  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    {
      $addToSet: {
        linkedExperiments: experimentId,
      },
    },
  );
}

export async function getScheduledFeaturesToUpdate() {
  const features = await FeatureModel.find({
    nextScheduledUpdate: {
      $exists: true,
      $lt: new Date(),
    },
  });
  const orgIds = Array.from(new Set(features.map((f) => f.organization)));
  const jobContextsByOrg: Record<string, ApiReqContext> = {};
  await Promise.all(
    orgIds.map(async (orgId) => {
      jobContextsByOrg[orgId] = await getContextForAgendaJobByOrgId(orgId);
    }),
  );
  return features.map((m) =>
    upgradeFeatureInterface(toInterface(m, jobContextsByOrg[m.organization])),
  );
}

export async function archiveFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  isArchived: boolean,
) {
  return await updateFeature(context, feature, { archived: isArchived });
}

function setEnvironmentSettings(
  feature: FeatureInterface,
  environment: string,
  settings: Partial<FeatureEnvironment>,
) {
  const updatedFeature = cloneDeep(feature);

  updatedFeature.environmentSettings = updatedFeature.environmentSettings || {};
  updatedFeature.environmentSettings[environment] = updatedFeature
    .environmentSettings[environment] || { enabled: false, rules: [] };

  updatedFeature.environmentSettings[environment] = {
    ...updatedFeature.environmentSettings[environment],
    ...settings,
  };

  return updatedFeature;
}

export async function toggleMultipleEnvironments(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  toggles: Record<string, boolean>,
) {
  const validEnvs = new Set(getEnvironmentIdsFromOrg(context.org));

  let featureCopy = cloneDeep(feature);
  let hasChanges = false;
  Object.keys(toggles).forEach((env) => {
    if (!validEnvs.has(env)) {
      throw new Error("Invalid environment: " + env);
    }
    const state = toggles[env];
    const currentState = feature.environmentSettings?.[env]?.enabled ?? false;
    if (currentState !== state) {
      hasChanges = true;
      featureCopy = setEnvironmentSettings(featureCopy, env, {
        enabled: state,
      });
    }
  });

  // If there are changes we need to apply
  if (hasChanges) {
    const updatedFeature = await updateFeature(context, feature, {
      environmentSettings: featureCopy.environmentSettings,
    });

    return updatedFeature;
  }

  return featureCopy;
}

export async function toggleFeatureEnvironment(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  environment: string,
  state: boolean,
) {
  return await toggleMultipleEnvironments(context, feature, {
    [environment]: state,
  });
}

export async function addFeatureRule(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  envs: string[],
  rule: FeatureRule,
  user: EventUser,
  resetReview: boolean,
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }

  const changes = {
    rules: revision.rules ? cloneDeep(revision.rules) : {},
    status: revision.status,
  };
  envs.forEach((env) => {
    changes.rules[env] = changes.rules[env] || [];
    changes.rules[env].push(rule);
  });
  await updateRevision(
    context,
    feature,
    revision,
    changes,
    {
      user,
      action: "add rule",
      subject: `to ${envs.join(", ")}`,
      value: JSON.stringify(rule),
    },
    resetReview,
  );
}

export async function editFeatureRule(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  environment: string,
  i: number,
  updates: Partial<FeatureRule>,
  user: EventUser,
  resetReview: boolean,
) {
  const changes = {
    rules: revision.rules ? cloneDeep(revision.rules) : {},
    status: revision.status,
  };

  changes.rules[environment] = changes.rules[environment] || [];
  if (!changes.rules[environment][i]) {
    throw new Error("Unknown rule");
  }

  changes.rules[environment][i] = {
    ...changes.rules[environment][i],
    ...updates,
  } as FeatureRule;
  await updateRevision(
    context,
    feature,
    revision,
    changes,
    {
      user,
      action: "edit rule",
      subject: `in ${environment} (position ${i + 1})`,
      value: JSON.stringify(updates),
    },
    resetReview,
  );
}

export async function copyFeatureEnvironmentRules(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  sourceEnv: string,
  targetEnv: string,
  user: EventUser,
  resetReview: boolean,
) {
  const changes = {
    rules: revision.rules ? cloneDeep(revision.rules) : {},
    status: revision.status,
  };
  changes.rules[targetEnv] = changes.rules[sourceEnv] || [];
  await updateRevision(
    context,
    feature,
    revision,
    changes,
    {
      user,
      action: "copy rules",
      subject: `from ${sourceEnv} to ${targetEnv}`,
      value: JSON.stringify(changes.rules[sourceEnv]),
    },
    resetReview,
  );
}

export async function removeTagInFeature(
  context: ReqContext | ApiReqContext,
  tag: string,
) {
  const query = { organization: context.org.id, tags: tag };

  const featureDocs = await FeatureModel.find(query);
  const features = (featureDocs || []).map((m) => toInterface(m, context));

  await FeatureModel.updateMany(query, {
    $pull: { tags: tag },
  });

  features.forEach((feature) => {
    const updatedFeature = {
      ...feature,
      tags: (feature.tags || []).filter((t) => t !== tag),
    };

    onFeatureUpdate(context, feature, updatedFeature).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature update");
    });
  });
}

export async function removeHoldoutFromFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  if (!feature.holdout) return;
  await FeatureModel.updateOne(
    { organization: context.org.id, id: feature.id },
    { $unset: { holdout: "" } },
  );
}

export async function removeProjectFromFeatures(
  context: ReqContext | ApiReqContext,
  project: string,
) {
  const query = { organization: context.org.id, project };

  const featureDocs = await FeatureModel.find(query);
  const features = (featureDocs || []).map((m) => toInterface(m, context));

  await FeatureModel.updateMany(query, { $set: { project: "" } });

  features.forEach((feature) => {
    const updatedFeature = {
      ...feature,
      project: "",
    };

    onFeatureUpdate(context, feature, updatedFeature, project).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature update");
    });
  });
}

export async function setDefaultValue(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  defaultValue: string,
  user: EventUser,
  requireReview: boolean,
) {
  await updateRevision(
    context,
    feature,
    revision,
    { defaultValue },
    {
      user,
      action: "edit default value",
      subject: ``,
      value: JSON.stringify({ defaultValue }),
    },
    requireReview,
  );
}

export async function setJsonSchema(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  def: Omit<JSONSchemaDef, "date">,
) {
  // Validate Simple Schema (sanity check)
  if (def.schemaType === "simple" && def.simple) {
    simpleSchemaValidator.parse(def.simple);
  }

  return await updateFeature(context, feature, {
    jsonSchema: { ...def, date: new Date() },
  });
}

const updateSafeRolloutStatuses = async (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
) => {
  const safeRolloutStatusesMap: Record<
    string,
    { status: "running" | "rolled-back" | "released" | "stopped" }
  > = Object.fromEntries(
    Object.values(revision.rules)
      .flat()
      .filter((rule) => rule.type === "safe-rollout")
      .map((rule: SafeRolloutRule) => {
        return [rule.safeRolloutId, { status: rule.status }];
      }),
  );
  // stop safe rollouts that have been removed from the in the revision
  Object.keys(feature.environmentSettings)
    .flatMap((env) => feature.environmentSettings[env].rules)
    .forEach((rule: FeatureRule) => {
      if (
        rule.type === "safe-rollout" &&
        !safeRolloutStatusesMap[rule.safeRolloutId]
      ) {
        safeRolloutStatusesMap[rule.safeRolloutId] = { status: "stopped" };
      }
    });

  const safeRollouts = await context.models.safeRollout.getByIds(
    Object.keys(safeRolloutStatusesMap),
  );

  safeRollouts.forEach((safeRollout) => {
    // sync the status of the safe rollout to the status of the revision
    const safeRolloutUpdates: Partial<SafeRolloutInterface> = {
      status: safeRolloutStatusesMap[safeRollout.id].status,
    };
    if (!safeRollout.startedAt && safeRolloutUpdates.status === "running") {
      safeRolloutUpdates["startedAt"] = new Date();
      const { nextSnapshot, nextRampUp } =
        determineNextSafeRolloutSnapshotAttempt(safeRollout, context.org);
      safeRolloutUpdates["nextSnapshotAttempt"] = nextSnapshot;
      safeRolloutUpdates["rampUpSchedule"] = {
        ...safeRollout.rampUpSchedule,
        nextUpdate: nextRampUp,
      };
    }

    context.models.safeRollout.update(safeRollout, safeRolloutUpdates);
  });
};

export async function applyRevisionChanges(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
) {
  let hasChanges = false;
  const changes: Partial<FeatureInterface> = {};
  if (result.defaultValue !== undefined) {
    changes.defaultValue = result.defaultValue;
    hasChanges = true;
  }

  const environments = getEnvironmentIdsFromOrg(context.org);

  environments.forEach((env) => {
    const rules = result.rules?.[env];
    if (!rules) return;

    changes.environmentSettings =
      changes.environmentSettings ||
      cloneDeep(feature.environmentSettings || {});
    changes.environmentSettings[env] = changes.environmentSettings[env] || {};
    changes.environmentSettings[env].enabled =
      changes.environmentSettings[env].enabled || false;
    changes.environmentSettings[env].rules = rules;
    hasChanges = true;
  });

  if (!hasChanges) {
    throw new Error("No changes to publish");
  }

  if (changes.environmentSettings) {
    changes.nextScheduledUpdate = getNextScheduledUpdate(
      changes.environmentSettings,
      environments,
    );
  }

  changes.version = revision.version;

  // Update the `hasDrafts` field
  changes.hasDrafts = await hasDraft(context.org.id, feature, [
    revision.version,
  ]);
  await updateSafeRolloutStatuses(context, feature, revision);
  return await updateFeature(context, feature, changes);
}

export async function publishRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
  comment?: string,
) {
  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error("Can only publish a draft revision");
  }

  // TODO: wrap these 2 calls in a transaction
  const updatedFeature = await applyRevisionChanges(
    context,
    feature,
    revision,
    result,
  );

  await markRevisionAsPublished(
    context,
    feature,
    revision,
    context.auditUser,
    comment,
  );

  return updatedFeature;
}

function getLinkedExperiments(
  feature: FeatureInterface,
  environments: string[],
) {
  // Always start from the list of existing linked experiments
  // Even if an experiment is removed from a feature, there should still be a link
  // Otherwise, viewing a past revision of a feature will be broken
  const expIds: Set<string> = new Set(feature.linkedExperiments || []);

  // Add any missing one from the published rules
  environments.forEach((env) => {
    const rules = feature.environmentSettings?.[env]?.rules;
    if (!rules) return;
    rules.forEach((rule) => {
      if (rule.type === "experiment-ref") {
        expIds.add(rule.experimentId);
      }
    });
  });

  return [...expIds];
}

//TODO: I don't see this being called anywhere - can we remove?
export async function toggleNeverStale(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  neverStale: boolean,
) {
  return await updateFeature(context, feature, { neverStale });
}

export async function hasNonDemoFeature(context: ReqContext | ApiReqContext) {
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    context.org.id,
  );
  const feature = await FeatureModel.findOne(
    {
      organization: context.org.id,
      project: { $ne: demoProjectId },
    },
    { _id: 1 },
  );
  return !!feature;
}

export async function getFeatureMetaInfoById(
  context: ReqContext | ApiReqContext,
  includeDefaultValue = false,
): Promise<FeatureMetaInfo[]> {
  const projection: Record<string, number> = {
    id: 1,
    project: 1,
    archived: 1,
    dateCreated: 1,
    tags: 1,
    owner: 1,
    valueType: 1,
  };
  if (includeDefaultValue) {
    projection.defaultValue = 1;
  }

  const features = await FeatureModel.find(
    { organization: context.org.id },
    projection,
  );

  return features.map((f) => ({
    id: f.id,
    project: f.project,
    archived: f.archived,
    dateCreated: f.dateCreated,
    tags: f.tags,
    owner: f.owner,
    valueType: f.valueType,
    ...(includeDefaultValue && { defaultValue: f.defaultValue ?? "" }),
  }));
}

export async function getFeatureMetaInfoByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<FeatureMetaInfo[]> {
  if (!ids.length) return [];

  const features = await FeatureModel.find(
    { organization: context.org.id, id: { $in: ids } },
    {
      id: 1,
      project: 1,
      archived: 1,
      dateCreated: 1,
      tags: 1,
      owner: 1,
      valueType: 1,
    },
  );

  return features.map((f) => ({
    id: f.id,
    project: f.project,
    archived: f.archived,
    dateCreated: f.dateCreated,
    tags: f.tags,
    owner: f.owner,
    valueType: f.valueType,
  }));
}
