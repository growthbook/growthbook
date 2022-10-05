import { ApiV1Feature } from "../../../types/api/v1/feature";
import { FeatureEnvironment, FeatureInterface } from "../../../types/feature";
import cloneDeep from "lodash/cloneDeep";
import { FeatureDefinition } from "../../../types/api";

function transformDraftToEnvironments(
  feature: FeatureInterface
): Record<string, FeatureEnvironment> {
  if (!feature.draft?.active) return {};

  let envSettings: Record<string, FeatureEnvironment> = {};
  const changes: Partial<FeatureInterface> = {};
  if (feature.draft?.rules) {
    changes.environmentSettings = cloneDeep(feature.environmentSettings || {});
    envSettings = changes.environmentSettings;
    Object.keys(feature.draft.rules).forEach((key) => {
      envSettings[key] = {
        enabled: envSettings[key]?.enabled || false,
        rules: feature?.draft?.rules?.[key] || [],
      };
    });
  }

  return envSettings;
}

export function formatApiFeature(
  feature: FeatureInterface,
  featureDefinitions: Record<string, FeatureDefinition>
): ApiV1Feature {
  const retFeature: ApiV1Feature = {
    id: feature.id,
    archived: feature.archived,
    description: feature.description,
    owner: feature.owner,
    project: feature.project,
    dateCreated: feature.dateCreated,
    dateUpdated: feature.dateUpdated,
    valueType: feature.valueType,
    defaultValue: feature.defaultValue,
    tags: feature.tags,
    environments: feature.environmentSettings || {},
    draftEnvironments: transformDraftToEnvironments(feature),
    definition: featureDefinitions[feature.id] || {},
  };

  return retFeature as ApiV1Feature;
}
