import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import MetricsSelector from "./MetricsSelector";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import SelectField from "../Forms/SelectField";
import { useDefinitions } from "../../services/DefinitionsContext";

export interface EditMetricsFormInterface {
  metrics: string[];
  guardrails: string[];
  activationMetric: string;
  metricOverrides: {
    id: string;
    conversionWindowHours: number;
    conversionDelayHours: number;
  }[];
}

const EditMetricsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const { metrics: metricDefinitions, getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);
  const filteredMetrics = metricDefinitions.filter(
    (m) => m.datasource === datasource?.id
  );
  const form = useForm<EditMetricsFormInterface>({
    defaultValues: {
      metrics: experiment.metrics || [],
      guardrails: experiment.guardrails || [],
      activationMetric: experiment.activationMetric || "",
      metricOverrides: experiment.metricOverrides || [],
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      autoFocusSelector=""
      header="Edit Metrics"
      size="lg"
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
          autoFocus={true}
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
          Users must convert on this metric before being included.
        </div>
        <SelectField
          options={filteredMetrics.map((m) => {
            return {
              label: m.name,
              value: m.id,
            };
          })}
          initialOption="None"
          value={form.watch("activationMetric")}
          onChange={(metric) => form.setValue("activationMetric", metric)}
        />
      </div>

      <div className="form-group mb-4">
        <label className="font-weight-bold mb-1">
          Metric Overrides (optional)
        </label>
        <div className="mb-1 font-italic">
          Override metric conversion windows within this experiment.
        </div>
        <MetricsOverridesSelector experiment={experiment} form={form} />
      </div>
    </Modal>
  );
};

export default EditMetricsForm;
