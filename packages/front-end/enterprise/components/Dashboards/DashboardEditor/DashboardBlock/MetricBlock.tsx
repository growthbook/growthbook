import React, { useMemo } from "react";
import { MetricBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import { groupBy } from "lodash";
import { ExperimentMetricInterface } from "shared/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { BlockProps } from ".";

export default function MetricBlock({
  block: { baselineRow, columnsFilter, variationIds },
  experiment,
  analysis,
  ssrPolyfills,
  metrics,
}: BlockProps<MetricBlockInterface>) {
  const {
    pValueCorrection: hookPValueCorrection,
    statsEngine: hookStatsEngine,
  } = useOrgSettings();
  const statsEngine =
    ssrPolyfills?.useOrgSettings()?.statsEngine ||
    hookStatsEngine ||
    "frequentist";

  const pValueCorrection =
    ssrPolyfills?.useOrgSettings()?.pValueCorrection || hookPValueCorrection;

  const sortedMetrics: ExperimentMetricInterface[] = useMemo(() => {
    const metricMap = new Map(metrics.map((m) => [m.id, m]));
    return [
      ...experiment.goalMetrics
        .map((mId) => metricMap.get(mId))
        .filter(isDefined),
      ...experiment.secondaryMetrics
        .map((mId) => metricMap.get(mId))
        .filter(isDefined),
      ...experiment.guardrailMetrics
        .map((mId) => metricMap.get(mId))
        .filter(isDefined),
    ];
  }, [metrics, experiment]);

  const variations = experiment.variations.map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight:
      experiment.phases[experiment.phases.length - 1]?.variationWeights?.[i] ||
      0,
  }));
  const indexedVariations = experiment.variations.map((v, i) => ({
    ...v,
    index: i,
  }));

  const variationFilter =
    variationIds && variationIds.length > 0
      ? indexedVariations
          .filter((v) => !variationIds.includes(v.id))
          .map((v) => v.index)
      : undefined;

  const latestPhase = experiment.phases[experiment.phases.length - 1];

  const result = analysis.results[0];

  const allRows = sortedMetrics
    .map((metric) => {
      // Determine which group the metric belongs to
      let resultGroup: "goal" | "secondary" | "guardrail" = "goal";
      if (experiment.secondaryMetrics.includes(metric.id)) {
        resultGroup = "secondary";
      } else if (experiment.guardrailMetrics.includes(metric.id)) {
        resultGroup = "guardrail";
      }
      return {
        label: metric.name,
        metric,
        variations: result.variations.map((v) => ({
          value: v.metrics[metric.id]?.value || 0,
          cr: v.metrics[metric.id]?.cr || 0,
          users: v.users,
          denominator: v.metrics[metric.id]?.denominator,
          ci: v.metrics[metric.id]?.ci,
          ciAdjusted: v.metrics[metric.id]?.ciAdjusted,
          expected: v.metrics[metric.id]?.expected,
          risk: v.metrics[metric.id]?.risk,
          riskType: v.metrics[metric.id]?.riskType,
          stats: v.metrics[metric.id]?.stats,
          pValue: v.metrics[metric.id]?.pValue,
          pValueAdjusted: v.metrics[metric.id]?.pValueAdjusted,
          uplift: v.metrics[metric.id]?.uplift,
          buckets: v.metrics[metric.id]?.buckets,
          chanceToWin: v.metrics[metric.id]?.chanceToWin,
          errorMessage: v.metrics[metric.id]?.errorMessage,
          power: v.metrics[metric.id]?.power,
        })),
        resultGroup,
        metricOverrideFields: [],
      };
    })
    .filter(isDefined);

  const rowGroups = groupBy(allRows, ({ resultGroup }) => resultGroup);

  return (
    <div>
      {Object.entries(rowGroups).map(([resultGroup, rows]) => (
        <ResultsTable
          key={resultGroup}
          id={experiment.id}
          phase={experiment.phases.length - 1}
          variations={variations}
          variationFilter={variationFilter}
          baselineRow={baselineRow}
          columnsFilter={columnsFilter}
          status={experiment.status}
          isLatestPhase={true}
          startDate={latestPhase?.dateStarted || ""}
          endDate={latestPhase?.dateEnded || ""}
          rows={rows}
          tableRowAxis="metric"
          labelHeader={`${
            resultGroup.charAt(0).toUpperCase() + resultGroup.slice(1)
          } Metrics`}
          renderLabelColumn={(label) => label}
          dateCreated={new Date()}
          hasRisk={false}
          statsEngine={statsEngine}
          pValueCorrection={pValueCorrection}
          differenceType={analysis?.settings?.differenceType || "relative"}
          isTabActive={true}
          isGoalMetrics={resultGroup === "goal"}
        />
      ))}
    </div>
  );
}
