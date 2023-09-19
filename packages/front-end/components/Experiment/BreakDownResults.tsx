import { FC, useMemo } from "react";
import { MetricInterface } from "back-end/types/metric";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  useRiskVariation,
} from "@/services/experiments";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { QueryStatusData } from "@/components/Queries/RunQueriesButton";
import { getRenderLabelColumn } from "@/components/Experiment/CompactResults";
import UsersTable from "./UsersTable";

type TableDef = {
  metric: MetricInterface;
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
}) => {
  const { getDimensionById, getMetricById, ready } = useDefinitions();

  const dimension = useMemo(() => {
    return getDimensionById(dimensionId)?.name || "Dimension";
  }, [getDimensionById, dimensionId]);

  const tables = useMemo<TableDef[]>(() => {
    if (!ready) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults(results, metrics, pValueCorrection);
    }
    return Array.from(new Set(metrics.concat(guardrails || [])))
      .map((metricId) => {
        const metric = getMetricById(metricId);
        if (!metric) return;
        const { newMetric } = applyMetricOverrides(metric, metricOverrides);
        let regressionAdjustmentStatus:
          | MetricRegressionAdjustmentStatus
          | undefined;
        if (regressionAdjustmentEnabled && metricRegressionAdjustmentStatuses) {
          regressionAdjustmentStatus = metricRegressionAdjustmentStatuses.find(
            (s) => s.metric === metricId
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
    metricOverrides,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    pValueCorrection,
    statsEngine,
    guardrails,
    ready,
    getMetricById,
  ]);

  const risk = useRiskVariation(
    variations.length,
    ([] as ExperimentTableRow[]).concat(...tables.map((t) => t.rows))
  );

  return (
    <div className="mb-3">
      <div className="mb-4 px-3">
        {dimensionId === "pre:activation" && activationMetric && (
          <div className="alert alert-info mt-1">
            Your experiment has an Activation Metric (
            <strong>{getMetricById(activationMetric)?.name}</strong>
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

      <h3 className="mx-2 mb-0">Goal Metrics</h3>
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
              hasRisk={risk.hasRisk}
              tableRowAxis="dimension" // todo: dynamic grouping?
              labelHeader={
                <div style={{ marginBottom: 2 }}>
                  {getRenderLabelColumn(regressionAdjustmentEnabled)(
                    table.metric.name,
                    table.metric,
                    table.rows[0]
                  )}
                </div>
              }
              editMetrics={undefined}
              statsEngine={statsEngine}
              sequentialTestingEnabled={sequentialTestingEnabled}
              pValueCorrection={pValueCorrection}
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
