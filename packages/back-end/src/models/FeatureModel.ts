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
    },
  ],
  environmentSettings: {},
});

featureSchema.index({ id: 1, organization: 1 }, { unique: true });

type FeatureDocument = mongoose.Document & LegacyFeatureInterface;

const FeatureModel = mongoose.model<FeatureDocument>("Feature", featureSchema);

function upgradeFeatureInterface(
  feature: LegacyFeatureInterface
): FeatureInterface {
  const { environments, rules, ...newFeature } = feature;

  newFeature.environmentSettings = newFeature.environmentSettings || {};
  newFeature.environmentSettings.dev = newFeature.environmentSettings.dev || {
    enabled: environments?.includes("dev") || false,
    rules: rules || [],
  };
  newFeature.environmentSettings.production = newFeature.environmentSettings
    .production || {
    enabled: environments?.includes("production") || false,
    rules: rules || [],
  };

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

export async function addFeatureRule(
  feature: FeatureInterface,
  environment: string,
  rule: Partial<FeatureRule>
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }

  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: {
        dateUpdated: new Date(),
      },
      $push: {
        [`environmentSettings.${environment}.rules`]: rule,
      },
    }
  );

  featureUpdated(feature);
}

export async function editFeatureRule(
  feature: FeatureInterface,
  environment: string,
  i: number,
  updates: Partial<FeatureRule>
) {
  const rules = feature.environmentSettings?.[environment]?.rules ?? [];

  if (!rules[i]) {
    throw new Error("Unknown rule");
  }

  // eslint-disable-next-line
  const sets: Record<string, any> = {dateUpdated: new Date()};

  Object.keys(updates).forEach((key: keyof FeatureRule) => {
    sets[`environmentSettings.${environment}.rules.${i}.${key}`] = updates[key];
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
