import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import MetricsSelector from "./MetricsSelector";

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

  return (
    <Modal
      autoFocusSelector=""
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
      <div style={{ height: 100 }} />
    </Modal>
  );
};

export default EditMetricsForm;
