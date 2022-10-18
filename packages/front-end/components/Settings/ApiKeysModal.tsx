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
  secret?: boolean;
}> = ({ close, onCreate, defaultDescription = "", secret = false }) => {
  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const form = useForm({
    defaultValues: {
      description: defaultDescription,
      environment: environments[0]?.id || "dev",
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    if (!secret && !value.description) {
      value.description = value.environment;
    }

    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify({
        ...value,
        secret,
      }),
    });
    track("Create API Key", {
      environment: value.environment,
      isSecret: secret,
    });
    onCreate();
  });

  return (
    <Modal
      close={close}
      header={secret ? "Create Secret Key" : "Create SDK Endpoint"}
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      {!secret && (
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
      )}
      <Field
        label="Description"
        required={secret}
        placeholder={secret ? "" : form.watch("environment")}
        {...form.register("description")}
      />
    </Modal>
  );
};

export default ApiKeysModal;
