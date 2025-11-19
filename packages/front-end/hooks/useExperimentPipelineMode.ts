import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function useExperimentPipelineMode(
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
