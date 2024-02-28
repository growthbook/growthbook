import { FC, useMemo, useState } from "react";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import { PValueCorrection, StatsEngine } from "back-end/types/stats";
import { ExperimentMetricInterface } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  setAdjustedPValuesOnResults,
  ExperimentTableRow,
  useRiskVariation,
  setAdjustedCIs,
} from "@/services/experiments";
import ResultsTable_old from "@/components/Experiment/ResultsTable_old";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Toggle from "@/components/Forms/Toggle";
import UsersTable from "./UsersTable";

const FULL_STATS_LIMIT = 5;

type TableDef = {
  metric: ExperimentMetricInterface;
  isGuardrail: boolean;
  rows: ExperimentTableRow[];
};

const BreakDownResults_old: FC<{
  results: ExperimentReportResultDimension[];
  variations: ExperimentReportVariation[];
  metrics: string[];
  metricOverrides: MetricOverride[];
  guardrails?: string[];
  dimensionId: string;
  isLatestPhase: boolean;
  startDate: string;
  reportDate: Date;
  activationMetric?: string;
  status: ExperimentStatus;
  statsEngine?: StatsEngine;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled?: boolean;
}> = ({
  dimensionId,
  results,
  variations,
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
  const { getDimensionById, getExperimentMetricById, ready } = useDefinitions();
  const pValueThreshold = usePValueThreshold();

  const dimension = useMemo(() => {
    return getDimensionById(dimensionId)?.name || "Dimension";
  }, [getDimensionById, dimensionId]);

  const tooManyDimensions = results.length > FULL_STATS_LIMIT;

  const [fullStatsToggle, setFullStats] = useState(false);
  const fullStats = !tooManyDimensions || fullStatsToggle;

  const tables = useMemo<TableDef[]>(() => {
    if (!ready) return [];
    if (pValueCorrection && statsEngine === "frequentist") {
      setAdjustedPValuesOnResults(results, metrics, pValueCorrection);
      setAdjustedCIs(results, pValueThreshold);
    }
    return Array.from(new Set(metrics.concat(guardrails || [])))
      .map((metricId) => {
        const metric = getExperimentMetricById(metricId);
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
    pValueThreshold,
    statsEngine,
    guardrails,
    ready,
    getExperimentMetricById,
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

      {tooManyDimensions && (
        <div className="row align-items-center mb-3 px-3">
          <div className="col">
            <div className="alert alert-warning mb-0">
              <strong>Warning: </strong> This dimension contains many unique
              values. We&apos;ve disabled the stats engine by default since it
              may be misleading.
            </div>
          </div>
          <div className="col-auto">
            <Toggle
              value={fullStats}
              setValue={setFullStats}
              id="full-stats"
              label="Show Full Stats"
            />
            Stats Engine
          </div>
        </div>
      )}

      <h3 className="mx-2 mb-2">Goal Metrics</h3>
      {tables.map((table) => (
        <div className="mb-5" key={table.metric.id}>
          <div className="px-3">
            <h3>
              {table.isGuardrail ? (
                <small className="text-muted">Guardrail: </small>
              ) : (
                ""
              )}
              {table.metric.name}
            </h3>
          </div>

          <div className="experiment-compact-holder">
            <ResultsTable_old
              dateCreated={reportDate}
              isLatestPhase={isLatestPhase}
              startDate={startDate}
              status={status}
              variations={variations}
              id={table.metric.id}
              tableRowAxis="dimension"
              labelHeader={dimension}
              renderLabelColumn={(label) => label || <em>unknown</em>}
              rows={table.rows}
              fullStats={fullStats}
              statsEngine={statsEngine}
              sequentialTestingEnabled={sequentialTestingEnabled}
              pValueCorrection={pValueCorrection}
              {...risk}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
export default BreakDownResults_old;
