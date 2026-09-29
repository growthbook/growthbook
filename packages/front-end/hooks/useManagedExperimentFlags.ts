import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { isManagedByExperiment } from "shared/util";

/** Read off `feature.managedBy` of the experiment's own linked flag. */
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
