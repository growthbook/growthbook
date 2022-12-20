import { FC, useState, useEffect } from "react";
import {
  ExperimentSnapshotInterface,
  SnapshotVariation,
} from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MetricInterface, MetricStats } from "back-end/types/metric";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  formatConversionRate,
  getMetricConversionTitle,
} from "@/services/metrics";
import Modal from "../Modal";
import Field from "../Forms/Field";
import { SRM_THRESHOLD } from "./SRMWarning";

type SnapshotPreview = {
  srm: number;
  variations: SnapshotVariation[];
};

const ManualSnapshotForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  success: () => void;
  lastSnapshot?: ExperimentSnapshotInterface;
  phase: number;
}> = ({ experiment, close, success, lastSnapshot, phase }) => {
  const { metrics, getMetricById } = useDefinitions();
  const { apiCall } = useAuth();

  const filteredMetrics: MetricInterface[] = [];

  if (metrics) {
    experiment.metrics.forEach((mid) => {
      const m = metrics.filter((metric) => metric.id === mid)[0];
      if (!m) return;
      filteredMetrics.push(m);
    });
  }

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
  if (lastSnapshot?.results?.[0]) {
    initialValue.users = lastSnapshot.results[0].variations.map((v) => v.users);
  }
  filteredMetrics.forEach(({ id, type }) => {
    initialValue.metrics[id] = Array(experiment.variations.length).fill({
      count: 0,
      mean: 0,
      stddev: 0,
    });
    if (lastSnapshot?.results?.[0]) {
      for (let i = 0; i < experiment.variations.length; i++) {
        const variation = lastSnapshot.results[0].variations[i];
        if (variation?.metrics[id]) {
          let count =
            variation.metrics[id].stats?.count || variation.metrics[id].value;
          const mean =
            variation.metrics[id].stats?.mean || variation.metrics[id].value;
          const stddev = variation.metrics[id].stats?.stddev || 0;

          // Make sure binomial metrics have count = conversions
          // In the past, we stored it as count = conversions and mean = 1
          // Now, we store it as count = users, mean = conversions/count
          // So if we multiple mean * count, it works for both cases
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
  const [hash, setHash] = useState(null);
  const form = useForm({
    defaultValues: initialValue,
  });
  const [preview, setPreview] = useState<SnapshotPreview>(null);

  const values = {
    metrics: form.watch("metrics"),
    users: form.watch("users"),
  };

  function getStats() {
    const ret: { [key: string]: MetricStats[] } = {};
    Object.keys(values.metrics).forEach((key) => {
      const m = getMetricById(key);
      ret[key] = values.metrics[key].map((v, i) => {
        if (m.type === "binomial") {
          // Use the normal approximation for a bernouli variable to calculate stddev
          const p = v.count / values.users[i];
          return {
            users: values.users[i],
            count: values.users[i],
            mean: p,
            stddev: Math.sqrt(p * (1 - p)),
          };
        } else if (isRatio(m)) {
          // For ratio metrics, the count (denominator) may be different from the number of users
          return {
            users: values.users[i],
            count: v.count,
            mean: v.mean,
            stddev: v.stddev,
          };
        } else if (m.ignoreNulls || m.denominator) {
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

  // Get preview stats when the value changes
  useEffect(() => {
    if (!hash) return;

    // Only preview when all variations have number of users set
    if (values.users.filter((n) => n <= 0).length > 0) {
      setPreview(null);
      return;
    }
    const metricsToTest: { [key: string]: MetricStats[] } = {};
    const stats = getStats();
    Object.keys(stats).forEach((key) => {
      // Only preview metrics which have all variations filled out
      if (
        stats[key].filter((n) => Math.min(n.count, n.mean, n.stddev) <= 0)
          .length > 0
      ) {
        setPreview(null);
        return;
      }
      metricsToTest[key] = stats[key];
    });

    // Make sure there's at least 1 metric fully entered
    if (Object.keys(metricsToTest).length > 0) {
      let cancel = false;
      (async () => {
        try {
          const res = await apiCall<{ snapshot: SnapshotPreview }>(
            `/experiment/${experiment.id}/snapshot/${phase}/preview`,
            {
              method: "POST",
              body: JSON.stringify({
                users: values.users,
                metrics: metricsToTest,
              }),
            }
          );
          if (cancel) return;
          setPreview(res.snapshot);
        } catch (e) {
          console.error(e);
        }
      })();

      return () => {
        // If the effect is removed, set a flag to abort the api call above
        cancel = true;
      };
    }
  }, [hash]);

  const onSubmit = form.handleSubmit(async (values) => {
    await apiCall<{ status: number; message: string }>(
      `/experiment/${experiment.id}/snapshot`,
      {
        method: "POST",
        body: JSON.stringify({
          phase,
          users: values.users,
          metrics: getStats(),
        }),
      }
    );

    success();
  });

  return (
    <Modal
      open={true}
      size="lg"
      close={close}
      header="Update Results"
      key={experiment.id}
      submit={onSubmit}
    >
      <p>Manually enter the latest data for the experiment below.</p>
      <div
        style={{ overflowY: "auto", overflowX: "hidden" }}
        onBlur={(e) => {
          if (e.target.tagName !== "INPUT") return;
          setHash(JSON.stringify(form.getValues()));
        }}
      >
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
            {preview && preview.srm < SRM_THRESHOLD && (
              <div className="col-12">
                <div className="my-2 alert alert-danger">
                  Sample Ratio Mismatch (SRM) detected. Please double check the
                  number of users. If they are correct, there is likely a bug in
                  the test implementation.
                </div>
              </div>
            )}
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
                    <th>Chance to Beat Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {experiment.variations.map((v, i) => (
                    <tr key={i}>
                      <td>{v.name}</td>
                      {showCount && (
                        <Field
                          type="number"
                          step={m.type === "binomial" ? "1" : "any"}
                          required
                          {...form.register(`metrics.${m.id}.${i}.count`, {
                            valueAsNumber: true,
                          })}
                        />
                      )}
                      {m.type === "binomial" ? (
                        <td>
                          {values.users[i] > 0 &&
                            values.metrics[m.id][i].count > 0 &&
                            formatConversionRate(
                              m.type,
                              values.metrics[m.id][i].count / values.users[i]
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
                      <td>
                        {i > 0 &&
                          preview &&
                          preview.variations[i].metrics[m.id] &&
                          parseFloat(
                            (
                              preview.variations[i].metrics[m.id].chanceToWin *
                              100
                            ).toFixed(2)
                          ) + "%"}
                      </td>
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
