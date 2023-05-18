import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import Modal from "../Modal";
import track from "../../services/track";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import EncryptionToggle from "./EncryptionToggle";
import UpgradeModal from "./UpgradeModal";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
  secret?: boolean;
  type?: string;
}> = ({ close, type, onCreate, defaultDescription = "", secret = false }) => {
  const { apiCall } = useAuth();
  const environments = useEnvironments();
  const [upgradeModal, setUpgradeModal] = useState(false);
  const { projects, project } = useDefinitions();

  const form = useForm({
    defaultValues: {
      description: defaultDescription,
      environment: environments[0]?.id || "dev",
      project: project || "",
      encryptSDK: false,
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify({
        ...value,
        type,
        secret,
      }),
    });
    track("Create API Key", {
      environment: value.environment,
      isSecret: secret,
    });
    onCreate();
  });

  const modalTitle = useMemo(() => {
    if (!secret) return "Create SDK Endpoint";

    if (type === "user") return "Create a Personal Access Token";
    if (type === "read-only") return "Create Read-only API key";

    return "Create Secret key";
  }, [secret, type]);

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
      header={modalTitle}
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      {!secret && projects.length > 0 && (
        <SelectField
          label="Project"
          initialOption="All Projects"
          value={form.watch("project")}
          onChange={(v) => form.setValue("project", v)}
          options={projects.map((p) => ({
            label: p.name,
            value: p.id,
          }))}
        />
      )}
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
        placeholder={secret ? "" : "(optional)"}
        {...form.register("description")}
      />
      {!secret && (
        <EncryptionToggle
          showUpgradeModal={() => setUpgradeModal(true)}
          value={form.watch("encryptSDK")}
          setValue={(value) => form.setValue("encryptSDK", value)}
        />
      )}
    </Modal>
  );
};

export default ApiKeysModal;
