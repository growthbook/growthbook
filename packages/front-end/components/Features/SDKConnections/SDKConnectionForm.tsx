import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { FaInfoCircle } from "react-icons/fa";
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
import Tooltip from "@/components/Tooltip/Tooltip";
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
      includeVisualExperiments: initialValue.includeVisualExperiments || false,
      includeDraftExperiments: initialValue.includeDraftExperiments || false,
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
  const hasNoSDKsWithVisualExperimentSupport = languages.every(
    (l) => !languageMapping[l].supportsVisualExperiments
  );

  return (
    <Modal
      header={edit ? "Edit SDK Connection" : "New SDK Connection"}
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
        if (
          languages.every((l) => !languageMapping[l].supportsVisualExperiments)
        ) {
          value.includeVisualExperiments = false;
        }
        if (!value.includeVisualExperiments) {
          value.includeDraftExperiments = false;
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

      {!hasNoSDKsWithVisualExperimentSupport && (
        <>
          <label>Visual experiments</label>
          <div className="border rounded pt-2 pb-3 px-3">
            <div>
              <label htmlFor="sdk-connection-visual-experiments-toggle">
                Include visual experiments in endpoint&apos;s response?
              </label>
              <div className="form-inline">
                <Toggle
                  id="sdk-connection-visual-experiments-toggle"
                  value={form.watch("includeVisualExperiments")}
                  setValue={(val) =>
                    form.setValue("includeVisualExperiments", val)
                  }
                />
              </div>
            </div>
            {form.watch("includeVisualExperiments") && (
              <div className="mt-3">
                <Tooltip
                  body={
                    <>
                      <p>
                        In-development visual experiments will be sent to the
                        SDK. We recommend only enabling this for non-production
                        environments.
                      </p>
                      <p className="mb-0">
                        To force into a variation, use a URL query string such
                        as{" "}
                        <div className="text-monospace">
                          ?my-experiment-id=2
                        </div>
                      </p>
                    </>
                  }
                >
                  <label htmlFor="sdk-connection-include-draft-experiments-toggle">
                    Include draft experiments <FaInfoCircle />
                  </label>
                </Tooltip>
                <div>
                  <Toggle
                    id="sdk-connection-include-draft-experiments-toggle"
                    value={form.watch("includeDraftExperiments")}
                    setValue={(val) =>
                      form.setValue("includeDraftExperiments", val)
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}

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
