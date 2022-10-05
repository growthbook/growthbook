import { ApiV1Feature } from "../../../types/api/v1/feature";
import {
  FeatureDraftChanges,
  FeatureEnvironment,
  FeatureInterface,
  FeatureRevisionInterface,
} from "../../../types/feature";
import { getFeatureDefinitions } from "../features";
import cloneDeep from "lodash/cloneDeep";

function transformDraftToEnvironments(
  feature: FeatureInterface
): Record<string, FeatureEnvironment> {
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

export async function formatApiFeature(
  feature: FeatureInterface
): Promise<ApiV1Feature> {
  const retFeature: Partial<
    ApiV1Feature & {
      organization: string;
      environmentSettings?: Record<string, FeatureEnvironment>;
      draft?: FeatureDraftChanges;
      revision?: FeatureRevisionInterface;
    }
  > = {
    environments: feature.environmentSettings ?? {},
    draftEnvironments: transformDraftToEnvironments(feature),
    definition: (await getFeatureDefinitions(feature.organization)).features[
      feature.id
    ],
    ...feature,
  };

  delete retFeature.organization;
  delete retFeature.environmentSettings;
  delete retFeature.draft;
  delete retFeature.revision;

  return retFeature as ApiV1Feature;
}
