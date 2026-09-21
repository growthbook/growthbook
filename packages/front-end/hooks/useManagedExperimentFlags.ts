import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { isManagedByExperiment } from "shared/util";

/**
 * Managed mode is a fact, not a preference: it is read off `feature.managedBy`
 * for the experiment's own linked flag.
 */
export function useManagedExperimentFlags({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
}): {
  isManaged: boolean;
  managedFeature: LinkedFeatureInfo | null;
} {
  const managedFeature =
    linkedFeatures.find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;

  return {
    isManaged: !!managedFeature,
    managedFeature,
  };
}
