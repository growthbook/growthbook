import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import EncryptionToggle from "@/components/Settings/EncryptionToggle";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Toggle from "@/components/Forms/Toggle";
import { isCloud } from "@/services/env";
import track from "@/services/track";
import SDKLanguageSelector from "./SDKLanguageSelector";
import { languageMapping } from "./SDKLanguageLogo";

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
  const router = useRouter();

  useEffect(() => {
    if (edit) return;
    track("View SDK Connection Form");
  }, [edit]);

  const gb = useGrowthBook();

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

  const languages = form.watch("languages");

  const hasSDKsWithoutEncryptionSupport = languages.some(
    (l) => !languageMapping[l].supportsEncryption
  );

  return (
    <Modal
      header={edit ? "Edit SDK COnnection" : "New SDK Connection"}
      size={"lg"}
      submit={form.handleSubmit(async (value) => {
        // Make sure encryption is disabled if they selected at least 1 language that's not supported
        // This is already be enforced in the UI, but there are some edge cases that might otherwise get through
        // For example, toggling encryption ON and then selecting an unsupported language
        if (
          value.languages.some((l) => !languageMapping[l].supportsEncryption)
        ) {
          value.encryptPayload = false;
        }

        const body: Omit<CreateSDKConnectionParams, "organization"> = {
          ...value,
        };

        if (edit) {
          await apiCall(`/sdk-connections/${initialValue.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          mutate();
        } else {
          track("Create SDK Connection", {
            languages: value.languages,
            encryptPayload: value.encryptPayload,
            proxyEnabled: value.proxyEnabled,
          });
          const res = await apiCall<{ connection: SDKConnectionInterface }>(
            `/sdk-connections`,
            {
              method: "POST",
              body: JSON.stringify(body),
            }
          );
          mutate();
          await router.push(`/sdks/${res.connection.id}`);
        }
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
        <small className="form-text text-muted">
          This helps us give you personalized setup instructions
        </small>
      </div>

      {projects.length > 0 && (
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

      <SelectField
        label="Environment"
        required
        placeholder="Choose one..."
        value={form.watch("environment")}
        onChange={(env) => form.setValue("environment", env)}
        options={environments.map((e) => ({ label: e.id, value: e.id }))}
      />

      {isCloud() && gb.isOn("proxy-cloud") && (
        <>
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
        </>
      )}

      {languages.length > 0 && !hasSDKsWithoutEncryptionSupport && (
        <EncryptionToggle
          showUpgradeModal={() => setUpgradeModal(true)}
          value={form.watch("encryptPayload")}
          setValue={(value) => form.setValue("encryptPayload", value)}
          showRequiresChangesWarning={edit}
        />
      )}
    </Modal>
  );
}
