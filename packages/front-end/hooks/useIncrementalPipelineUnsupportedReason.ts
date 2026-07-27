import { useMemo } from "react";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { getIncrementalPipelineUnsupportedReason } from "shared/enterprise";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";

export function useIncrementalPipelineUnsupportedReason(
  experiment: ExperimentInterfaceStringDates | undefined,
): string | undefined {
  const { ready, getDatasourceById, getExperimentMetricById, metricGroups } =
    useDefinitions();
  const { hasCommercialFeature } = useUser();

  return useMemo(() => {
    if (!ready || !experiment) return undefined;

    const datasource = getDatasourceById(experiment.datasource);
    if (!datasource) return undefined;

    if (
      !getIsExperimentIncludedInIncrementalRefresh(
        datasource,
        experiment.id,
        experiment.type,
      )
    ) {
      return undefined;
    }

    const metrics = getAllMetricIdsFromExperiment(
      experiment,
      false,
      metricGroups,
    )
      .map((id) => getExperimentMetricById(id))
      .filter((m): m is NonNullable<typeof m> => m !== null);

    return (
      getIncrementalPipelineUnsupportedReason({
        datasourceProperties: datasource.properties,
        pipelineSettings: datasource.settings?.pipelineSettings,
        experimentId: experiment.id,
        orgHasIncrementalPipelineFeature: hasCommercialFeature(
          "incremental-refresh",
        ),
        skipPartialData: !!experiment.skipPartialData,
        activationMetric: experiment.activationMetric,
        metrics,
        experimentType: experiment.type,
      }) ?? undefined
    );
  }, [
    ready,
    experiment,
    getDatasourceById,
    getExperimentMetricById,
    metricGroups,
    hasCommercialFeature,
  ]);
}
