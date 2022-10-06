import { FilterQuery } from "mongodb";
import mongoose from "mongoose";
import {
  CreateFeatureInterface,
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
  UpdateFeatureInterface,
} from "back-end/types/feature";
import {
  featureUpdated,
  generateRuleId,
  addIdsToRules,
  parseDefaultValue,
} from "../services/features";
import cloneDeep from "lodash/cloneDeep";
import { upgradeFeatureInterface } from "../util/migrations";
import { saveRevision } from "./FeatureRevisionModel";
import {
  vCreateFeatureInterface,
  vFeatureInterface,
  vUpdateFeatureInterface,
} from "../validators/feature";

const featureSchema = new mongoose.Schema({
  id: String,
  archived: Boolean,
  description: String,
  organization: String,
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
    },
  ],
  environmentSettings: {},
  draft: {},
  revision: {},
});

featureSchema.index({ id: 1, organization: 1 }, { unique: true });

type FeatureDocument = mongoose.Document & LegacyFeatureInterface;

const FeatureModel = mongoose.model<FeatureDocument>("Feature", featureSchema);

export async function getAllFeatures(
  organization: string,
  project?: string
): Promise<FeatureInterface[]> {
  const q: FilterQuery<FeatureDocument> = { organization };
  if (project) {
    q.project = project;
  }

  return (await FeatureModel.find(q)).map((m) =>
    upgradeFeatureInterface(m.toJSON())
  );
}

export async function getFeature(
  organization: string,
  id: string
): Promise<FeatureInterface | null> {
  const feature = await FeatureModel.findOne({ organization, id });
  return feature ? upgradeFeatureInterface(feature.toJSON()) : null;
}

export async function createFeature(
  data: CreateFeatureInterface,
  orgId: string
) {
  vCreateFeatureInterface.parse(data);
  const resultFeature: FeatureInterface = {
    id: data.id.toLowerCase(),
    archived: data.archived ?? false,
    description: data.description,
    organization: orgId,
    owner: data.owner ?? "None",
    project: data.project,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    valueType: data.valueType,
    defaultValue: parseDefaultValue(data.defaultValue, data.valueType),
    tags: data.tags,
    environmentSettings: data.environmentSettings,
    draft: data.draft,
    revision: data.revision,
  };
  vFeatureInterface.parse(resultFeature);

  addIdsToRules(resultFeature.environmentSettings, resultFeature.id);

  const feature = await FeatureModel.create(resultFeature);
  await saveRevision(feature.toJSON());

  featureUpdated(resultFeature);
  return feature;
}

export async function deleteFeature(organization: string, id: string) {
  const deleteRes = await FeatureModel.deleteOne({ organization, id });
  if (!deleteRes.deletedCount) throw new Error("Unable to delete feature");
}

export async function updateFeature(
  organization: string,
  id: string,
  updates: UpdateFeatureInterface
) {
  vUpdateFeatureInterface.parse(updates);
  await FeatureModel.updateOne(
    { organization, id },
    {
      $set: { ...updates, updatedAt: new Date() },
    }
  );
}

export async function archiveFeature(
  organization: string,
  id: string,
  isArchived: boolean
) {
  await updateFeature(organization, id, { archived: isArchived });
}

function setEnvironmentSettings(
  feature: FeatureInterface,
  environment: string,
  settings: Partial<FeatureEnvironment>
) {
  const newFeature = cloneDeep(feature);

  newFeature.environmentSettings = newFeature.environmentSettings || {};
  newFeature.environmentSettings[environment] = newFeature.environmentSettings[
    environment
  ] || { enabled: false, rules: [] };

  newFeature.environmentSettings[environment] = {
    ...newFeature.environmentSettings[environment],
    ...settings,
  };

  return newFeature;
}

export async function toggleFeatureEnvironment(
  feature: FeatureInterface,
  environment: string,
  state: boolean
) {
  const currentState =
    feature.environmentSettings?.[environment]?.enabled ?? false;

  if (currentState === state) return;

  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
        [`environmentSettings.${environment}.enabled`]: state,
      },
    }
  );

  featureUpdated(
    setEnvironmentSettings(feature, environment, { enabled: state }),
    currentState ? [environment] : []
  );
}

export function getDraftRules(feature: FeatureInterface, environment: string) {
  return (
    feature?.draft?.rules?.[environment] ??
    feature?.environmentSettings?.[environment]?.rules ??
    []
  );
}

export async function addFeatureRule(
  feature: FeatureInterface,
  environment: string,
  rule: FeatureRule
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }

  await setFeatureDraftRules(feature, environment, [
    ...getDraftRules(feature, environment),
    rule,
  ]);
}

export async function editFeatureRule(
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

  await setFeatureDraftRules(feature, environment, rules);
}

export async function setFeatureDraftRules(
  feature: FeatureInterface,
  environment: string,
  rules: FeatureRule[]
) {
  const draft = getDraft(feature);
  draft.rules = draft.rules || {};
  draft.rules[environment] = rules;

  await updateDraft(feature, draft);
}

export async function removeTagInFeature(organization: string, tag: string) {
  const query = { organization, tags: tag };
  await FeatureModel.updateMany(query, {
    $pull: { tags: tag },
  });
  return;
}

export async function setDefaultValue(
  feature: FeatureInterface,
  defaultValue: string
) {
  const draft = getDraft(feature);
  draft.defaultValue = defaultValue;

  return updateDraft(feature, draft);
}

export async function updateDraft(
  feature: FeatureInterface,
  draft: FeatureDraftChanges
) {
  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: {
        draft,
        dateUpdated: new Date(),
      },
    }
  );

  return {
    ...feature,
    draft: {
      ...draft,
    },
  };
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

export async function discardDraft(feature: FeatureInterface) {
  if (!feature.draft?.active) {
    throw new Error("There are no draft changes to discard.");
  }

  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: {
        draft: {
          active: false,
        },
      },
    }
  );
}

export async function publishDraft(
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
  }

  changes.dateUpdated = new Date();
  changes.draft = { active: false };
  changes.revision = {
    version: (feature.revision?.version || 1) + 1,
    comment: comment || "",
    date: new Date(),
    publishedBy: user,
  };

  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: changes,
    }
  );

  const newFeature = {
    ...feature,
    ...changes,
  };

  featureUpdated(newFeature);
  await saveRevision(newFeature);
  return newFeature;
}
