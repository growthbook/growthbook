import { FC, useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { FaExclamationTriangle } from "react-icons/fa";
import { useDefinitions } from "../../services/DefinitionsContext";
import {
  ExperimentTableRow,
  useRiskVariation,
} from "../../services/experiments";
import ResultsTable from "./ResultsTable";
import { MetricInterface } from "../../../back-end/types/metric";
import Toggle from "../Forms/Toggle";

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
  const srmFailures = snapshot.results.filter((r) => r.srm <= 0.001);
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
    experiment,
    [].concat(...tables.map((t) => t.rows))
  );

  return (
    <div className="mb-4 pb-4">
      {srmFailures.length > 0 && (
        <div className="mb-4">
          <h2>Users</h2>
          <div className="alert alert-danger">
            The following dimension values failed the Sample Ratio Mismatch
            (SRM) check. This means the traffic split between the variations was
            not what we expected. This is likely a bug.
          </div>
          <table className="table w-auto table-bordered">
            <thead>
              <tr>
                <th>{dimension}</th>
                {experiment.variations.map((v, i) => (
                  <th key={i}>{v.name}</th>
                ))}
                <th>Expected</th>
                <th>Actual</th>
                <th>SRM P-Value</th>
              </tr>
            </thead>
            <tbody>
              {srmFailures.map((r, i) => (
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
                  <td className="bg-danger text-light">
                    <FaExclamationTriangle className="mr-1" />
                    {(r.srm || 0).toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr />
          <h2>Metrics</h2>
        </div>
      )}

      {tooManyDimensions && (
        <div className="row align-items-center mb-3">
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
          <h3>
            {table.isGuardrail ? (
              <small className="text-muted">Guardrail: </small>
            ) : (
              ""
            )}
            {table.metric.name}
          </h3>

          <div className="experiment-compact-holder">
            <ResultsTable
              dateCreated={snapshot.dateCreated}
              experiment={experiment}
              id={table.metric.id}
              labelHeader={dimension}
              phase={snapshot.phase}
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
