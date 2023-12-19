import mongoose, { FilterQuery } from "mongoose";
import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import { MergeResultChanges } from "shared/util";
import { ReadAccessFilter, hasReadAccess } from "shared/permissions";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../../types/feature";
import { ExperimentInterface } from "../../types/experiment";
import {
  generateRuleId,
  getApiFeatureObj,
  getNextScheduledUpdate,
  getSavedGroupMap,
  refreshSDKPayloadCache,
} from "../services/features";
import { upgradeFeatureInterface } from "../util/migrations";
import { OrganizationInterface } from "../../types/organization";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../events/notification-events";
import { EventNotifier } from "../events/notifiers/EventNotifier";
import {
  getAffectedSDKPayloadKeys,
  getSDKPayloadKeysByDiff,
} from "../util/features";
import { EventAuditUser } from "../events/event-types";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { logger } from "../util/logger";
import { getEnvironmentIdsFromOrg } from "../services/organizations";
import { createEvent } from "./EventModel";
import {
  addLinkedFeatureToExperiment,
  getExperimentMapForFeature,
  removeLinkedFeatureFromExperiment,
  getExperimentsByIds,
} from "./ExperimentModel";
import {
  createInitialRevision,
  createRevisionFromLegacyDraft,
  deleteAllRevisionsForFeature,
  hasDraft,
  markRevisionAsPublished,
  updateRevision,
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
  environmentSettings: {},
  draft: {},
  legacyDraftMigrated: Boolean,
  hasDrafts: Boolean,
  revision: {},
  linkedExperiments: [String],
  jsonSchema: {},
  neverStale: Boolean,
});

featureSchema.index({ id: 1, organization: 1 }, { unique: true });

type FeatureDocument = mongoose.Document & LegacyFeatureInterface;

const FeatureModel = mongoose.model<LegacyFeatureInterface>(
  "Feature",
  featureSchema
);

/**
 * Convert the Mongo document to an FeatureInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: FeatureDocument): FeatureInterface =>
  omit(doc.toJSON<FeatureDocument>(), ["__v", "_id"]);

export async function getAllFeatures(
  organization: string,
  readAccessFilter: ReadAccessFilter,
  project?: string
): Promise<FeatureInterface[]> {
  const q: FilterQuery<FeatureDocument> = { organization };
  if (project) {
    q.project = project;
  }

  const features = (await FeatureModel.find(q)).map((m) =>
    upgradeFeatureInterface(toInterface(m))
  );

  return features.filter((feature) =>
    hasReadAccess(readAccessFilter, [feature.project || ""])
  );
}

const _undefinedTypeGuard = (x: string[] | undefined): x is string[] =>
  typeof x !== "undefined";

export async function getAllFeaturesWithLinkedExperiments(
  organization: string,
  readAccessFilter: ReadAccessFilter,
  project?: string
): Promise<{
  features: FeatureInterface[];
  experiments: ExperimentInterface[];
}> {
  const q: FilterQuery<FeatureDocument> = { organization };
  if (project) {
    q.project = project;
  }

  const features = await FeatureModel.find(q);
  const expIds = new Set<string>(
    features
      .map((f) => f.linkedExperiments)
      .filter(_undefinedTypeGuard)
      .flat()
  );
  const experiments = await getExperimentsByIds(
    organization,
    [...expIds],
    readAccessFilter
  );

  const upgradedFeatures = features.map((m) =>
    upgradeFeatureInterface(toInterface(m))
  );

  return {
    features: upgradedFeatures.filter((feature) =>
      hasReadAccess(readAccessFilter, [feature.project || ""])
    ),
    experiments,
  };
}

export async function getFeature(
  organization: string,
  id: string,
  readAccessFilter: ReadAccessFilter
): Promise<FeatureInterface | null> {
  const doc = await FeatureModel.findOne({ organization, id });
  if (!doc) return null;

  const feature = upgradeFeatureInterface(toInterface(doc));

  return hasReadAccess(readAccessFilter, [feature.project || ""])
    ? feature
    : null;
}

export async function migrateDraft(feature: FeatureInterface) {
  if (!feature.legacyDraft || feature.legacyDraftMigrated) return null;

  try {
    const draft = await createRevisionFromLegacyDraft(feature);
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
      }
    );
    return draft;
  } catch (e) {
    logger.error(e, "Error migrating old feature draft");
  }
  return null;
}

export async function getFeaturesByIds(
  organization: string,
  ids: string[],
  readAccessFilter: ReadAccessFilter
): Promise<FeatureInterface[]> {
  const features = (
    await FeatureModel.find({ organization, id: { $in: ids } })
  ).map((m) => upgradeFeatureInterface(toInterface(m)));

  return features.filter((feature) =>
    hasReadAccess(readAccessFilter, [feature.project || ""])
  );
}

export async function createFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  data: FeatureInterface,
  readAccessFilter: ReadAccessFilter
) {
  const linkedExperiments = getLinkedExperiments(
    data,
    getEnvironmentIdsFromOrg(org)
  );
  const feature = await FeatureModel.create({
    ...data,
    linkedExperiments,
  });

  // Historically, we haven't properly removed revisions when deleting a feature
  // So, clean up any conflicting revisions first before creating a new one
  await deleteAllRevisionsForFeature(org.id, feature.id);

  await createInitialRevision(
    toInterface(feature),
    user,
    getEnvironmentIdsFromOrg(org)
  );

  if (linkedExperiments.length > 0) {
    await Promise.all(
      linkedExperiments.map(async (exp) => {
        await addLinkedFeatureToExperiment(
          org,
          user,
          exp,
          data.id,
          readAccessFilter
        );
      })
    );
  }

  onFeatureCreate(org, user, feature, readAccessFilter);
}

export async function deleteFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  readAccessFilter: ReadAccessFilter
) {
  await FeatureModel.deleteOne({ organization: org.id, id: feature.id });
  await deleteAllRevisionsForFeature(org.id, feature.id);

  if (feature.linkedExperiments) {
    await Promise.all(
      feature.linkedExperiments.map(async (exp) => {
        await removeLinkedFeatureFromExperiment(
          org,
          user,
          exp,
          feature.id,
          readAccessFilter
        );
      })
    );
  }

  onFeatureDelete(org, user, feature, readAccessFilter);
}

/**
 * Deletes all features belonging to a project
 * @param projectId
 * @param organization
 * @param user
 */
export async function deleteAllFeaturesForAProject({
  projectId,
  organization,
  user,
  readAccessFilter,
}: {
  projectId: string;
  organization: OrganizationInterface;
  user: EventAuditUser;
  readAccessFilter: ReadAccessFilter;
}) {
  const featuresToDelete = await FeatureModel.find({
    organization: organization.id,
    project: projectId,
  });

  for (const feature of featuresToDelete) {
    await deleteFeature(organization, user, feature, readAccessFilter);
  }
}

/**
 * Given the common {@link FeatureInterface} for both previous and next states, and the organization,
 * will log an update event in the events collection
 * @param organization
 * @param user
 * @param previous
 * @param current
 */
async function logFeatureUpdatedEvent(
  organization: OrganizationInterface,
  user: EventAuditUser,
  previous: FeatureInterface,
  current: FeatureInterface,
  readAccessFilter: ReadAccessFilter
): Promise<string | undefined> {
  const groupMap = await getSavedGroupMap(organization);
  const experimentMap = await getExperimentMapForFeature(
    organization.id,
    current.id,
    readAccessFilter
  );

  const payload: FeatureUpdatedNotificationEvent = {
    object: "feature",
    event: "feature.updated",
    data: {
      current: getApiFeatureObj({
        feature: current,
        organization,
        groupMap,
        experimentMap,
      }),
      previous: getApiFeatureObj({
        feature: previous,
        organization,
        groupMap,
        experimentMap,
      }),
    },
    user,
  };

  const emittedEvent = await createEvent(organization.id, payload);
  if (emittedEvent) {
    new EventNotifier(emittedEvent.id).perform();
    return emittedEvent.id;
  }
}

/**
 * @param organization
 * @param user
 * @param feature
 * @returns event.id
 */
async function logFeatureCreatedEvent(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  readAccessFilter: ReadAccessFilter
): Promise<string | undefined> {
  const groupMap = await getSavedGroupMap(organization);
  const experimentMap = await getExperimentMapForFeature(
    organization.id,
    feature.id,
    readAccessFilter
  );

  const payload: FeatureCreatedNotificationEvent = {
    object: "feature",
    event: "feature.created",
    user,
    data: {
      current: getApiFeatureObj({
        feature,
        organization,
        groupMap,
        experimentMap,
      }),
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  if (emittedEvent) {
    new EventNotifier(emittedEvent.id).perform();
    return emittedEvent.id;
  }
}

/**
 * @param organization
 * @param user
 * @param previousFeature
 */
async function logFeatureDeletedEvent(
  organization: OrganizationInterface,
  user: EventAuditUser,
  previousFeature: FeatureInterface,
  readAccessFilter: ReadAccessFilter
): Promise<string | undefined> {
  const groupMap = await getSavedGroupMap(organization);
  const experimentMap = await getExperimentMapForFeature(
    organization.id,
    previousFeature.id,
    readAccessFilter
  );

  const payload: FeatureDeletedNotificationEvent = {
    object: "feature",
    event: "feature.deleted",
    user,
    data: {
      previous: getApiFeatureObj({
        feature: previousFeature,
        organization,
        groupMap,
        experimentMap,
      }),
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  if (emittedEvent) {
    new EventNotifier(emittedEvent.id).perform();
    return emittedEvent.id;
  }
}

async function onFeatureCreate(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  readAccessFilter: ReadAccessFilter
) {
  await refreshSDKPayloadCache(
    organization,
    getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(organization)
    ),
    null,
    readAccessFilter
  );

  await logFeatureCreatedEvent(organization, user, feature, readAccessFilter);
}

async function onFeatureDelete(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  readAccessFilter: ReadAccessFilter
) {
  await refreshSDKPayloadCache(
    organization,
    getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(organization)
    ),
    null,
    readAccessFilter
  );

  await logFeatureDeletedEvent(organization, user, feature, readAccessFilter);
}

export async function onFeatureUpdate(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  updatedFeature: FeatureInterface,
  readAccessFilter: ReadAccessFilter,
  skipRefreshForProject?: string
) {
  await refreshSDKPayloadCache(
    organization,
    getSDKPayloadKeysByDiff(
      feature,
      updatedFeature,
      getEnvironmentIdsFromOrg(organization)
    ),
    null,
    readAccessFilter,
    undefined,
    skipRefreshForProject
  );

  // New event-based webhooks
  await logFeatureUpdatedEvent(
    organization,
    user,
    feature,
    updatedFeature,
    readAccessFilter
  );
}

export async function updateFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  updates: Partial<FeatureInterface>,
  readAccessFilter: ReadAccessFilter
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
    getEnvironmentIdsFromOrg(org)
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

  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    {
      $set: allUpdates,
    }
  );

  if (experimentsAdded.size > 0) {
    await Promise.all(
      [...experimentsAdded].map(async (exp) => {
        await addLinkedFeatureToExperiment(
          org,
          user,
          exp,
          feature.id,
          readAccessFilter
        );
      })
    );
  }

  onFeatureUpdate(org, user, feature, updatedFeature, readAccessFilter);
  return updatedFeature;
}

export async function addLinkedExperiment(
  feature: FeatureInterface,
  experimentId: string
) {
  if (feature.linkedExperiments?.includes(experimentId)) return;

  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    {
      $addToSet: {
        linkedExperiments: experimentId,
      },
    }
  );
}

export async function getScheduledFeaturesToUpdate() {
  const features = await FeatureModel.find({
    nextScheduledUpdate: {
      $exists: true,
      $lt: new Date(),
    },
  });
  return features.map((m) => upgradeFeatureInterface(toInterface(m)));
}

export async function archiveFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  isArchived: boolean,
  readAccessFilter: ReadAccessFilter
) {
  return await updateFeature(
    org,
    user,
    feature,
    { archived: isArchived },
    readAccessFilter
  );
}

function setEnvironmentSettings(
  feature: FeatureInterface,
  environment: string,
  settings: Partial<FeatureEnvironment>
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
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  toggles: Record<string, boolean>,
  readAccessFilter: ReadAccessFilter
) {
  const validEnvs = new Set(getEnvironmentIdsFromOrg(organization));

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
    const updatedFeature = await updateFeature(
      organization,
      user,
      feature,
      {
        environmentSettings: featureCopy.environmentSettings,
      },
      readAccessFilter
    );
    return updatedFeature;
  }

  return featureCopy;
}

export async function toggleFeatureEnvironment(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  environment: string,
  state: boolean,
  readAccessFilter: ReadAccessFilter
) {
  return await toggleMultipleEnvironments(
    organization,
    user,
    feature,
    {
      [environment]: state,
    },
    readAccessFilter
  );
}

export async function addFeatureRule(
  revision: FeatureRevisionInterface,
  env: string,
  rule: FeatureRule,
  user: EventAuditUser
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }

  const changes = {
    rules: revision.rules || {},
  };
  changes.rules[env] = changes.rules[env] || [];
  changes.rules[env].push(rule);

  await updateRevision(revision, changes, {
    user,
    action: "add rule",
    subject: `to ${env}`,
    value: JSON.stringify(rule),
  });
}

export async function editFeatureRule(
  revision: FeatureRevisionInterface,
  environment: string,
  i: number,
  updates: Partial<FeatureRule>,
  user: EventAuditUser
) {
  const changes = { rules: revision.rules || {} };

  changes.rules[environment] = changes.rules[environment] || [];
  if (!changes.rules[environment][i]) {
    throw new Error("Unknown rule");
  }

  changes.rules[environment][i] = {
    ...changes.rules[environment][i],
    ...updates,
  } as FeatureRule;

  await updateRevision(revision, changes, {
    user,
    action: "edit rule",
    subject: `in ${environment} (position ${i + 1})`,
    value: JSON.stringify(updates),
  });
}

export async function removeTagInFeature(
  organization: OrganizationInterface,
  user: EventAuditUser,
  tag: string,
  readAccessFilter: ReadAccessFilter
) {
  const query = { organization: organization.id, tags: tag };

  const featureDocs = await FeatureModel.find(query);
  const features = (featureDocs || []).map(toInterface);

  await FeatureModel.updateMany(query, {
    $pull: { tags: tag },
  });

  features.forEach((feature) => {
    const updatedFeature = {
      ...feature,
      tags: (feature.tags || []).filter((t) => t !== tag),
    };

    onFeatureUpdate(
      organization,
      user,
      feature,
      updatedFeature,
      readAccessFilter
    );
  });
}

export async function removeProjectFromFeatures(
  project: string,
  organization: OrganizationInterface,
  user: EventAuditUser,
  readAccessFilter: ReadAccessFilter
) {
  const query = { organization: organization.id, project };

  const featureDocs = await FeatureModel.find(query);
  const features = (featureDocs || []).map(toInterface);

  await FeatureModel.updateMany(query, { $set: { project: "" } });

  features.forEach((feature) => {
    const updatedFeature = {
      ...feature,
      project: "",
    };

    onFeatureUpdate(
      organization,
      user,
      feature,
      updatedFeature,
      readAccessFilter,
      project
    );
  });
}

export async function setDefaultValue(
  revision: FeatureRevisionInterface,
  defaultValue: string,
  user: EventAuditUser
) {
  await updateRevision(
    revision,
    { defaultValue },
    {
      user,
      action: "edit default value",
      subject: ``,
      value: JSON.stringify({ defaultValue }),
    }
  );
}

export async function setJsonSchema(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  schema: string,
  readAccessFilter: ReadAccessFilter,
  enabled?: boolean
) {
  return await updateFeature(
    org,
    user,
    feature,
    {
      jsonSchema: { schema, enabled: enabled ?? true, date: new Date() },
    },
    readAccessFilter
  );
}

export async function applyRevisionChanges(
  organization: OrganizationInterface,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
  user: EventAuditUser,
  readAccessFilter: ReadAccessFilter
) {
  let hasChanges = false;
  const changes: Partial<FeatureInterface> = {};
  if (result.defaultValue !== undefined) {
    changes.defaultValue = result.defaultValue;
    hasChanges = true;
  }

  const environments = getEnvironmentIdsFromOrg(organization);

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
      environments
    );
  }

  changes.version = revision.version;

  // Update the `hasDrafts` field
  changes.hasDrafts = await hasDraft(organization.id, feature, [
    revision.version,
  ]);

  return await updateFeature(
    organization,
    user,
    feature,
    changes,
    readAccessFilter
  );
}

export async function publishRevision(
  organization: OrganizationInterface,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
  user: EventAuditUser,
  readAccessFilter: ReadAccessFilter,
  comment?: string
) {
  if (revision.status !== "draft") {
    throw new Error("Can only publish a draft revision");
  }

  // TODO: wrap these 2 calls in a transaction
  const updatedFeature = await applyRevisionChanges(
    organization,
    feature,
    revision,
    result,
    user,
    readAccessFilter
  );

  await markRevisionAsPublished(revision, user, comment);

  return updatedFeature;
}

function getLinkedExperiments(
  feature: FeatureInterface,
  environments: string[]
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

export async function toggleNeverStale(
  organization: OrganizationInterface,
  feature: FeatureInterface,
  user: EventAuditUser,
  neverStale: boolean,
  readAccessFilter: ReadAccessFilter
) {
  return await updateFeature(
    organization,
    user,
    feature,
    { neverStale },
    readAccessFilter
  );
}
