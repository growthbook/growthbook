import { FC, useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import {
  DifferenceType,
  PValueCorrection,
  StatsEngine,
} from "back-end/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  setAdjustedCIs,
  hasRisk,
} from "@/services/experiments";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import {
  ResultsMetricFilters,
  sortAndFilterMetricsByTags,
} from "@/components/Experiment/Results";
import ResultsMetricFilter from "@/components/Experiment/ResultsMetricFilter";
import UsersTable from "./UsersTable";

type TableDef = {
  metric: ExperimentMetricInterface;
  isGuardrail: boolean;
  rows: ExperimentTableRow[];
};

const BreakDownResults: FC<{
  results: ExperimentReportResultDimension[];
  queryStatusData?: QueryStatusData;
  variations: ExperimentReportVariation[];
  variationFilter?: number[];
  baselineRow?: number;
  metrics: string[];
  metricOverrides: MetricOverride[];
  guardrails?: string[];
  dimensionId: string;
  isLatestPhase: boolean;
  startDate: string;
  reportDate: Date;
  activationMetric?: string;
  status: ExperimentStatus;
  statsEngine: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled?: boolean;
  differenceType: DifferenceType;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (filter: ResultsMetricFilters) => void;
}> = ({
  dimensionId,
  results,
  queryStatusData,
  variations,
  variationFilter,
  baselineRow,
  metrics,
  metricOverrides,
  guardrails,
  isLatestPhase,
  startDate,
  activationMetric,
  status,
  reportDate,
  statsEngine,
  pValueCorrection,
  regressionAdjustmentEnabled,
  metricRegressionAdjustmentStatuses,
  sequentialTestingEnabled,
  differenceType,
  metricFilter,
  setMetricFilter,
}) => {
  const [showMetricFilter, setShowMetricFilter] = useState<boolean>(false);

  const { getDimensionById, getExperimentMetricById, ready } = useDefinitions();
  const pValueThreshold = usePValueThreshold();

  const dimension = useMemo(() => {
    return getDimensionById(dimensionId)?.name || "Dimension";
  }, [getDimensionById, dimensionId]);

  const allMetricTags = useMemo(() => {
    const allMetricTagsSet: Set<string> = new Set();
    [...metrics, ...(guardrails || [])].forEach((metricId) => {
      const metric = getExperimentMetricById(metricId);
      metric?.tags?.forEach((tag) => {
        allMetricTagsSet.add(tag);
      });
    });
    return [...allMetricTagsSet];
  }, [metrics, guardrails, getExperimentMetricById]);

  const tables = useMemo<TableDef[]>(() => {
    if (!ready) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults(results, metrics, pValueCorrection);
      setAdjustedCIs(results, pValueThreshold);
    }

    const metricDefs = [...metrics, ...(guardrails || [])]
      .map((metricId) => getExperimentMetricById(metricId))
      .filter(Boolean) as ExperimentMetricInterface[];
    const sortedFilteredMetrics = sortAndFilterMetricsByTags(
      metricDefs,
      metricFilter,
    );

    return Array.from(new Set(sortedFilteredMetrics))
      .map((metricId) => {
        const metric = getExperimentMetricById(metricId);
        if (!metric) return;
        const ret = sortAndFilterMetricsByTags([metric], metricFilter);
        if (ret.length === 0) return;

        const { newMetric } = applyMetricOverrides(metric, metricOverrides);
        let regressionAdjustmentStatus:
          | MetricRegressionAdjustmentStatus
          | undefined;
        if (regressionAdjustmentEnabled && metricRegressionAdjustmentStatuses) {
          regressionAdjustmentStatus = metricRegressionAdjustmentStatuses.find(
            (s) => s.metric === metricId,
          );
        }

        return {
          metric: newMetric,
          isGuardrail: !metrics.includes(metricId),
          rows: results.map((d) => ({
            label: d.name,
            metric: newMetric,
            variations: d.variations.map((variation) => {
              return variation.metrics[metricId];
            }),
            regressionAdjustmentStatus,
          })) as ExperimentTableRow[],
        };
      })
      .filter((table) => table?.metric) as TableDef[];
  }, [
    results,
    metrics,
    guardrails,
    metricOverrides,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    pValueCorrection,
    statsEngine,
    pValueThreshold,
    ready,
    getExperimentMetricById,
    metricFilter,
  ]);

  const _hasRisk = hasRisk(
    ([] as ExperimentTableRow[]).concat(...tables.map((t) => t.rows)),
  );

  return (
    <div className="mb-3">
      <div className="mb-4 px-3">
        {dimensionId === "pre:activation" && activationMetric && (
          <div className="alert alert-info mt-1">
            Your experiment has an Activation Metric (
            <strong>{getExperimentMetricById(activationMetric)?.name}</strong>
            ). This report lets you compare activated users with those who
            entered into the experiment, but were not activated.
          </div>
        )}
        <UsersTable
          dimensionId={dimensionId}
          results={results}
          variations={variations}
        />
      </div>

      <div className="d-flex mx-2">
        {setMetricFilter ? (
          <ResultsMetricFilter
            metricTags={allMetricTags}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            showMetricFilter={showMetricFilter}
            setShowMetricFilter={setShowMetricFilter}
          />
        ) : null}
        <span className="h3 mb-0">Goal Metrics</span>
      </div>
      {tables.map((table, i) => {
        return (
          <>
            <ResultsTable
              key={i}
              dateCreated={reportDate}
              isLatestPhase={isLatestPhase}
              startDate={startDate}
              status={status}
              queryStatusData={queryStatusData}
              variations={variations}
              variationFilter={variationFilter}
              baselineRow={baselineRow}
              rows={table.rows}
              dimension={dimension}
              id={table.metric.id}
              hasRisk={_hasRisk}
              tableRowAxis="dimension" // todo: dynamic grouping?
              labelHeader={
                <div style={{ marginBottom: 2 }}>
                  {getRenderLabelColumn(regressionAdjustmentEnabled)(
                    table.metric.name,
                    table.metric,
                    table.rows[0],
                  )}
                </div>
              }
              editMetrics={undefined}
              statsEngine={statsEngine}
              sequentialTestingEnabled={sequentialTestingEnabled}
              pValueCorrection={pValueCorrection}
              differenceType={differenceType}
              renderLabelColumn={(label) => (
                <>
                  {/*<div className="uppercase-title">{dimension}:</div>*/}
                  {label ? (
                    label === "__NULL_DIMENSION" ? (
                      <em>NULL (unset)</em>
                    ) : (
                      <span
                        style={{
                          lineHeight: "1.2em",
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {label}
                      </span>
                    )
                  ) : (
                    <em>unknown</em>
                  )}
                </>
              )}
              metricFilter={metricFilter}
              isTabActive={true}
            />
            <div className="mb-5" />
          </>
        );
      })}
    </div>
  );
};
export default BreakDownResults;
