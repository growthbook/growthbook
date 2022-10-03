import { ApiV1Feature } from "../../../types/api/v1/feature";
import { FeatureInterface } from "../../../types/feature";

export function formatApiFeature(feature: FeatureInterface): ApiV1Feature {
  const retFeature = { ...feature } as Partial<FeatureInterface>;

  delete retFeature.organization;
  delete retFeature.draft;
  delete retFeature.revision;

  return retFeature as ApiV1Feature;
}
