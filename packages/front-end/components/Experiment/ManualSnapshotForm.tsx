import { FC, useState, useEffect } from "react";
import Modal from "../Modal";
import {
  ExperimentSnapshotInterface,
  SnapshotVariation,
} from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MetricInterface, MetricStats } from "back-end/types/metric";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import {
  formatConversionRate,
  getMetricConversionTitle,
} from "../../services/metrics";

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
  const formKey =
    (lastSnapshot ? lastSnapshot.id : "") +
    filteredMetrics.map((m) => m.id).join("-");

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
  const [values, inputProps] = useForm(initialValue, formKey, {
    className: "form-control",
    onBlur: () => {
      setHash(JSON.stringify(values));
    },
  });
  const [preview, setPreview] = useState<SnapshotPreview>(null);

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
            mean: v.count / values.users[i],
            stddev: Math.sqrt(v.count / values.users[i]),
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
    console.log(ret);
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

  const onSubmit = async () => {
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
  };

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
      <div style={{ overflowY: "auto", overflowX: "hidden" }}>
        <div className="mb-3">
          <h4>Users</h4>
          <div className="row">
            {experiment.variations.map((v, i) => (
              <div className="col-auto" key={i}>
                <div className="input-group">
                  <div className="input-group-prepend">
                    <div className="input-group-text">{v.name}</div>
                  </div>
                  <input type="number" required {...inputProps.users[i]} />
                </div>
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
                    <th>Total Count</th>
                  ) : (
                    <>
                      <th>Average (per user)</th>
                      <th>Standard Deviation</th>
                    </>
                  )}
                  {(m.type === "binomial" || m.type === "count") && (
                    <th>{getMetricConversionTitle(m.type)}</th>
                  )}
                  <th>Chance to Beat Baseline</th>
                </tr>
              </thead>
              <tbody>
                {experiment.variations.map((v, i) => (
                  <tr key={i}>
                    <td>{v.name}</td>
                    {m.type === "binomial" || m.type === "count" ? (
                      <td>
                        <input
                          type="number"
                          required
                          {...inputProps.metrics[m.id][i].count}
                        />
                      </td>
                    ) : (
                      <>
                        <td>
                          <input
                            type="number"
                            required
                            {...inputProps.metrics[m.id][i].mean}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            required
                            {...inputProps.metrics[m.id][i].stddev}
                          />
                        </td>
                      </>
                    )}
                    {(m.type === "binomial" || m.type === "count") && (
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
