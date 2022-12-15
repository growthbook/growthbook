import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import track from "../../services/track";
import Field from "../Forms/Field";
import { useEnvironments } from "../../services/features";
import EncryptionToggle from "./EncryptionToggle";
import UpgradeModal from "./UpgradeModal";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
  secret?: boolean;
}> = ({ close, onCreate, defaultDescription = "", secret = false }) => {
  const { apiCall } = useAuth();
  const environments = useEnvironments();
  const [upgradeModal, setUpgradeModal] = useState(false);

  const form = useForm({
    defaultValues: {
      description: defaultDescription,
      environment: environments[0]?.id || "dev",
      encryptSDK: false,
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

  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        reason="To enable SDK encryption,"
        source="encrypt-features-endpoint"
      />
    );
  }

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
      {!secret && (
        <EncryptionToggle
          showUpgradeModal={() => setUpgradeModal(true)}
          form={form}
        />
      )}
    </Modal>
  );
};

export default ApiKeysModal;
