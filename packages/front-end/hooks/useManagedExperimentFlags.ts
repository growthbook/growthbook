import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  isManagedByExperiment,
  managedExperimentFlagsDefault,
} from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";

/**
 * `managedFeature` is the fact, read off `feature.managedBy`.
 * `defaultsToManaged` is the default for an experiment with no implementation
 * yet. An existing managed flag wins: turning the setting off must not unlock
 * flags that are already managed.
 */
export function useManagedExperimentFlags({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
}): {
  isManaged: boolean;
  defaultsToManaged: boolean;
  managedFeature: LinkedFeatureInfo | null;
} {
  const settings = useOrgSettings();
  const { projects } = useDefinitions();

  const managedFeature =
    linkedFeatures.find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;

  const project = experiment.project
    ? (projects.find((p) => p.id === experiment.project) ?? null)
    : null;

  const defaultsToManaged = managedExperimentFlagsDefault({
    settings,
    project,
  });

  return {
    isManaged: !!managedFeature,
    defaultsToManaged,
    managedFeature,
  };
}
