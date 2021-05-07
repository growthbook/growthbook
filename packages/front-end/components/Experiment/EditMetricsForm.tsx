import { FC } from "react";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import { useMetrics } from "../../services/MetricsContext";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import MetricsSelector from "./MetricsSelector";

const EditMetricsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const [value, inputProps, manualUpdate] = useForm({
    metrics: experiment.metrics || [],
    activationMetric: experiment.activationMetric || "",
  });
  const { apiCall } = useAuth();
  const { metrics } = useMetrics();

  return (
    <Modal
      header={"Edit Metrics"}
      open={true}
      close={cancel}
      submit={async () => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      }}
      cta="Save"
    >
      <div className="form-group">
        <label>Goal Metrics</label>
        <MetricsSelector
          selected={value.metrics}
          onChange={(metrics) => {
            manualUpdate({ metrics });
          }}
          datasource={experiment.datasource}
        />
      </div>
      <div className="form-group">
        <label>Activation Metric</label>
        <select {...inputProps.activationMetric} className="form-control">
          <option value="">None</option>
          {metrics
            .filter((m) => m.datasource === experiment.datasource)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
        <small className="form-text text-muted">
          If set, users must convert on this metric before being included in the
          analysis.
        </small>
      </div>
      <div style={{ height: 100 }} />
    </Modal>
  );
};

export default EditMetricsForm;
