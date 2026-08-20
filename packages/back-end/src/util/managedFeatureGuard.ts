import { isManagedFeature, managedByExperimentId } from "shared/util";
import { FeatureInterface } from "shared/validators";
import { ManagedFeatureError } from "back-end/src/util/errors";

/**
 * Refuses a flag an experiment owns. Lives here rather than in
 * `services/managedFeatures` so services can guard themselves without pulling
 * in that module's request-layer dependencies.
 */
export function assertLoadedFeatureNotManaged(feature: FeatureInterface): void {
  if (!isManagedFeature(feature)) return;
  throw new ManagedFeatureError({
    featureId: feature.id,
    experimentId: managedByExperimentId(feature) ?? "",
  });
}
