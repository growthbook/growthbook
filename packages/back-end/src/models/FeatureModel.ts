import { FilterQuery } from "mongodb";
import mongoose from "mongoose";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../../types/feature";
import { featureUpdated, generateRuleId } from "../services/features";
import cloneDeep from "lodash/cloneDeep";

const featureSchema = new mongoose.Schema({
  id: String,
  description: String,
  organization: String,
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
});

featureSchema.index({ id: 1, organization: 1 }, { unique: true });

type FeatureDocument = mongoose.Document & LegacyFeatureInterface;

const FeatureModel = mongoose.model<FeatureDocument>("Feature", featureSchema);

function updateEnvironmentSettings(
  rules: FeatureRule[],
  environments: string[],
  environment: string,
  feature: FeatureInterface
) {
  feature.environmentSettings = feature.environmentSettings || {};
  feature.environmentSettings[environment] =
    feature.environmentSettings[environment] || {};

  const settings = feature.environmentSettings[environment];

  if (!("rules" in settings)) {
    feature.environmentSettings[environment].rules = rules;
  }
  if (!("enabled" in settings)) {
    feature.environmentSettings[environment].enabled =
      environments?.includes(environment) || false;
  }

  // If Rules is an object instead of array, fix it
  if (!Array.isArray(settings.rules)) {
    settings.rules = Object.values(settings.rules);
  }
}

function upgradeFeatureInterface(
  feature: LegacyFeatureInterface
): FeatureInterface {
  const { environments, rules, ...newFeature } = feature;

  updateEnvironmentSettings(rules || [], environments || [], "dev", newFeature);
  updateEnvironmentSettings(
    rules || [],
    environments || [],
    "production",
    newFeature
  );

  return newFeature;
}

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

export async function createFeature(data: FeatureInterface) {
  await FeatureModel.create(data);
}

export async function deleteFeature(organization: string, id: string) {
  await FeatureModel.deleteOne({ organization, id });
}

export async function updateFeature(
  organization: string,
  id: string,
  updates: Partial<FeatureInterface>
) {
  await FeatureModel.updateOne(
    { organization, id },
    {
      $set: updates,
    }
  );
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

function getRules(feature: FeatureInterface, environment: string) {
  return feature?.environmentSettings?.[environment]?.rules ?? [];
}

export async function addFeatureRule(
  feature: FeatureInterface,
  environment: string,
  rule: FeatureRule
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }

  await editFeatureEnvironment(feature, environment, {
    rules: [...getRules(feature, environment), rule],
  });
}

export async function editFeatureRule(
  feature: FeatureInterface,
  environment: string,
  i: number,
  updates: Partial<FeatureRule>
) {
  const rules = getRules(feature, environment);
  if (!rules[i]) {
    throw new Error("Unknown rule");
  }

  rules[i] = {
    ...rules[i],
    ...updates,
  } as FeatureRule;

  await editFeatureEnvironment(feature, environment, {
    rules,
  });
}

export async function editFeatureEnvironment(
  feature: FeatureInterface,
  environment: string,
  updates: Partial<FeatureEnvironment>
) {
  // eslint-disable-next-line
  const sets: Record<string, any> = {dateUpdated: new Date()};
  Object.keys(updates).forEach((key: keyof FeatureEnvironment) => {
    sets[`environmentSettings.${environment}.${key}`] = updates[key];
  });

  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: sets,
    }
  );

  featureUpdated(feature);
}

export async function removeTagInFeature(organization: string, tag: string) {
  const query = { organization, tags: tag };
  await FeatureModel.updateMany(query, {
    $pull: { tags: tag },
  });
  return;
}

export async function publishDraft(feature: FeatureInterface) {
  if (!feature.draft?.active) {
    throw new Error("There are no draft changes to publish.");
  }

  const changes: Partial<FeatureInterface> = {};
  if (feature.draft.defaultValue !== feature.defaultValue) {
    changes.defaultValue = feature.draft.defaultValue;
  }
  if (feature.draft.valueType !== feature.valueType) {
    changes.valueType = feature.draft.valueType;
  }

  if (feature.draft.rules) {
    Object.keys(feature.draft.rules).forEach((key) => {
      changes.environmentSettings = feature.environmentSettings || {};
      changes.environmentSettings[key] = {
        enabled: changes.environmentSettings?.[key]?.enabled || false,
        rules: feature?.draft?.rules?.[key] || [],
      };
    });
  }

  changes.dateUpdated = new Date();
  changes.draft = { active: false };

  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: changes,
    }
  );

  featureUpdated({
    ...feature,
    ...changes,
  });
}
