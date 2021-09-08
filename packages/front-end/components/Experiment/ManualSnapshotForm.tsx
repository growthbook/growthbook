import { FC, useState, useEffect } from "react";
import Modal from "../Modal";
import {
  ExperimentSnapshotInterface,
  SnapshotVariation,
} from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MetricInterface, MetricStats } from "back-end/types/metric";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import {
  formatConversionRate,
  getMetricConversionTitle,
} from "../../services/metrics";
import Field from "../Forms/Field";

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

  const filteredMetrics: Partial<MetricInterface>[] = [];

  if (metrics) {
    experiment.metrics.forEach((mid) => {
      const m = metrics.filter((metric) => metric.id === mid)[0];
      if (!m) return;
      filteredMetrics.push(m);
    });
  }

  const initialValue: {
    users: number[];
    metrics: {
      [key: string]: MetricStats[];
    };
  } = { users: Array(experiment.variations.length).fill(0), metrics: {} };
  if (lastSnapshot?.results?.[0]) {
    initialValue.users = lastSnapshot.results[0].variations.map((v) => v.users);
  }
  filteredMetrics.forEach(({ id }) => {
    initialValue.metrics[id] = Array(experiment.variations.length).fill({
      count: 0,
      mean: 0,
      stddev: 0,
    });
    if (lastSnapshot?.results?.[0]) {
      for (let i = 0; i < experiment.variations.length; i++) {
        const variation = lastSnapshot.results[0].variations[i];
        if (variation?.metrics[id]) {
          initialValue.metrics[id][i] = variation.metrics[id].stats || {
            count: variation.metrics[id].value,
            mean: variation.metrics[id].value,
            stddev: 0,
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
          return {
            count: v.count,
            mean: 1,
            stddev: 1,
          };
        } else if (m.type === "count") {
          return {
            count: values.users[i],
            mean: v.mean,
            stddev: Math.sqrt(v.mean),
          };
        } else if (m.type === "revenue") {
          return {
            count: v.count,
            mean: v.mean,
            stddev: v.stddev,
          };
        } else {
          return {
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
                  required
                  prepend={v.name}
                  {...form.register(`users.${i}`, { valueAsNumber: true })}
                />
              </div>
            ))}
            {preview && preview.srm < 0.001 && (
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
        {filteredMetrics.map((m) => (
          <div className="mb-3" key={m.id}>
            <h4>{m.name}</h4>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th></th>
                  {m.type === "binomial" ? (
                    <th>Conversions</th>
                  ) : m.type === "count" ? (
                    <th>Average Count per User</th>
                  ) : (
                    <>
                      {m.type === "revenue" && <th>Conversions</th>}
                      <th>
                        Average (per{" "}
                        {m.type === "revenue" ? "conversion" : "user"})
                      </th>
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
                    {m.type === "binomial" ? (
                      <td>
                        <Field
                          type="number"
                          required
                          {...form.register(`metrics.${m.id}.${i}.count`, {
                            valueAsNumber: true,
                          })}
                        />
                      </td>
                    ) : m.type === "count" ? (
                      <td>
                        <Field
                          type="number"
                          required
                          {...form.register(`metrics.${m.id}.${i}.mean`, {
                            valueAsNumber: true,
                          })}
                        />
                      </td>
                    ) : (
                      <>
                        {m.type === "revenue" && (
                          <td>
                            <Field
                              type="number"
                              required
                              {...form.register(`metrics.${m.id}.${i}.count`, {
                                valueAsNumber: true,
                              })}
                            />
                          </td>
                        )}
                        <td>
                          <Field
                            type="number"
                            required
                            {...form.register(`metrics.${m.id}.${i}.mean`, {
                              valueAsNumber: true,
                            })}
                          />
                        </td>
                        <td>
                          <Field
                            type="number"
                            required
                            {...form.register(`metrics.${m.id}.${i}.stddev`, {
                              valueAsNumber: true,
                            })}
                          />
                        </td>
                      </>
                    )}
                    {m.type === "binomial" && (
                      <td>
                        {values.users[i] > 0 &&
                          values.metrics[m.id][i].count > 0 &&
                          formatConversionRate(
                            m.type,
                            values.metrics[m.id][i].count / values.users[i]
                          )}
                      </td>
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
        ))}
      </div>
    </Modal>
  );
};
export default ManualSnapshotForm;
