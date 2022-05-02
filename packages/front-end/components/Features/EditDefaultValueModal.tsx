import { useForm } from "react-hook-form";
import { FeatureInterface } from "back-end/types/feature";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import FeatureValueField from "./FeatureValueField";
import { getFeatureDefaultValue } from "../../services/features";

export interface Props {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
}

export default function EditDefaultValueModal({
  feature,
  close,
  mutate,
}: Props) {
  const form = useForm({
    defaultValues: {
      defaultValue: getFeatureDefaultValue(feature),
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      header="Edit Default Value"
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/feature/${feature.id}/defaultvalue`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      close={close}
      open={true}
    >
      <FeatureValueField
        label="Value When Enabled"
        form={form}
        field="defaultValue"
        valueType={feature.valueType}
      />
    </Modal>
  );
}
