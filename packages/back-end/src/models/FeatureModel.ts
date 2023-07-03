import mongoose, { FilterQuery } from "mongoose";
import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import {
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
import { saveRevision } from "./FeatureRevisionModel";
import { createEvent } from "./EventModel";

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
      values: [
        {
          _id: false,
          value: String,
          weight: Number,
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
  revision: {},
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

export async function createFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  data: FeatureInterface
) {
  const feature = await FeatureModel.create(data);
  await saveRevision(toInterface(feature));
  onFeatureCreate(org, user, feature);
}

export async function deleteFeature(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface
) {
  await FeatureModel.deleteOne({ organization: org.id, id: feature.id });
  onFeatureDelete(org, user, feature);
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
  const savedGroupMap = await getSavedGroupMap(organization);

  const payload: FeatureUpdatedNotificationEvent = {
    object: "feature",
    event: "feature.updated",
    data: {
      current: getApiFeatureObj(current, organization, savedGroupMap),
      previous: getApiFeatureObj(previous, organization, savedGroupMap),
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
  const savedGroupMap = await getSavedGroupMap(organization);

  const payload: FeatureCreatedNotificationEvent = {
    object: "feature",
    event: "feature.created",
    user,
    data: {
      current: getApiFeatureObj(feature, organization, savedGroupMap),
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
  const savedGroupMap = await getSavedGroupMap(organization);

  const payload: FeatureDeletedNotificationEvent = {
    object: "feature",
    event: "feature.deleted",
    user,
    data: {
      previous: getApiFeatureObj(previousFeature, organization, savedGroupMap),
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
  const dateUpdated = new Date();

  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    {
      $set: {
        ...updates,
        dateUpdated,
      },
    }
  );

  const updatedFeature = {
    ...feature,
    ...updates,
    dateUpdated,
  };

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
  const draft = getDraft(feature);
  draft.rules = draft.rules || {};
  draft.rules[environment] = rules;

  await updateDraft(org, user, feature, draft);
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
  const draft = getDraft(feature);
  draft.defaultValue = defaultValue;

  return updateDraft(org, user, feature, draft);
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

export async function updateDraft(
  org: OrganizationInterface,
  user: EventAuditUser,
  feature: FeatureInterface,
  draft: FeatureDraftChanges
) {
  return await updateFeature(org, user, feature, { draft });
}

function getDraft(feature: FeatureInterface) {
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

export async function discardDraft(
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

export async function publishDraft(
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
    await saveRevision(feature);
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

  await saveRevision(updatedFeature);
  return updatedFeature;
}
