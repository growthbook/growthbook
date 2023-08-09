import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentTargetingData,
} from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import { getEqualWeights } from "@/services/utils";
import { useAttributeSchema } from "@/services/features";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";
import ConditionInput from "../Features/ConditionInput";
import NamespaceSelector from "../Features/NamespaceSelector";
import SelectField from "../Forms/SelectField";
import HashVersionSelector from "./HashVersionSelector";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function EditTargetingModal({
  close,
  experiment,
  mutate,
}: Props) {
  const lastPhase: ExperimentPhaseStringDates | undefined =
    experiment.phases[experiment.phases.length - 1];

  const form = useForm<ExperimentTargetingData>({
    defaultValues: {
      condition: lastPhase?.condition ?? "",
      coverage: lastPhase?.coverage ?? 1,
      hashAttribute: experiment.hashAttribute || "id",
      hashVersion: experiment.hashVersion || 2,
      namespace: lastPhase?.namespace || {
        enabled: false,
        name: "",
        range: [0, 1],
      },
      seed: lastPhase?.seed ?? "",
      trackingKey: experiment.trackingKey || "",
      variationWeights:
        lastPhase?.variationWeights ??
        getEqualWeights(experiment.variations.length, 4),
    },
  });
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  return (
    <Modal
      open={true}
      close={close}
      header={`Edit Targeting`}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}/targeting`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      size="lg"
    >
      <Field
        label="Tracking Key"
        labelClassName="font-weight-bold"
        {...form.register("trackingKey")}
        helpText="Unique identifier for this experiment, used to track impressions and analyze results"
      />
      <SelectField
        label="Assignment Attribute"
        labelClassName="font-weight-bold"
        options={attributeSchema
          .filter((s) => !hasHashAttributes || s.hashAttribute)
          .map((s) => ({ label: s.property, value: s.property }))}
        value={form.watch("hashAttribute")}
        onChange={(v) => {
          form.setValue("hashAttribute", v);
        }}
        helpText={
          "Will be hashed together with the Tracking Key to determine which variation to assign"
        }
      />
      <HashVersionSelector
        value={form.watch("hashVersion")}
        onChange={(v) => form.setValue("hashVersion", v)}
      />
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
}
