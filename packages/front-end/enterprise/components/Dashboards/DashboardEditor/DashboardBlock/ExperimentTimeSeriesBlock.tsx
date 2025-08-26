import { ExperimentTimeSeriesBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { expandMetricGroups } from "shared/experiments";
import { Text } from "@radix-ui/themes";
import ExperimentMetricTimeSeriesGraphWrapper from "@/components/Experiment/ExperimentMetricTimeSeriesGraphWrapper";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getMetricResultGroup } from "@/components/Experiment/BreakDownResults";
import { BlockProps } from ".";

export default function ExperimentTimeSeriesBlock({
  block: { variationIds },
  experiment,
  snapshot,
  analysis,
  ssrPolyfills,
  metrics,
}: BlockProps<ExperimentTimeSeriesBlockInterface>) {
  const { pValueCorrection } = useOrgSettings();
  const { metricGroups } = useDefinitions();
  const goalMetrics = expandMetricGroups(experiment.goalMetrics, metricGroups);
  const secondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics,
    metricGroups,
  );

  const statsEngine = analysis.settings.statsEngine;

  return (
    <>
      {metrics.map((metric) => {
        const resultGroup = getMetricResultGroup(
          metric.id,
          goalMetrics,
          secondaryMetrics,
        );

        const appliedPValueCorrection =
          resultGroup === "goal"
            ? ((ssrPolyfills?.useOrgSettings()?.pValueCorrection ||
                pValueCorrection) ??
              null)
            : null;

        const showVariations = experiment.variations.map(
          (v) => variationIds.length === 0 || variationIds.includes(v.id),
        );
        const variationNames = experiment.variations.map(({ name }) => name);

        return (
          <div className="my-2" key={metric.id}>
            <Text weight="medium">{metric.name}</Text>
            <ExperimentMetricTimeSeriesGraphWrapper
              key={metric.id}
              experimentId={experiment.id}
              phase={snapshot.phase}
              experimentStatus={experiment.status}
              metric={metric}
              differenceType={analysis?.settings.differenceType || "relative"}
              showVariations={showVariations}
              variationNames={variationNames}
              statsEngine={statsEngine}
              pValueAdjustmentEnabled={!!appliedPValueCorrection}
              // TODO: Time series graph wrapper doesn't actually use firstDateToRender correctly
              firstDateToRender={new Date()}
            />
          </div>
        );
      })}
    </>
  );
}
