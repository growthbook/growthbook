import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";

// This hook returns list of projects user has permission for along with any projects already associated with a resource (e.g. metric.projects)
export default function useExperimentalRefreshMode(
  experiment?: ExperimentInterfaceStringDates,
): "incremental-refresh" | "standard" {
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment?.datasource ?? "");
  const isIncrementalRefresh = getIsExperimentIncludedInIncrementalRefresh(
    datasource ?? undefined,
    experiment?.id,
  );
  if (isIncrementalRefresh) {
    return "incremental-refresh";
  }
  return "standard";
}
