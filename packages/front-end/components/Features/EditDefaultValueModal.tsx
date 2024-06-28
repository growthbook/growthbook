import { useForm } from "react-hook-form";
import { FeatureInterface } from "back-end/types/feature";
import { validateFeatureValue } from "shared/util";
import { useAuth } from "@/services/auth";
import { getFeatureDefaultValue } from "@/services/features";
import Modal from "@/components/Modal";
import FeatureValueField from "./FeatureValueField";

export interface Props {
  feature: FeatureInterface;
  version: number;
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function EditDefaultValueModal({
  feature,
  version,
  close,
  mutate,
  setVersion,
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
        const newDefaultValue = validateFeatureValue(
          feature,
          value?.defaultValue ?? "",
          ""
        );
        if (newDefaultValue !== value.defaultValue) {
          form.setValue("defaultValue", newDefaultValue);
          throw new Error(
            "We fixed some errors in the value. If it looks correct, submit again."
          );
        }

        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${version}/defaultvalue`,
          {
            method: "POST",
            body: JSON.stringify(value),
          }
        );
        await mutate();
        res.version && setVersion(res.version);
      })}
      close={close}
      open={true}
      size={feature.valueType === "json" ? "lg" : "md"}
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
        feature={feature}
        renderJSONInline={true}
      />
    </Modal>
  );
}
