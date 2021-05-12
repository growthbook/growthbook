import { FC, useState, useEffect } from "react";
import Modal from "../Modal";
import {
  ExperimentSnapshotInterface,
  SnapshotVariation,
} from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { MetricInterface } from "back-end/types/metric";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";

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
  const { metrics } = useDefinitions();
  const { apiCall } = useAuth();

  const filteredMetrics: Partial<MetricInterface>[] = [
    { id: "users", name: "Users" },
  ];

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
    [key: string]: number[];
  } = {};
  filteredMetrics.forEach(({ id }) => {
    initialValue[id] = Array(experiment.variations.length).fill(0);
    if (lastSnapshot?.results?.[0]) {
      for (let i = 0; i < experiment.variations.length; i++) {
        const variation = lastSnapshot.results[0].variations[i];
        if (id === "users" && variation) {
          initialValue[id][i] = variation.users;
        }
        if (variation?.metrics[id]) {
          initialValue[id][i] = variation.metrics[id].value;
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

  // Get preview stats when the value changes
  useEffect(() => {
    if (!hash) return;

    // Only preview when all variations have number of users set
    if (values.users.filter((n) => n <= 0).length > 0) {
      setPreview(null);
      return;
    }
    const metricsToTest: { [key: string]: number[] } = {};
    Object.keys(values).forEach((key) => {
      // Only preview metrics which have all variations filled out
      if (values[key].filter((n) => n <= 0).length > 0) {
        setPreview(null);
        return;
      }
      metricsToTest[key] = values[key];
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
              body: JSON.stringify(metricsToTest),
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
          data: values,
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
        {filteredMetrics.map((m) => (
          <div className="mb-3" key={m.id}>
            <h4>{m.name}</h4>
            {m.id === "users" ? (
              <div className="row">
                {experiment.variations.map((v, i) => (
                  <div className="col-auto" key={i}>
                    <div className="input-group">
                      <div className="input-group-prepend">
                        <div className="input-group-text">{v.name}</div>
                      </div>
                      <input
                        type="number"
                        required
                        {...(inputProps[m.id] ? inputProps[m.id][i] : {})}
                      />
                    </div>
                  </div>
                ))}
                {preview && preview.srm < 0.001 && (
                  <div className="col-12">
                    <div className="my-2 alert alert-danger">
                      Sample Ratio Mismatch (SRM) detected. Please double check
                      the number of users. If they are correct, there is likely
                      a bug in the test implementation.
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Raw Value</th>
                    <th>Conversion Rate</th>
                    <th>Chance to Beat Baseline</th>
                  </tr>
                </thead>
                <tbody>
                  {experiment.variations.map((v, i) => (
                    <tr key={i}>
                      <td>
                        <div className="input-group">
                          <div className="input-group-prepend">
                            <div className="input-group-text">{v.name}</div>
                          </div>
                          <input
                            type="number"
                            required
                            {...(inputProps[m.id] ? inputProps[m.id][i] : {})}
                          />
                        </div>
                      </td>
                      <td>
                        {values.users[i] > 0 &&
                          values[m.id][i] > 0 &&
                          (m.type === "binomial"
                            ? parseFloat(
                                (
                                  (100 * values[m.id][i]) /
                                  values.users[i]
                                ).toFixed(2)
                              ) + "%"
                            : parseFloat(
                                (values[m.id][i] / values.users[i]).toFixed(2)
                              ))}
                      </td>
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
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
};
export default ManualSnapshotForm;
