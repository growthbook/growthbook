import {
  CreateSDKConnectionParams,
  EditSDKConnectionParams,
  SDKConnectionInterface,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import EncryptionToggle from "@/components/Settings/EncryptionToggle";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Toggle from "@/components/Forms/Toggle";
import SDKLanguageSelector from "./SDKLanguageSelector";

export default function SDKConnectionForm({
  initialValue = {},
  edit,
  close,
  mutate,
}: {
  initialValue?: Partial<SDKConnectionInterface>;
  edit: boolean;
  close: () => void;
  mutate: () => void;
}) {
  const environments = useEnvironments();
  const { project, projects } = useDefinitions();
  const { apiCall } = useAuth();

  const [upgradeModal, setUpgradeModal] = useState(false);

  const form = useForm({
    defaultValues: {
      name: initialValue.name || "",
      languages: initialValue.languages || [],
      environment: initialValue.environment || environments[0]?.id || "",
      project: "project" in initialValue ? initialValue.project : project || "",
      encryptPayload: initialValue.encryptPayload || false,
      proxyEnabled: initialValue.proxy?.enabled || false,
      proxyHost: initialValue.proxy?.host || "",
    },
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
      header={edit ? "Edit SDK COnnection" : "New SDK Connection"}
      size={"lg"}
      submit={form.handleSubmit(async (value) => {
        if (edit) {
          const body: EditSDKConnectionParams = {
            name: value.name,
            languages: value.languages,
            proxyEnabled: value.proxyEnabled,
            proxyHost: value.proxyHost,
          };
          await apiCall(`/sdk-connections/${initialValue.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          const body: Omit<CreateSDKConnectionParams, "organization"> = {
            ...value,
          };
          await apiCall(`/sdk-connections`, {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
        mutate();
      })}
      close={close}
      open={true}
      cta="Save"
    >
      <Field label="Name" {...form.register("name")} required />

      <div className="form-group">
        <label>Tech Stack</label>
        <small className="text-muted ml-3">(Select all that apply)</small>
        <SDKLanguageSelector
          value={form.watch("languages")}
          setValue={(languages) => form.setValue("languages", languages)}
          multiple={true}
          includeOther={true}
        />
      </div>

      {!edit && projects.length > 0 && (
        <SelectField
          label="Project"
          initialOption="All Projects"
          value={form.watch("project")}
          onChange={(project) => form.setValue("project", project)}
          options={projects.map((p) => ({
            label: p.name,
            value: p.id,
          }))}
        />
      )}

      {!edit && (
        <SelectField
          label="Environment"
          required
          placeholder="Choose one..."
          value={form.watch("environment")}
          onChange={(env) => form.setValue("environment", env)}
          options={environments.map((e) => ({ label: e.id, value: e.id }))}
        />
      )}

      <div className="mb-3">
        <label htmlFor="sdk-connection-proxy-toggle">
          Use GrowthBook Proxy
        </label>
        <div>
          <Toggle
            id="sdk-connection-proxy-toggle"
            value={form.watch("proxyEnabled")}
            setValue={(val) => form.setValue("proxyEnabled", val)}
          />
        </div>
      </div>

      {form.watch("proxyEnabled") && (
        <Field
          label="GrowthBook Proxy Host"
          required
          placeholder="https://"
          type="url"
          {...form.register("proxyHost")}
        />
      )}

      {!edit && (
        <EncryptionToggle
          showUpgradeModal={() => setUpgradeModal(true)}
          value={form.watch("encryptPayload")}
          setValue={(value) => form.setValue("encryptPayload", value)}
        />
      )}
    </Modal>
  );
}
