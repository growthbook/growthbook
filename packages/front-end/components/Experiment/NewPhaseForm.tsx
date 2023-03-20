import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import { useWatching } from "@/services/WatchProvider";
import { getEqualWeights } from "@/services/utils";
import Modal from "../Modal";
import Field from "../Forms/Field";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";

const NewPhaseForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}> = ({ experiment, close, mutate }) => {
  const { refreshWatching } = useWatching();

  const firstPhase = !experiment.phases.length;

  const prevPhase: Partial<ExperimentPhaseStringDates> =
    experiment.phases[experiment.phases.length - 1] || {};

  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      name: prevPhase.name || "Main",
      coverage: prevPhase.coverage || 1,
      variationWeights:
        prevPhase.variationWeights ||
        getEqualWeights(experiment.variations.length),
      reason: "",
      dateStarted: new Date().toISOString().substr(0, 16),
      condition: "",
      namespace: {
        enabled: false,
        name: "",
        range: [0, 0.5],
      },
    },
  });

  const { apiCall } = useAuth();

  const variationWeights = form.watch("variationWeights");

  // Make sure variation weights add up to 1 (allow for a little bit of rounding error)
  const totalWeights = variationWeights.reduce(
    (total: number, weight: number) => total + weight,
    0
  );
  const isValid = totalWeights > 0.99 && totalWeights < 1.01;

  const submit = form.handleSubmit(async (value) => {
    if (!isValid) throw new Error("Variation weights must sum to 1");

    const body = {
      ...value,
    };

    await apiCall<{ status: number; message?: string }>(
      `/experiment/${experiment.id}/phase`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    mutate();
    refreshWatching();
  });

  return (
    <Modal
      header={firstPhase ? "Start Experiment" : "New Experiment Phase"}
      close={close}
      open={true}
      submit={submit}
      cta={"Start"}
      closeCta="Cancel"
      size="lg"
    >
      <div className="row">
        <Field
          label="Name"
          containerClassName="col-lg"
          required
          {...form.register("name")}
        />
      </div>
      <div className="row">
        {!firstPhase && (
          <Field
            containerClassName="col-12"
            label="Reason for Starting New Phase"
            textarea
            {...form.register("reason")}
            placeholder="(optional)"
          />
        )}
        <Field
          containerClassName="col-12"
          label="Start Time (UTC)"
          type="datetime-local"
          {...form.register("dateStarted")}
        />
      </div>

      <ConditionInput
        defaultValue={form.watch("condition")}
        onChange={(condition) => form.setValue("condition", condition)}
      />

      <FeatureVariationsInput
        valueType={"string"}
        coverage={form.watch("coverage")}
        setCoverage={(coverage) => form.setValue("coverage", coverage)}
        setWeight={(i, weight) =>
          form.setValue(`variationWeights.${i}`, weight)
        }
        valueAsId={true}
        variations={
          experiment.variations.map((v, i) => {
            return {
              value: v.key || i + "",
              name: v.name,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            };
          }) || []
        }
        showPreview={false}
      />

      <NamespaceSelector
        form={form}
        featureId={experiment.trackingKey}
        trackingKey={experiment.trackingKey}
      />
    </Modal>
  );
};

export default NewPhaseForm;
