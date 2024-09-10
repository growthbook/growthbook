import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
  type?: "admin" | "readonly" | "user";
}> = ({ close, type, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();

  const form = useForm<{
    description: string;
    type: string;
  }>({
    defaultValues: {
      description: defaultDescription,
      type,
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify({
        ...value,
      }),
    });
    track("Create API Key", {
      isSecret: value.type !== "user",
    });
    onCreate();
  });

  return (
    <Modal
      trackingEventModalType=""
      close={close}
      header={"Create API Key"}
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      <Field
        label="Description"
        required={true}
        {...form.register("description")}
      />
      {type !== "user" && (
        <SelectField
          label="Role"
          value={form.watch("type")}
          onChange={(v) => form.setValue("type", v)}
          options={[
            {
              label: "Admin",
              value: "admin",
            },
            {
              label: "Read-only",
              value: "readonly",
            },
          ]}
        />
      )}
    </Modal>
  );
};

export default ApiKeysModal;
