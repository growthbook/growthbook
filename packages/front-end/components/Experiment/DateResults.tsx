import { FC, useMemo } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import { MetricInterface } from "back-end/types/metric";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "./ExperimentDateGraph";
import { formatConversionRate } from "../../services/metrics";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

type Metric = {
  metric: MetricInterface;
  isGuardrail: boolean;
  datapoints: ExperimentDateGraphDataPoint[];
};

const DateResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
}> = ({ snapshot, experiment }) => {
  const { getMetricById } = useDefinitions();

  const users = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    return snapshot.results.map((d) => {
      return {
        d: new Date(d.name),
        variations: experiment.variations.map((v, i) => ({
          value: d.variations[i]?.users || 0,
          label: numberFormatter.format(d.variations[i]?.users || 0),
        })),
      };
    });
  }, [snapshot]);

  const metrics = useMemo<Metric[]>(() => {
    return Array.from(
      new Set(experiment.metrics.concat(experiment.guardrails || []))
    )
      .map((metricId) => {
        const metric = getMetricById(metricId);
        return {
          metric,
          isGuardrail: !experiment.metrics.includes(metricId),
          datapoints: snapshot.results.map((d) => {
            return {
              d: new Date(d.name),
              variations: d.variations.map((v, i) => {
                const stats = v?.metrics?.[metricId];
                const uplift = stats?.uplift;
                const value = i ? Math.exp(uplift?.mean || 0) - 1 : 0;
                const stddev = i
                  ? Math.exp(uplift?.stddev || 0) - 1
                  : undefined;
                const label = i
                  ? (value > 0 ? "+" : "") + percentFormatter.format(value)
                  : formatConversionRate(
                      metric.type,
                      (metric.type === "binomial" ? stats?.cr : stats?.value) ||
                        0
                    );
                return {
                  value,
                  label,
                  stddev,
                };
              }),
            };
          }),
        };
      })
      .filter((table) => table.metric);
  }, [snapshot]);

  return (
    <div className="mb-4 pb-4">
      <div className="mb-5">
        <h3>Users</h3>
        <ExperimentDateGraph
          datapoints={users}
          label="Users"
          tickFormat={(v) => numberFormatter.format(v)}
          variationNames={experiment.variations.map((v) => v.name)}
        />
      </div>
      {metrics.map(({ metric, isGuardrail, datapoints }) => (
        <div className="mb-5" key={metric.id}>
          <h3>
            {metric.name}{" "}
            {isGuardrail && (
              <small className="badge badge-secondary">Guardrail</small>
            )}
          </h3>
          <ExperimentDateGraph
            datapoints={datapoints}
            label="Relative Uplift"
            tickFormat={(v) => percentFormatter.format(v)}
            variationNames={experiment.variations.map((v) => v.name)}
          />
        </div>
      ))}
    </div>
  );
};
export default DateResults;
