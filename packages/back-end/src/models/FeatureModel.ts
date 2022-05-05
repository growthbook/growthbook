import { FilterQuery } from "mongodb";
import mongoose from "mongoose";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRule,
  LegacyFeatureInterface,
} from "../../types/feature";
import { featureUpdated, generateRuleId } from "../services/features";
import cloneDeep from "lodash/cloneDeep";
import { upgradeFeatureInterface } from "../util/migrations";

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
  revision: Number,
  revisionComment: String,
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

  await FeatureModel.updateOne(
    {
      id: feature.id,
      organization: feature.organization,
    },
    {
      $set: {
        draft,
      },
    }
  );
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

async function updateDraft(
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
  comment?: string
) {
  if (!feature.draft?.active) {
    throw new Error("There are no draft changes to publish.");
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
  changes.revisionComment = comment || "";
  changes.revision = (feature.revision || 1) + 1;

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
  return newFeature;
}
