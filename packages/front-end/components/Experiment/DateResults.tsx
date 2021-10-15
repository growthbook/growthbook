import { FC, useMemo } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import { MetricInterface } from "back-end/types/metric";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "./ExperimentDateGraph";
import { formatConversionRate } from "../../services/metrics";
import { useState } from "react";
import Toggle from "../Forms/Toggle";

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

  const [cumulative, setCumulative] = useState(true);

  const users = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    const total: number[] = [];
    return snapshot.results.map((d) => {
      return {
        d: new Date(d.name),
        variations: experiment.variations.map((v, i) => {
          const users = d.variations[i]?.users || 0;
          total[i] = total[i] || 0;
          total[i] += users;
          return {
            value: cumulative ? total[i] : users,
            users: users,
            label: numberFormatter.format(cumulative ? total[i] : users),
          };
        }),
      };
    });
  }, [snapshot, cumulative]);

  const metrics = useMemo<Metric[]>(() => {
    return Array.from(
      new Set(experiment.metrics.concat(experiment.guardrails || []))
    )
      .map((metricId) => {
        const metric = getMetricById(metricId);
        const totalUsers: number[] = [];
        const totalValue: number[] = [];
        return {
          metric,
          isGuardrail: !experiment.metrics.includes(metricId),
          datapoints: snapshot.results.map((d) => {
            return {
              d: new Date(d.name),
              variations: d.variations.map((v, i) => {
                const stats = v?.metrics?.[metricId];
                const uplift = stats?.uplift;

                totalUsers[i] = totalUsers[i] || 0;
                totalValue[i] = totalValue[i] || 0;

                totalUsers[i] += stats?.users;
                totalValue[i] += stats?.value;

                let error: [number, number] | undefined = undefined;
                let value = 0;
                if (i && !cumulative) {
                  const x = uplift?.mean || 0;
                  const sx = uplift?.stddev || 0;
                  error = [Math.exp(x - 2 * sx) - 1, Math.exp(x + 2 * sx) - 1];
                  value = Math.exp(x) - 1;
                } else if (i) {
                  const crA = totalUsers[0] ? totalValue[0] / totalUsers[0] : 0;
                  const crB = totalUsers[i] ? totalValue[i] / totalUsers[i] : 0;
                  value = crA ? (crB - crA) / crA : 0;
                } else {
                  value = 0;
                }

                const users = (cumulative ? totalUsers[i] : stats?.users) || 0;

                const label = i
                  ? (value > 0 ? "+" : "") + percentFormatter.format(value)
                  : formatConversionRate(
                      metric.type,
                      cumulative
                        ? totalUsers[i]
                          ? totalValue[i] / totalUsers[i]
                          : 0
                        : stats?.cr || 0
                    );

                return {
                  value,
                  label,
                  users,
                  error,
                };
              }),
            };
          }),
        };
      })
      .filter((table) => table.metric);
  }, [snapshot, cumulative]);

  return (
    <div className="mb-4 pb-4">
      <div className="my-3 bg-light border p-2 d-flex align-items-center">
        <div className="mr-3">
          <strong>Graph Controls: </strong>
        </div>
        <div>
          <Toggle
            label="Cumulative"
            id="cumulative"
            value={cumulative}
            setValue={setCumulative}
          />
          Cumulative
        </div>
      </div>
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
