import mongoose, { FilterQuery } from "mongoose";
import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import { isEqual } from "lodash";
import {
  ExperimentRefRule,
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../../types/feature";
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
import { createFeatureRevision } from "./FeatureRevisionModel";
import { createEvent } from "./EventModel";
import {
  addLinkedFeatureToExperiment,
  getExperimentMapForFeature,
  removeLinkedFeatureFromExperiment,
} from "./ExperimentModel";

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

  /**
   * @deprecated
   */
  draft: {},

  revision: {},
  linkedExperiments: [String],
  jsonSchema: {},
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
  project?: string
): Promise<FeatureInterface[]> {
  const q: FilterQuery<FeatureDocument> = { organization };
  if (project) {
    q.project = project;
  }

  return (await FeatureModel.find(q)).map((m) =>
    upgradeFeatureInterface(toInterface(m))
  );
}

export async function getFeature(
  organization: string,
  id: string
): Promise<FeatureInterface | null> {
  const feature = await FeatureModel.findOne({ organization, id });
  return feature ? upgradeFeatureInterface(toInterface(feature)) : null;
}

export async function getFeaturesByIds(
  organization: string,
  ids: string[]
): Promise<FeatureInterface[]> {
  return (
    await FeatureModel.find({ organization, id: { $in: ids } })
  ).map((m) => upgradeFeatureInterface(toInterface(m)));
}

export async function createFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  data: FeatureInterface
) {
  const linkedExperiments = getLinkedExperiments(data);
  const feature = await FeatureModel.create({
    ...data,
    linkedExperiments,
  });
  await createFeatureRevision({
    feature: toInterface(feature),
    state: "published",
    creatorUserId: user && user.type === "dashboard" ? user.id : null,
  });

  if (linkedExperiments.length > 0) {
    await Promise.all(
      linkedExperiments.map(async (exp) => {
        await addLinkedFeatureToExperiment(org, user, exp, data.id);
      })
    );
  }

  onFeatureCreate(org, user, feature);
}

export async function deleteFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface
) {
  await FeatureModel.deleteOne({ organization: org.id, id: feature.id });

  if (feature.linkedExperiments) {
    await Promise.all(
      feature.linkedExperiments.map(async (exp) => {
        await removeLinkedFeatureFromExperiment(org, user, exp, feature.id);
      })
    );
  }

  onFeatureDelete(org, user, feature);
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
}: {
  projectId: string;
  organization: OrganizationInterface;
  user: EventAuditUser;
}) {
  const featuresToDelete = await FeatureModel.find({
    organization: organization.id,
    project: projectId,
  });

  for (const feature of featuresToDelete) {
    await deleteFeature(organization, user, feature);
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
  current: FeatureInterface
): Promise<string | undefined> {
  const groupMap = await getSavedGroupMap(organization);
  const experimentMap = await getExperimentMapForFeature(
    organization.id,
    current.id
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
  feature: FeatureInterface
): Promise<string | undefined> {
  const groupMap = await getSavedGroupMap(organization);
  const experimentMap = await getExperimentMapForFeature(
    organization.id,
    feature.id
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
  previousFeature: FeatureInterface
): Promise<string | undefined> {
  const groupMap = await getSavedGroupMap(organization);
  const experimentMap = await getExperimentMapForFeature(
    organization.id,
    previousFeature.id
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
  feature: FeatureInterface
) {
  await refreshSDKPayloadCache(
    organization,
    getAffectedSDKPayloadKeys([feature])
  );

  await logFeatureCreatedEvent(organization, user, feature);
}

async function onFeatureDelete(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface
) {
  await refreshSDKPayloadCache(
    organization,
    getAffectedSDKPayloadKeys([feature])
  );

  await logFeatureDeletedEvent(organization, user, feature);
}

export async function onFeatureUpdate(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  updatedFeature: FeatureInterface,
  skipRefreshForProject?: string
) {
  await refreshSDKPayloadCache(
    organization,
    getSDKPayloadKeysByDiff(feature, updatedFeature),
    null,
    skipRefreshForProject
  );

  // New event-based webhooks
  await logFeatureUpdatedEvent(organization, user, feature, updatedFeature);
}

export async function updateFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  updates: Partial<FeatureInterface>
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
  const linkedExperiments = getLinkedExperiments(updatedFeature);
  const experimentsAdded = new Set<string>();
  const experimentsRemoved = new Set<string>();
  if (!isEqual(linkedExperiments, feature.linkedExperiments)) {
    allUpdates.linkedExperiments = linkedExperiments;
    updatedFeature.linkedExperiments = linkedExperiments;

    // New experiments this feature was added to
    linkedExperiments.forEach((exp) => {
      if (!feature.linkedExperiments?.includes(exp)) {
        experimentsAdded.add(exp);
      }
    });
    // Experiments this feature was removed from
    feature.linkedExperiments?.forEach((exp) => {
      if (!linkedExperiments.includes(exp)) {
        experimentsRemoved.add(exp);
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
        await addLinkedFeatureToExperiment(org, user, exp, feature.id);
      })
    );
  }
  if (experimentsRemoved.size > 0) {
    await Promise.all(
      [...experimentsRemoved].map(async (exp) => {
        await removeLinkedFeatureFromExperiment(org, user, exp, feature.id);
      })
    );
  }

  onFeatureUpdate(org, user, feature, updatedFeature);
  return updatedFeature;
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
  isArchived: boolean
) {
  return await updateFeature(org, user, feature, { archived: isArchived });
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
  toggles: Record<string, boolean>
) {
  let featureCopy = cloneDeep(feature);
  let hasChanges = false;
  Object.keys(toggles).forEach((env) => {
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
    const updatedFeature = await updateFeature(organization, user, feature, {
      environmentSettings: featureCopy.environmentSettings,
    });
    return updatedFeature;
  }

  return featureCopy;
}

export async function toggleFeatureEnvironment(
  organization: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  environment: string,
  state: boolean
) {
  return await toggleMultipleEnvironments(organization, user, feature, {
    [environment]: state,
  });
}

export function getDraftRules(feature: FeatureInterface, environment: string) {
  // todo: update these draft references based on the new drafts
  return (
    feature?.draft?.rules?.[environment] ??
    feature?.environmentSettings?.[environment]?.rules ??
    []
  );
}

export async function addFeatureRule(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  environment: string,
  rule: FeatureRule
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }

  await setFeatureDraftRules(org, user, feature, environment, [
    ...getDraftRules(feature, environment),
    rule,
  ]);
}

export async function deleteExperimentRefRule(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  experimentId: string
) {
  const environments = org.settings?.environments || [];
  const environmentIds = environments.map((e) => e.id);

  if (!environmentIds.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags"
    );
  }

  const draft = getLegacyDraft(feature);

  let hasChanges = false;
  environmentIds.forEach((env) => {
    const rules = getDraftRules(feature, env);

    draft.rules = draft.rules || {};

    const numRules = rules.length;
    draft.rules[env] = rules.filter(
      (r) => !(r.type === "experiment-ref" && r.experimentId === experimentId)
    );
    if (draft.rules[env].length < numRules) hasChanges = true;
  });

  if (hasChanges) {
    await updateLegacyDraft(org, user, feature, draft);
  }
}

export async function addExperimentRefRule(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  rule: ExperimentRefRule
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }

  const environments = org.settings?.environments || [];
  const environmentIds = environments.map((e) => e.id);

  if (!environmentIds.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags"
    );
  }

  const draft = getLegacyDraft(feature);

  environmentIds.forEach((env) => {
    draft.rules = draft.rules || {};
    draft.rules[env] = [...getDraftRules(feature, env), rule];
  });

  await updateLegacyDraft(org, user, feature, draft);
}

export async function editFeatureRule(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  environment: string,
  i: number,
  updates: Partial<FeatureRule>
) {
  const rules = getDraftRules(feature, environment);
  if (!rules[i]) {
    throw new Error("Unknown rule");
  }

  rules[i] = {
    ...rules[i],
    ...updates,
  } as FeatureRule;

  await setFeatureDraftRules(org, user, feature, environment, rules);
}

export async function setFeatureDraftRules(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  environment: string,
  rules: FeatureRule[]
) {
  const draft = getLegacyDraft(feature);
  draft.rules = draft.rules || {};
  draft.rules[environment] = rules;

  await updateLegacyDraft(org, user, feature, draft);
}

export async function removeTagInFeature(
  organization: OrganizationInterface,
  user: EventAuditUser,
  tag: string
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

    onFeatureUpdate(organization, user, feature, updatedFeature);
  });
}

export async function removeProjectFromFeatures(
  project: string,
  organization: OrganizationInterface,
  user: EventAuditUser
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

    onFeatureUpdate(organization, user, feature, updatedFeature, project);
  });
}

export async function setDefaultValue(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  defaultValue: string
) {
  const draft = getLegacyDraft(feature);
  draft.defaultValue = defaultValue;

  return updateLegacyDraft(org, user, feature, draft);
}

export async function setJsonSchema(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  schema: string,
  enabled?: boolean
) {
  return await updateFeature(org, user, feature, {
    jsonSchema: { schema, enabled: enabled ?? true, date: new Date() },
  });
}

/**
 * @deprecated
 */
export async function updateLegacyDraft(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  draft: FeatureDraftChanges
) {
  return await updateFeature(org, user, feature, { draft });
}

function getLegacyDraft(feature: FeatureInterface) {
  const draft: FeatureDraftChanges = cloneDeep(
    feature.draft || { active: false }
  );

  if (!draft.active) {
    draft.active = true;
    draft.dateCreated = new Date();
  }
  draft.dateUpdated = new Date();

  return draft;
}

/**
 * @deprecated
 */
export async function discardLegacyDraft(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface
) {
  if (!feature.draft?.active) {
    throw new Error("There are no draft changes to discard.");
  }

  await updateFeature(org, user, feature, {
    draft: {
      active: false,
    },
  });
}

/**
 * @deprecated
 * Working with the legacy draft property on the {@link FeatureInterface}
 * @param organization
 * @param feature
 * @param user
 * @param comment
 */
export async function publishLegacyDraft(
  organization: OrganizationInterface,
  feature: FeatureInterface,
  user: {
    id: string;
    email: string;
    name: string;
  },
  comment?: string
) {
  if (!feature.draft?.active) {
    throw new Error("There are no draft changes to publish.");
  }

  // Features created before revisions were introduced are missing their initial revision
  // Create it now before publishing the draft and making a 2nd revision
  if (!feature.revision) {
    await createFeatureRevision({
      feature,
      state: "published",
      creatorUserId: user.id,
    });
  }

  const changes: Partial<FeatureInterface> = {};
  if (
    "defaultValue" in feature.draft &&
    feature.draft.defaultValue !== feature.defaultValue
  ) {
    changes.defaultValue = feature.draft.defaultValue;
  }
  if (feature.draft.rules) {
    changes.environmentSettings = cloneDeep(feature.environmentSettings || {});
    const envSettings = changes.environmentSettings;
    Object.keys(feature.draft.rules).forEach((key) => {
      envSettings[key] = {
        enabled: envSettings[key]?.enabled || false,
        rules: feature?.draft?.rules?.[key] || [],
      };
    });
    changes.nextScheduledUpdate = getNextScheduledUpdate(envSettings);
  }

  changes.draft = { active: false };
  changes.revision = {
    version: (feature.revision?.version || 1) + 1,
    comment: comment || "",
    date: new Date(),
    publishedBy: user,
  };
  const updatedFeature = await updateFeature(
    organization,
    { ...user, type: "dashboard" },
    feature,
    changes
  );

  await createFeatureRevision({
    feature: updatedFeature,
    state: "published",
    creatorUserId: user.id,
  });
  return updatedFeature;
}

function getLinkedExperiments(feature: FeatureInterface) {
  const expIds: Set<string> = new Set();
  // Published rules
  if (feature.environmentSettings) {
    Object.values(feature.environmentSettings).forEach((env) => {
      env.rules?.forEach((rule) => {
        if (rule.type === "experiment-ref") {
          expIds.add(rule.experimentId);
        }
      });
    });
  }

  // Draft rules
  // todo: update these draft references based on the new drafts
  const draft = feature.draft;
  if (draft && draft.active && draft.rules) {
    Object.values(draft.rules).forEach((rules) => {
      rules.forEach((rule) => {
        if (rule.type === "experiment-ref") {
          expIds.add(rule.experimentId);
        }
      });
    });
  }

  return [...expIds];
}
