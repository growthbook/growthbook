import mongoose, { FilterQuery } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import {
  MergeResultChanges,
  getApiFeatureEnabledEnvs,
  getApiFeatureAllEnvs,
  checkIfRevisionNeedsReview,
  autoMerge,
  fillRevisionFromFeature,
  PermissionError,
} from "shared/util";
import {
  SafeRolloutInterface,
  SafeRolloutRule,
  simpleSchemaValidator,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RevisionRampAction,
  RevisionRampCreateAction,
  RampStepAction,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureMetaInfo,
  FeatureRule,
  JSONSchemaDef,
  LegacyFeatureInterface,
} from "shared/types/feature";
import { EventUser } from "shared/types/events/event-types";
import { OrganizationInterface } from "shared/types/organization";
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
import { remapTemplateActions } from "back-end/src/services/rampSchedule";
import { upgradeFeatureInterface } from "back-end/src/util/migrations";
import { ReqContext } from "back-end/types/request";
import {
  applyEnvironmentInheritance,
  getAffectedSDKPayloadKeys,
  getSDKPayloadKeysByDiff,
} from "back-end/src/util/features";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
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
} from "./EventModel";
import {
  addLinkedFeatureToExperiment,
  getExperimentById,
  getExperimentMapForFeature,
  removeLinkedFeatureFromExperiment,
  updateExperiment,
} from "./ExperimentModel";
import {
  createInitialRevision,
  createRevisionFromLegacyDraft,
  deleteAllRevisionsForFeature,
  getRevision,
  markRevisionAsPublished,
  updateRevision,
  createRevision,
} from "./FeatureRevisionModel";

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
        environments:
          eventData.event === "deleted"
            ? getApiFeatureAllEnvs(currentApiFeature)
            : getApiFeatureEnabledEnvs(currentApiFeature),
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
      omit(feature, ["dateUpdated"]),
      omit(updatedFeature, ["dateUpdated"]),
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

// Targeted write for the scheduled-features cron job. Bypasses onFeatureUpdate
// to avoid generating an audit event for this system-driven housekeeping change.
export async function updateNextScheduledDate(
  feature: FeatureInterface,
  nextScheduledUpdate: Date | null,
): Promise<FeatureInterface> {
  const dateUpdated = new Date();
  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    { $set: { nextScheduledUpdate, dateUpdated } },
  );
  return {
    ...feature,
    nextScheduledUpdate: nextScheduledUpdate ?? undefined,
    dateUpdated,
  };
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
      $ne: null,
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
  await editFeatureRules(
    context,
    feature,
    revision,
    [{ environmentId: environment, i }],
    updates,
    user,
    resetReview,
  );
}

export async function editFeatureRules(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  matches: { environmentId: string; i: number }[],
  updates: Partial<FeatureRule>,
  user: EventUser,
  resetReview: boolean,
) {
  const projected = applyPartialFeatureRuleUpdatesToRevision(
    revision,
    matches,
    updates,
  );
  const changes = {
    rules: projected.rules ?? {},
    status: projected.status,
  };

  const subject =
    matches.length === 1
      ? `in ${matches[0].environmentId} (position ${matches[0].i + 1})`
      : `in ${matches.map((m) => m.environmentId).join(", ")}`;

  const updatedRevision = await updateRevision(
    context,
    feature,
    revision,
    changes,
    {
      user,
      action: "edit rule",
      subject,
      value: JSON.stringify(updates),
    },
    resetReview,
  );
  return updatedRevision;
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
  // Fall back to live rules for any env not yet modified in this draft,
  // matching the mergeRevision behavior the frontend uses for the diff preview.
  const effectiveSourceRules =
    changes.rules[sourceEnv] ??
    feature.environmentSettings?.[sourceEnv]?.rules ??
    [];
  changes.rules[targetEnv] = effectiveSourceRules;
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
  return updateRevision(
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
  // If the revision has no rules at all, there are no rule changes to process
  // and no safe rollout statuses to update.
  if (!revision.rules) return;

  const safeRolloutStatusesMap: Record<
    string,
    { status: "running" | "rolled-back" | "released" | "stopped" }
  > = Object.fromEntries(
    Object.values(revision.rules)
      .flat()
      .filter((rule) => rule?.type === "safe-rollout")
      .map((rule: SafeRolloutRule) => {
        return [rule.safeRolloutId, { status: rule.status }];
      }),
  );
  // stop safe rollouts that have been removed from the in the revision
  Object.keys(feature.environmentSettings ?? {})
    .flatMap((env) => feature.environmentSettings[env]?.rules ?? [])
    .forEach((rule: FeatureRule) => {
      if (
        rule?.type === "safe-rollout" &&
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
    const safeRolloutUpdates: UpdateProps<SafeRolloutInterface> = {
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
    const envEnabled = result.environmentsEnabled?.[env];

    if (rules === undefined && envEnabled === undefined) return;

    changes.environmentSettings =
      changes.environmentSettings ||
      cloneDeep(feature.environmentSettings || {});
    changes.environmentSettings[env] = changes.environmentSettings[env] || {};
    changes.environmentSettings[env].enabled =
      changes.environmentSettings[env].enabled || false;

    if (rules !== undefined) {
      changes.environmentSettings[env].rules = rules;
    }
    if (envEnabled !== undefined) {
      changes.environmentSettings[env].enabled = envEnabled;
    }
    hasChanges = true;
  });

  if (result.prerequisites !== undefined) {
    changes.prerequisites = result.prerequisites;
    hasChanges = true;
  }

  if (result.archived !== undefined) {
    changes.archived = result.archived;
    hasChanges = true;
  }

  if (result.holdout !== undefined) {
    // null means remove from holdout; object means set/change holdout
    changes.holdout = result.holdout ?? undefined;
    hasChanges = true;
  }

  if (result.metadata) {
    const m = result.metadata;
    if (m.description !== undefined) changes.description = m.description;
    if (m.owner !== undefined) changes.owner = m.owner;
    if (m.project !== undefined) changes.project = m.project;
    if (m.tags !== undefined) changes.tags = m.tags;
    if (m.neverStale !== undefined) changes.neverStale = m.neverStale;
    if (m.customFields !== undefined)
      changes.customFields = m.customFields as Record<string, unknown>;
    if (m.jsonSchema !== undefined) changes.jsonSchema = m.jsonSchema;
    hasChanges = true;
  }

  // When a draft only activates a ramp schedule (no feature content changes),
  // there's nothing to write to the feature document — just return it as-is so
  // the caller can still mark the revision as published and trigger lifecycle hooks.
  if (!hasChanges) {
    // However, if we have pending ramp actions to execute, we still need to update
    // the feature version so the live pointer advances correctly
    if (revision.rampActions && revision.rampActions.length > 0) {
      changes.version = revision.version;
      changes.dateUpdated = new Date();
      return await updateFeature(context, feature, changes);
    }
    return feature;
  }

  if (changes.environmentSettings) {
    changes.nextScheduledUpdate = getNextScheduledUpdate(
      changes.environmentSettings,
      environments,
    );
  }

  changes.version = revision.version;

  await updateSafeRolloutStatuses(context, feature, revision);
  return await updateFeature(context, feature, changes);
}

/**
 * Run HoldoutModel / Experiment side-effects when a feature's holdout membership
 * changes at publish time. Called automatically by publishRevision when result.holdout
 * is defined, so all publish paths (direct, approval flow, revert, etc.) are covered.
 *
 * @param feature     The feature's state *before* the publish (used for prevHoldout).
 * @param newHoldout  The incoming holdout value, or null to remove from holdout.
 */
export async function applyHoldoutSideEffects(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  newHoldout: { id: string; value: string } | null,
) {
  const prevHoldoutId = feature.holdout?.id;
  const newHoldoutId = newHoldout?.id;

  if (newHoldoutId === prevHoldoutId) return;

  // Guard: cannot change holdout when there are running experiments, bandits, or safe rollouts
  if (newHoldout !== null) {
    const experiments = await Promise.all(
      (feature.linkedExperiments ?? []).map((id) =>
        getExperimentById(context, id),
      ),
    );
    const hasNonDraftExperiments = experiments.some(
      (exp) => exp?.status !== "draft",
    );
    const hasBandits = experiments.some(
      (exp) => exp?.type === "multi-armed-bandit",
    );
    const hasSafeRollouts = Object.values(feature.environmentSettings).some(
      (env) => (env?.rules ?? []).some((rule) => rule?.type === "safe-rollout"),
    );
    if (hasNonDraftExperiments || hasBandits || hasSafeRollouts) {
      throw new Error(
        "Cannot change holdout when there are running linked experiments, safe rollout rules, or multi-armed bandit rules",
      );
    }
  }

  // Remove feature from the old holdout
  if (prevHoldoutId) {
    await context.models.holdout.removeFeatureFromHoldout(
      prevHoldoutId,
      feature.id,
    );
  }

  // Link feature (and its experiments) to the new holdout
  if (newHoldoutId) {
    const holdoutObj = await context.models.holdout.getById(newHoldoutId);
    if (!holdoutObj) {
      throw new Error("Holdout not found");
    }

    await context.models.holdout.updateById(newHoldoutId, {
      linkedFeatures: {
        [feature.id]: { id: feature.id, dateAdded: new Date() },
        ...holdoutObj.linkedFeatures,
      },
      ...(feature.linkedExperiments?.length
        ? {
            linkedExperiments: {
              ...Object.fromEntries(
                feature.linkedExperiments.map((experimentId) => [
                  experimentId,
                  { id: experimentId, dateAdded: new Date() },
                ]),
              ),
              ...holdoutObj.linkedExperiments,
            },
          }
        : {}),
    });

    if (feature.linkedExperiments?.length) {
      const linkedExperiments = await Promise.all(
        feature.linkedExperiments.map((eid) => getExperimentById(context, eid)),
      );
      await Promise.all(
        linkedExperiments.map(async (exp) => {
          if (!exp) return;
          return updateExperiment({
            context,
            experiment: exp,
            changes: { holdoutId: newHoldoutId },
          });
        }),
      );
    }
  }
}

/**
 * Create ramp schedules for all `mode === "create"` actions in a revision.
 * Called BEFORE the feature write so that a schedule creation failure prevents publish.
 * Returns the IDs of created schedules for rollback on subsequent failure.
 */
async function createRampSchedulesForRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: { version: number },
  actions: RevisionRampAction[],
): Promise<string[]> {
  const createdIds: string[] = [];

  for (const action of actions) {
    if (action.mode !== "create") continue;

    // Pro gate — see postRampSchedule.ts for rationale.
    if (!context.hasPremiumFeature("schedule-feature-flag")) {
      context.throwPlanDoesNotAllowError(
        "Ramp schedules require a Pro plan or above.",
      );
    }

    const targetId = uuidv4();

    // Inject the generated targetId into every action. The caller's targetId
    // is ignored — there is exactly one target per revision create action.
    const normalizeAction = (
      a: RevisionRampCreateAction["steps"][number]["actions"][number],
    ): RampStepAction => ({
      targetType: "feature-rule" as const,
      targetId,
      patch: { ...a.patch, ruleId: action.ruleId } as RampStepAction["patch"],
    });

    // Template is used as a fallback; explicit steps/endActions win.
    let template: RampScheduleTemplateInterface | undefined;
    if (action.templateId) {
      const tmpl = await context.models.rampScheduleTemplates.getById(
        action.templateId,
      );
      if (!tmpl) {
        logger.warn(
          { templateId: action.templateId },
          "Ramp schedule template not found at revision publish time — skipping template",
        );
      } else {
        template = tmpl;
      }
    }

    const defaultName = `Ramp schedule \u2013 ${new Date().toLocaleDateString(
      "en-US",
      { month: "short", year: "numeric" },
    )}`;

    const startDate = action.startDate ? new Date(action.startDate) : undefined;

    const endCondition = action.endCondition?.trigger
      ? { trigger: action.endCondition.trigger }
      : undefined;

    const steps: RampScheduleInterface["steps"] =
      action.steps.length > 0
        ? action.steps.map((step) => ({
            ...step,
            actions: step.actions.map(normalizeAction),
          }))
        : template
          ? template.steps.map((s) => ({
              trigger: s.trigger,
              actions: remapTemplateActions(
                s.actions,
                targetId,
                action.ruleId,
                feature.valueType,
              ),
              approvalNotes: s.approvalNotes ?? undefined,
            }))
          : [];

    // null = explicitly cleared (skip template); undefined = not set (fall back to template).
    const endActions: RampStepAction[] =
      action.endActions !== undefined
        ? Array.isArray(action.endActions)
          ? action.endActions.map(normalizeAction)
          : []
        : template?.endPatch && Object.keys(template.endPatch).length > 0
          ? [
              {
                targetType: "feature-rule" as const,
                targetId,
                patch: {
                  ruleId: action.ruleId,
                  ...template.endPatch,
                } as RampStepAction["patch"],
              },
            ]
          : [];

    const created = await context.models.rampSchedules.create({
      name: action.name ?? defaultName,
      entityType: "feature",
      entityId: feature.id,
      targets: [
        {
          id: targetId,
          entityType: "feature",
          entityId: feature.id,
          ruleId: action.ruleId,
          // null = patches apply to all environments sharing this ruleId.
          // A specific environment = patches are scoped to that env only.
          environment: action.environment ?? null,
          status: "active",
          // Link this target to the activating revision so onRevisionPublished
          // (and the Agenda recovery path) can transition "pending" → "running".
          activatingRevisionVersion: revision.version,
        },
      ],
      steps,
      endActions: endActions.length > 0 ? endActions : undefined,
      startDate,
      endCondition,
      // Start as "pending" — onActivatingRevisionPublished handles the
      // immediate → "running" transition inline when the revision publishes.
      status: "pending",
      currentStepIndex: -1,
      nextStepAt:
        !startDate && steps.length > 0 ? new Date() : (startDate ?? null),
      startedAt: null,
      phaseStartedAt: null,
    });

    createdIds.push(created.id);
  }

  return createdIds;
}

/**
 * Apply detach/update ramp actions stored on a revision.
 * Best-effort: logs errors but does not throw, since these run after the feature is published.
 */
async function applyDetachRampActions(
  context: ReqContext | ApiReqContext,
  actions: RevisionRampAction[],
) {
  for (const action of actions) {
    if (action.mode !== "detach") continue;
    try {
      const existing = await context.models.rampSchedules.getById(
        action.rampScheduleId,
      );
      if (existing) {
        const remainingTargets = existing.targets.filter(
          (t) => t.ruleId !== action.ruleId,
        );
        if (action.deleteScheduleWhenEmpty && remainingTargets.length === 0) {
          await context.models.rampSchedules.deleteById(existing.id);
        } else {
          await context.models.rampSchedules.updateById(existing.id, {
            targets: remainingTargets,
          });
        }
      }
    } catch (err) {
      logger.error(err, {
        msg: "Failed to apply revision ramp detach action",
        action,
      });
    }
  }
}

async function cleanupOrphanedRampSchedules(
  context: ReqContext | ApiReqContext,
  oldFeature: FeatureInterface,
  newFeature: FeatureInterface,
) {
  try {
    // When publishing a change that modifies rules, clean up ramp schedules that
    // become orphaned. This handles several scenarios:
    // 1. Rules that target a ramp are deleted → ramp is cleaned up
    // 2. Reverting to an older revision that predates a ramp's creation → ramp's
    //    targets (from newer revisions) are removed, orphaning the ramp → cleanup deletes it
    // 3. Reverting back to a newer revision with a ramp → the ramp is recreated via
    //    the inline "create" action on the rule (natural behavior)
    //
    // Note: If a ramp schedule is deleted and then we revert to a future revision
    // where it should exist, the "create" action will not fire again. The user must
    // re-create the ramp. This is the safe, explicit behavior.

    // Collect all rule IDs that existed in the old feature.
    const oldRuleIds = new Set<string>();
    Object.values(oldFeature.environmentSettings ?? {}).forEach((env) => {
      (env?.rules ?? []).forEach((rule) => {
        if (rule?.id) {
          oldRuleIds.add(rule.id);
        }
      });
    });

    // Collect all rule IDs in the new feature.
    const newRuleIds = new Set<string>();
    Object.values(newFeature.environmentSettings ?? {}).forEach((env) => {
      (env?.rules ?? []).forEach((rule) => {
        if (rule?.id) {
          newRuleIds.add(rule.id);
        }
      });
    });

    // Find rule IDs that were removed (existed in old but not in new).
    const deletedRuleIds = Array.from(oldRuleIds).filter(
      (id) => !newRuleIds.has(id),
    );

    // Query all ramp schedules for this feature and check if any targets
    // reference the deleted rules.
    const allRamps = await context.models?.rampSchedules?.getAllByFeatureId?.(
      newFeature.id,
    );

    if (!allRamps) return;

    for (const ramp of allRamps) {
      const remainingTargets = (ramp?.targets ?? []).filter(
        (target: RampScheduleInterface["targets"][0]) => {
          // Keep targets that reference rules that still exist.
          return target?.ruleId && !deletedRuleIds.includes(target.ruleId);
        },
      );

      // If no implementations remain, delete the ramp.
      if (
        remainingTargets.length === 0 &&
        (ramp?.targets ?? []).length > 0 &&
        ramp?.id
      ) {
        await context.models?.rampSchedules?.deleteById?.(ramp.id);
      }
    }
  } catch (error) {
    // Log but don't throw — cleanup is a nice-to-have, not essential for publish to succeed.
    logger.error("Error cleaning up orphaned ramp schedules", error);
  }
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

  // Create ramp schedules BEFORE writing the feature so that a schedule
  // creation failure gates the publish (atomicity: no published feature without
  // its ramp schedule).
  const createActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "create",
  );
  const preCreatedScheduleIds: string[] = [];
  if (createActions.length) {
    const ids = await createRampSchedulesForRevision(
      context,
      feature,
      revision,
      createActions,
    );
    preCreatedScheduleIds.push(...ids);
  }

  let updatedFeature: FeatureInterface;
  try {
    updatedFeature = await applyRevisionChanges(
      context,
      feature,
      revision,
      result,
    );

    if (result.holdout !== undefined) {
      await applyHoldoutSideEffects(context, feature, result.holdout);
    }

    await markRevisionAsPublished(
      context,
      feature,
      revision,
      context.auditUser,
      comment,
    );
  } catch (err) {
    // Roll back pre-created ramp schedules so they don't linger as orphans.
    for (const id of preCreatedScheduleIds) {
      try {
        await context.models.rampSchedules.deleteById(id);
      } catch (deleteErr) {
        logger.error(
          deleteErr,
          `Failed to delete orphaned ramp schedule ${id} during publish rollback`,
        );
      }
    }
    throw err;
  }

  // Apply detach actions (best-effort: logged but do not fail publish).
  if (revision.rampActions?.length) {
    await applyDetachRampActions(context, revision.rampActions);
  }

  // Clean up orphaned ramp schedules (best-effort).
  await cleanupOrphanedRampSchedules(context, feature, updatedFeature);

  return updatedFeature;
}

// Create a new revision from the given changes and immediately publish it.
// Either the revision is published and the updated feature is returned, or an
// error is thrown — a pending-review draft is never silently left behind.
// canBypassApprovalChecks should be true when the org-level restApiBypassesReviews
// setting is on, or when the caller's role/token grants bypassApprovalChecks
// on the feature's project.
export async function createAndPublishRevision({
  context,
  feature,
  user,
  org,
  changes,
  comment,
  canBypassApprovalChecks,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  user: EventUser;
  org: OrganizationInterface;
  changes: Parameters<typeof createRevision>[0]["changes"];
  comment?: string;
  canBypassApprovalChecks: boolean;
}): Promise<{
  revision: FeatureRevisionInterface;
  updatedFeature: FeatureInterface;
}> {
  const allEnvironments = getEnvironmentIdsFromOrg(org);

  // Determine whether the revision would require review before we create anything.
  // We need a synthetic revision to check against, mirroring what createRevision would build.
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    version: feature.version,
  });
  if (!liveRevision) throw new Error("Could not load live revision");

  // Build a temporary revision shape for the review check. Merge rules per-environment
  // so that sparse changes.rules doesn't wipe untouched environments to [].
  const syntheticRevision: FeatureRevisionInterface = {
    ...liveRevision,
    ...(changes ?? {}),
    rules: {
      ...liveRevision.rules,
      ...(changes?.rules ?? {}),
    },
  };
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: liveRevision,
    revision: syntheticRevision,
    allEnvironments,
    settings: org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });

  if (requiresReview && !canBypassApprovalChecks) {
    throw new PermissionError(
      "This feature requires approval before changes can be published. " +
        "Enable 'REST API always bypasses approval requirements' in organization settings.",
    );
  }

  // Create the draft revision (never auto-publishes; publish=false).
  const revision = await createRevision({
    context,
    feature,
    user,
    baseVersion: feature.version,
    comment: comment ?? "Created via REST API",
    environments: allEnvironments,
    publish: false,
    changes,
    org,
    canBypassApprovalChecks,
  });

  // Compute the merge result the same way postFeaturePublish does —
  // filling sparse environmentsEnabled + holdout from the live feature.
  const featureEnvs: Record<string, boolean> = Object.fromEntries(
    Object.entries(feature.environmentSettings ?? {}).map(([envId, env]) => [
      envId,
      !!env.enabled,
    ]),
  );
  const fillEnvs = (r: FeatureRevisionInterface) => ({
    ...fillRevisionFromFeature(r, feature),
    environmentsEnabled: {
      ...featureEnvs,
      ...(r.environmentsEnabled ?? {}),
    },
    holdout: feature.holdout ?? null,
  });

  const mergeResult = autoMerge(
    fillEnvs(liveRevision),
    fillEnvs(liveRevision), // base === live for a fresh revision off HEAD
    revision,
    allEnvironments,
    {},
  );

  if (!mergeResult.success) {
    // Shouldn't happen for a brand-new revision off HEAD, but guard anyway.
    throw new Error(
      "Merge conflict detected while publishing revision. Please retry.",
    );
  }

  const updatedFeature = await publishRevision(
    context,
    feature,
    revision,
    mergeResult.result,
    comment,
  );

  return { revision, updatedFeature };
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
      if (rule?.type === "experiment-ref") {
        expIds.add(rule.experimentId);
      }
    });
  });

  return [...expIds];
}

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
  opts: {
    includeDefaultValue?: boolean;
    project?: string;
    ids?: string[];
  } = {},
): Promise<FeatureMetaInfo[]> {
  const { includeDefaultValue = false, project, ids } = opts;

  const query: Record<string, unknown> = { organization: context.org.id };
  if (project) {
    query.project = project;
  }
  if (ids?.length) {
    query.id = { $in: ids };
  }

  const projection: Record<string, number> = {
    id: 1,
    project: 1,
    archived: 1,
    description: 1,
    dateCreated: 1,
    dateUpdated: 1,
    tags: 1,
    owner: 1,
    valueType: 1,
    version: 1,
    linkedExperiments: 1,
    neverStale: 1,
    "jsonSchema.enabled": 1,
    revision: 1,
  };
  if (includeDefaultValue) {
    projection.defaultValue = 1;
  }

  const features = await FeatureModel.find(query, projection);

  return features
    .filter((f) => context.permissions.canReadSingleProjectResource(f.project))
    .map((f) => ({
      id: f.id,
      project: f.project,
      archived: f.archived,
      description: f.description,
      dateCreated: f.dateCreated,
      dateUpdated: f.dateUpdated,
      tags: f.tags,
      owner: f.owner,
      valueType: f.valueType,
      version: f.version,
      linkedExperiments: f.linkedExperiments,
      neverStale: f.neverStale,
      revision: f.revision as FeatureMetaInfo["revision"],
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
      description: 1,
      dateCreated: 1,
      dateUpdated: 1,
      tags: 1,
      owner: 1,
      valueType: 1,
      version: 1,
      linkedExperiments: 1,
      neverStale: 1,
      "jsonSchema.enabled": 1,
      revision: 1,
    },
  );

  return features
    .filter((f) => context.permissions.canReadSingleProjectResource(f.project))
    .map((f) => ({
      id: f.id,
      project: f.project,
      archived: f.archived,
      description: f.description,
      dateCreated: f.dateCreated,
      dateUpdated: f.dateUpdated,
      tags: f.tags,
      owner: f.owner,
      valueType: f.valueType,
      version: f.version,
      linkedExperiments: f.linkedExperiments,
      neverStale: f.neverStale,
      revision: f.revision as FeatureMetaInfo["revision"],
    }));
}

export async function getFeatureEnvStatus(
  context: ReqContext | ApiReqContext,
  ids?: string[],
): Promise<
  { id: string; environmentSettings: FeatureInterface["environmentSettings"] }[]
> {
  const q: FilterQuery<FeatureDocument> = { organization: context.org.id };
  if (ids && ids.length > 0) {
    q.id = { $in: ids };
  }

  // Push project-level read restrictions into the query to avoid fetching
  // documents that will be filtered out anyway.
  const allowedProjects =
    context.permissions.getProjectsWithPermission("readData");
  if (allowedProjects !== null) {
    if (allowedProjects.length === 0) return [];
    // Also include features with no project — they're globally accessible
    q.$or = [
      { project: { $in: allowedProjects } },
      { project: { $in: ["", null] } },
    ];
  }

  const docs = await FeatureModel.find(q, {
    id: 1,
    environmentSettings: 1,
  });

  return docs.map((f) => ({
    id: f.id,
    environmentSettings: applyEnvironmentInheritance(
      context.org.settings?.environments || [],
      f.environmentSettings || {},
    ),
  }));
}
