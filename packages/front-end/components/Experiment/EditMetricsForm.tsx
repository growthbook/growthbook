import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import MetricsSelector from "./MetricsSelector";
import { useDefinitions } from "../../services/DefinitionsContext";

const EditMetricsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm({
    defaultValues: {
      metrics: experiment.metrics || [],
      guardrails: experiment.guardrails || [],
      activationMetric: experiment.activationMetric || "",
    },
  });
  const { apiCall } = useAuth();
  const { metrics } = useDefinitions();

  return (
    <Modal
      header={"Edit Metrics"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      cta="Save"
    >
      <div className="form-group">
        <label className="font-weight-bold mb-1">Goal Metrics</label>
        <div className="mb-1 font-italic">
          Metrics you are trying to improve with this experiment.
        </div>
        <MetricsSelector
          selected={form.watch("metrics")}
          onChange={(metrics) => form.setValue("metrics", metrics)}
          datasource={experiment.datasource}
        />
      </div>
      <div className="form-group">
        <label className="font-weight-bold mb-1">Guardrail Metrics</label>
        <div className="mb-1 font-italic">
          Metrics you want to monitor, but are NOT specifically trying to
          improve.
        </div>
        <MetricsSelector
          selected={form.watch("guardrails")}
          onChange={(metrics) => form.setValue("guardrails", metrics)}
          datasource={experiment.datasource}
        />
      </div>
      <div className="form-group">
        <label className="font-weight-bold mb-1">Activation Metric</label>
        <div className="mb-1 font-italic">
          Users must complete this metric before being included in the analysis.
        </div>
        <select {...form.register("activationMetric")} className="form-control">
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
          This is for advanced use cases only.
        </small>
      </div>
      <div style={{ height: 100 }} />
    </Modal>
  );
};

export default EditMetricsForm;
