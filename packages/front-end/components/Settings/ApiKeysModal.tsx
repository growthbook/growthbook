import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import Field from "../Forms/Field";
import { useEnvironments } from "../../services/features";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
}> = ({ close, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const form = useForm({
    defaultValues: {
      description: defaultDescription,
      environment: environments[0]?.id || "dev",
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
        options={environments.map((e) => {
          return {
            value: e.id,
            display: e.id,
          };
        })}
        {...form.register("environment")}
      />
    </Modal>
  );
};

export default ApiKeysModal;
