import { FC, useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { FaExclamationTriangle, FaQuestionCircle } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import {
  ExperimentTableRow,
  useRiskVariation,
} from "../../services/experiments";
import ResultsTable from "./ResultsTable";
import { MetricInterface } from "back-end/types/metric";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip";

const FULL_STATS_LIMIT = 5;

const numberFormatter = new Intl.NumberFormat();

type TableDef = {
  metric: MetricInterface;
  isGuardrail: boolean;
  rows: ExperimentTableRow[];
};

function getAllocationText(weights: number[]) {
  const sum = weights.reduce((s, n) => s + n, 0);
  if (!sum) return "";
  const adjusted = weights.map((w) => {
    return Math.round((w * 100) / sum);
  });

  const adjustedSum = adjusted.reduce((s, n) => s + n, 0);
  if (adjustedSum !== 100) {
    const dir = adjustedSum > 100 ? -1 : 1;
    const numDiff = Math.abs(adjustedSum - 100);

    for (let i = 0; i < numDiff; i++) {
      adjusted[i % adjusted.length] += dir;
    }
  }

  return adjusted.join("/");
}

const BreakDownResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
}> = ({ snapshot, experiment }) => {
  const { getDimensionById, getMetricById } = useDefinitions();

  const dimension = useMemo(() => {
    return getDimensionById(snapshot.dimension)?.name || "Dimension";
  }, [getDimensionById, snapshot.dimension]);

  const tooManyDimensions = snapshot.results?.length > FULL_STATS_LIMIT;

  const [fullStatsToggle, setFullStats] = useState(false);
  const fullStats = !tooManyDimensions || fullStatsToggle;

  const tables = useMemo<TableDef[]>(() => {
    return Array.from(
      new Set(experiment.metrics.concat(experiment.guardrails || []))
    )
      .map((metricId) => {
        const metric = getMetricById(metricId);
        return {
          metric,
          isGuardrail: !experiment.metrics.includes(metricId),
          rows: snapshot.results.map((d) => {
            return {
              label: d.name,
              metric,
              variations: d.variations.map((variation) => {
                return variation.metrics[metricId];
              }),
            };
          }),
        };
      })
      .filter((table) => table.metric);
  }, [snapshot]);

  const risk = useRiskVariation(
    experiment.variations.length,
    [].concat(...tables.map((t) => t.rows))
  );

  const phase = experiment.phases[snapshot.phase];

  return (
    <div className="mb-3">
      <div className="mb-4 px-3">
        {snapshot.dimension === "pre:activation" && snapshot.activationMetric && (
          <div className="alert alert-info mt-1">
            Your experiment has an Activation Metric (
            <strong>{getMetricById(snapshot.activationMetric)?.name}</strong>
            ). This report lets you compare activated users with those who
            entered into the experiment, but were not activated.
          </div>
        )}
        <h2>Users</h2>
        <table className="table w-auto table-bordered mb-5">
          <thead>
            <tr>
              <th>{dimension}</th>
              {experiment.variations.map((v, i) => (
                <th key={i}>{v.name}</th>
              ))}
              <th>Expected</th>
              <th>Actual</th>
              <th>
                SRM P-Value{" "}
                <Tooltip text="Sample Ratio Mismatch (SRM) occurs when the actual traffic split is not what we expect. A small value (<0.001) indicates a likely bug.">
                  <FaQuestionCircle />
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            {snapshot.results?.map((r, i) => (
              <tr key={i}>
                <td>{r.name || <em>unknown</em>}</td>
                {experiment.variations.map((v, i) => (
                  <td key={i}>
                    {numberFormatter.format(r.variations[i]?.users || 0)}
                  </td>
                ))}
                <td>
                  {getAllocationText(
                    experiment.phases[snapshot.phase]?.variationWeights || []
                  )}
                </td>
                <td>
                  {getAllocationText(
                    experiment.variations.map(
                      (v, i) => r.variations[i]?.users || 0
                    )
                  )}
                </td>
                {r.srm < 0.001 ? (
                  <td className="bg-danger text-light">
                    <FaExclamationTriangle className="mr-1" />
                    {(r.srm || 0).toFixed(6)}
                  </td>
                ) : (
                  <td>{(r.srm || 0).toFixed(6)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Metrics</h2>
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
              dateCreated={snapshot.dateCreated}
              isLatestPhase={snapshot.phase === experiment.phases.length - 1}
              startDate={phase.dateStarted}
              status={experiment.status}
              variations={experiment.variations.map((v, i) => {
                return {
                  id: v.key || i + "",
                  name: v.name,
                  weight: phase.variationWeights[i] || 0,
                };
              })}
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
