import { FC } from "react";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotAnalysis,
} from "shared/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { MetricInterface, MetricStats } from "shared/types/metric";
import { useForm } from "react-hook-form";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getMetricConversionTitle,
  getMetricFormatter,
} from "@/services/metrics";
import { trackSnapshot } from "@/services/track";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

const ManualSnapshotForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  success: () => void;
  lastAnalysis?: ExperimentSnapshotAnalysis;
  phase: number;
}> = ({ experiment, close, success, lastAnalysis, phase }) => {
  const { getMetricById, metricGroups } = useDefinitions();
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();

  const filteredMetrics: MetricInterface[] = [];

  getAllMetricIdsFromExperiment(experiment, false, metricGroups).forEach(
    (mid) => {
      const m = getMetricById(mid);
      if (!m) return;
      filteredMetrics.push(m);
    },
  );

  const isRatio = (metric: MetricInterface) => {
    if (!metric.denominator) return false;
    const denominator = getMetricById(metric.denominator);
    if (!denominator) return false;
    if (denominator.type !== "count") return false;
    return true;
  };

  const initialValue: {
    users: number[];
    metrics: {
      [key: string]: Omit<MetricStats, "users">[];
    };
  } = { users: Array(experiment.variations.length).fill(0), metrics: {} };
  if (lastAnalysis?.results?.[0]) {
    initialValue.users = lastAnalysis.results[0].variations.map((v) => v.users);
  }
  filteredMetrics.forEach(({ id, type }) => {
    initialValue.metrics[id] = Array(experiment.variations.length).fill({
      count: 0,
      mean: 0,
      stddev: 0,
    });
    if (lastAnalysis?.results?.[0]) {
      for (let i = 0; i < experiment.variations.length; i++) {
        const variation = lastAnalysis.results[0].variations[i];
        if (variation?.metrics[id]) {
          let count =
            variation.metrics[id].stats?.count || variation.metrics[id].value;
          const mean =
            variation.metrics[id].stats?.mean || variation.metrics[id].value;
          const stddev = variation.metrics[id].stats?.stddev || 0;

          // Make sure binomial metrics have count = conversions
          // In the past, we stored it as count = conversions and mean = 1
          // Now, we store it as count = users, mean = conversions/count
          // So if we multiply mean * count, it works for both cases
          if (type === "binomial") {
            count = Math.round(mean * count);
          }

          initialValue.metrics[id][i] = {
            count,
            mean,
            stddev,
          };
        }
      }
    }
  });
  const form = useForm({
    defaultValues: initialValue,
  });

  const values = {
    metrics: form.watch("metrics"),
    users: form.watch("users"),
  };

  function getStats() {
    const ret: { [key: string]: MetricStats[] } = {};
    Object.keys(values.metrics).forEach((key) => {
      const m = getMetricById(key);
      ret[key] = values.metrics[key].map((v, i) => {
        if (m?.type === "binomial") {
          // Use the normal approximation for a bernouli variable to calculate stddev
          const p = v.count / values.users[i];
          return {
            users: values.users[i],
            count: values.users[i],
            mean: p,
            stddev: Math.sqrt(p * (1 - p)),
          };
        } else if (m && isRatio(m)) {
          return {
            users: values.users[i],
            count: v.count,
            mean: v.mean,
            stddev: v.stddev,
          };
        } else if (m?.ignoreNulls || m?.denominator) {
          // When ignoring nulls (or using a funnel metric)
          // Limit the users to only ones who converted
          return {
            users: v.count,
            count: v.count,
            mean: v.mean,
            stddev: v.stddev,
          };
        } else {
          return {
            users: values.users[i],
            count: values.users[i],
            mean: v.mean,
            stddev: v.stddev,
          };
        }
      });
    });
    return ret;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const res = await apiCall<{
      status: number;
      message: string;
      snapshot: ExperimentSnapshotInterface;
    }>(`/experiment/${experiment.id}/snapshot`, {
      method: "POST",
      body: JSON.stringify({
        phase,
        users: values.users,
        metrics: getStats(),
      }),
    });
    trackSnapshot(
      "create",
      "ManualSnapshotForm",
      getDatasourceById(experiment.datasource)?.type || null,
      res.snapshot,
    );

    success();
  });

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      size="lg"
      close={close}
      header="Update Results"
      key={experiment.id}
      submit={onSubmit}
    >
      <p>Manually enter the latest data for the experiment below.</p>
      <div style={{ overflowY: "auto", overflowX: "hidden" }}>
        <div className="mb-3">
          <h4>Users</h4>
          <div className="row">
            {experiment.variations.map((v, i) => (
              <div className="col-auto" key={i}>
                <Field
                  type="number"
                  step="1"
                  required
                  prepend={v.name}
                  {...form.register(`users.${i}`, { valueAsNumber: true })}
                />
              </div>
            ))}
          </div>
        </div>
        {filteredMetrics.map((m) => {
          const showCount =
            m.type === "binomial" || m.denominator || m.ignoreNulls;
          const countHeader =
            m.type === "binomial"
              ? "Conversions"
              : isRatio(m)
                ? "Denominator"
                : "Included Users";
          return (
            <div className="mb-3" key={m.id}>
              <h4>{m.name}</h4>
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th></th>
                    {showCount && <th>{countHeader}</th>}
                    {m.type !== "binomial" && (
                      <>
                        <th>Mean</th>
                        <th>Standard Deviation</th>
                      </>
                    )}
                    {m.type === "binomial" && (
                      <th>{getMetricConversionTitle(m.type)}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {experiment.variations.map((v, i) => (
                    <tr key={i}>
                      <td>{v.name}</td>
                      {showCount && (
                        <td>
                          <Field
                            type="number"
                            step={m.type === "binomial" ? "1" : "any"}
                            required
                            {...form.register(`metrics.${m.id}.${i}.count`, {
                              valueAsNumber: true,
                            })}
                          />
                        </td>
                      )}
                      {m.type === "binomial" ? (
                        <td>
                          {values.users[i] > 0 &&
                            values.metrics[m.id][i].count > 0 &&
                            getMetricFormatter(m.type)(
                              values.metrics[m.id][i].count / values.users[i],
                            )}
                        </td>
                      ) : (
                        <>
                          <td>
                            <Field
                              type="number"
                              step="any"
                              required
                              {...form.register(`metrics.${m.id}.${i}.mean`, {
                                valueAsNumber: true,
                              })}
                            />
                          </td>
                          <td>
                            <Field
                              type="number"
                              step="any"
                              required
                              {...form.register(`metrics.${m.id}.${i}.stddev`, {
                                valueAsNumber: true,
                              })}
                            />
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
export default ManualSnapshotForm;
