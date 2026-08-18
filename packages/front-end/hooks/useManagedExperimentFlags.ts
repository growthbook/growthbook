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
 * Whether this experiment is in managed mode, and which linked feature is the
 * managed one.
 *
 * Two questions with two different answers, deliberately:
 *   - `managedFeature` is the *fact* — read off `feature.managedBy`, the single
 *     source of truth, so nothing can drift.
 *   - `defaultsToManaged` is the *default* for an experiment that has no
 *     implementation yet, resolved Project-then-org.
 *
 * Once a managed flag exists it wins outright: an org that later turns the
 * setting off must not silently unlock flags that are already managed.
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
