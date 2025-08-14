import React, { useMemo } from "react";
import { ExperimentMetricBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import { groupBy } from "lodash";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
} from "shared/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getMetricResultGroup } from "@/components/Experiment/BreakDownResults";
import { BlockProps } from ".";

export default function ExperimentMetricBlock({
  block: { id, baselineRow, columnsFilter, variationIds },
  experiment,
  analysis,
  ssrPolyfills,
  metrics,
}: BlockProps<ExperimentMetricBlockInterface> & { block: { id?: string } }) {
  // todo?: assign stable temp ID when creating new block
  id = id || "" + Math.floor(Math.random() * 10000);

  const { pValueCorrection: hookPValueCorrection } = useOrgSettings();
  const { metricGroups } = useDefinitions();
  const goalMetrics = useMemo(
    () => expandMetricGroups(experiment.goalMetrics, metricGroups),
    [experiment, metricGroups]
  );
  const secondaryMetrics = useMemo(
    () => expandMetricGroups(experiment.secondaryMetrics, metricGroups),
    [experiment, metricGroups]
  );
  const guardrailMetrics = useMemo(
    () => expandMetricGroups(experiment.guardrailMetrics, metricGroups),
    [experiment, metricGroups]
  );

  const statsEngine = analysis.settings.statsEngine;

  const pValueCorrection =
    ssrPolyfills?.useOrgSettings()?.pValueCorrection || hookPValueCorrection;

  const sortedMetrics: ExperimentMetricInterface[] = useMemo(() => {
    const metricMap = new Map(metrics.map((m) => [m.id, m]));
    return [
      ...new Set([
        ...goalMetrics.map((mId) => metricMap.get(mId)).filter(isDefined),
        ...secondaryMetrics.map((mId) => metricMap.get(mId)).filter(isDefined),
        ...guardrailMetrics.map((mId) => metricMap.get(mId)).filter(isDefined),
      ]),
    ];
  }, [metrics, goalMetrics, secondaryMetrics, guardrailMetrics]);

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
        resultGroup: getMetricResultGroup(
          metric.id,
          goalMetrics,
          secondaryMetrics
        ),
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
          id={id}
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
