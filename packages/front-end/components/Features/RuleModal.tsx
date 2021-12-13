import { useForm } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureValueField from "./FeatureValueField";
import { useAuth } from "../../services/auth";
import ConditionInput from "./ConditionInput";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
}

export default function RuleModal({ close, feature, i, mutate }: Props) {
  const defaultValues = {
    condition: "",
    description: "",
    enabled: true,
    type: "force",
    value: feature.defaultValue,
    ...((feature?.rules?.[i] as FeatureRule) || {}),
  };
  const form = useForm({
    defaultValues,
  });

  const { apiCall } = useAuth();

  const type = form.watch("type");

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      header={feature.rules[i] ? "Edit Override Rule" : "New Override Rule"}
      submit={form.handleSubmit(async (values) => {
        const rules = [...feature.rules];
        rules[i] = values as FeatureRule;
        await apiCall(`/feature/${feature.id}`, {
          method: "PUT",
          body: JSON.stringify({
            rules,
          }),
        });
        mutate();
      })}
    >
      <Field
        label="Description"
        required
        textarea
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />
      <ConditionInput
        defaultValue={defaultValues.condition || ""}
        onChange={(value) => form.setValue("condition", value)}
      />
      <Field
        {...form.register("type")}
        label="Rule Action"
        options={[
          { display: "Force a specific value", value: "force" },
          { display: "Percentage rollout", value: "rollout" },
          { display: "Experiment", value: "experiment" },
        ]}
      />

      {type === "force" && (
        <FeatureValueField
          label="Value to Force"
          form={form}
          field="value"
          valueType={feature.valueType}
        />
      )}
    </Modal>
  );
}
