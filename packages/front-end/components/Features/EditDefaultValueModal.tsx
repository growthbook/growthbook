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
      <div className="alert alert-info">
        Changes here will be added to a draft revision. You will have a chance
        to review it before making it live.
      </div>
      <FeatureValueField
        label="Value When Enabled"
        id="defaultValue"
        value={form.watch("defaultValue")}
        setValue={(v) => form.setValue("defaultValue", v)}
        valueType={feature.valueType}
      />
    </Modal>
  );
}
