import { FC, useMemo, useState } from "react";
import { MetricInterface } from "back-end/types/metric";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "back-end/types/report";
import { ExperimentStatus, MetricOverride } from "back-end/types/experiment";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  applyMetricOverrides,
  ExperimentTableRow,
  useRiskVariation,
} from "@/services/experiments";
import Toggle from "../Forms/Toggle";
import ResultsTable from "./ResultsTable";
import UsersTable from "./UsersTable";

const FULL_STATS_LIMIT = 5;

type TableDef = {
  metric: MetricInterface;
  isGuardrail: boolean;
  rows: ExperimentTableRow[];
};

const BreakDownResults: FC<{
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
}) => {
  const { getDimensionById, getMetricById, ready } = useDefinitions();

  const dimension = useMemo(() => {
    return getDimensionById(dimensionId)?.name || "Dimension";
  }, [getDimensionById, dimensionId]);

  const tooManyDimensions = results.length > FULL_STATS_LIMIT;

  const [fullStatsToggle, setFullStats] = useState(false);
  const fullStats = !tooManyDimensions || fullStatsToggle;

  const tables = useMemo<TableDef[]>(() => {
    if (!ready) return [];
    return Array.from(new Set(metrics.concat(guardrails || [])))
      .map((metricId) => {
        const metric = getMetricById(metricId);
        const { newMetric } = applyMetricOverrides(metric, metricOverrides);
        return {
          metric: newMetric,
          isGuardrail: !metrics.includes(metricId),
          rows: results.map((d) => {
            return {
              label: d.name,
              metric: newMetric,
              variations: d.variations.map((variation) => {
                return variation.metrics[metricId];
              }),
            };
          }),
        };
      })
      .filter((table) => table.metric);
  }, [results, metrics, metricOverrides, guardrails, ready]);

  const risk = useRiskVariation(
    variations.length,
    [].concat(...tables.map((t) => t.rows))
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
            <ResultsTable
              dateCreated={reportDate}
              isLatestPhase={isLatestPhase}
              startDate={startDate}
              status={status}
              variations={variations}
              id={table.metric.id}
              labelHeader={dimension}
              renderLabelColumn={(label) => label || <em>unknown</em>}
              rows={table.rows}
              fullStats={fullStats}
              {...risk}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
export default BreakDownResults;
