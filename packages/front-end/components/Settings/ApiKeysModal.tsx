import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import Field from "../Forms/Field";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
}> = ({ close, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      description: defaultDescription,
      environment: "dev",
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify(value),
    });
    track("Create API Key", {
      environment: value.environment,
    });
    onCreate();
  });

  return (
    <Modal
      close={close}
      header="Create New Key"
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      <Field
        label="Description (optional)"
        textarea
        {...form.register("description")}
      />
      <Field
        label="Environment"
        options={["dev", "production"]}
        {...form.register("environment")}
      />
    </Modal>
  );
};

export default ApiKeysModal;
