import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import Field from "../Forms/Field";
import useApi from "../../hooks/useApi";
import { EnvironmentApiResponse } from "../../pages/settings/environments";
import LoadingOverlay from "../LoadingOverlay";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
}> = ({ close, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();
  const { data, error } = useApi<EnvironmentApiResponse>(`/environments`);
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

  if (!data || error) {
    return <LoadingOverlay />;
  }
  const envs = data.environments.map((e) => {
    return {
      value: e.id,
      display: `${e.name} (${e.id})`,
    };
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
        options={envs}
        {...form.register("environment")}
      />
    </Modal>
  );
};

export default ApiKeysModal;
