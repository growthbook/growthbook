import { FC, useMemo } from "react";
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

const numberFormatter = new Intl.NumberFormat();

type TableDef = {
  metric: MetricInterface;
  isGuardrail: boolean;
  rows: ExperimentTableRow[];
};

const BreakDownResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
}> = ({ snapshot, experiment }) => {
  const srmFailures = snapshot.results.filter((r) => r.srm <= 0.001);
  const { getDimensionById, getMetricById } = useDefinitions();

  const dimension = useMemo(() => {
    return getDimensionById(snapshot.dimension)?.name || "Dimension";
  }, [getDimensionById, snapshot.dimension]);

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

      <div className="alert alert-warning">
        <strong>Warning: </strong>The more dimensions and metrics you look at,
        the more likely you are to see a false positive.
      </div>
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
              {...risk}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
export default BreakDownResults;
