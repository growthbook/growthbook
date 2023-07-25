import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import {
  FaExclamationCircle,
  FaExclamationTriangle,
  FaInfoCircle,
} from "react-icons/fa";
import { BsLightningFill } from "react-icons/bs";
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
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { DocLink } from "@/components/DocLink";
import SDKLanguageSelector from "./SDKLanguageSelector";
import SDKLanguageLogo, { languageMapping } from "./SDKLanguageLogo";

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
  const { project, projects, getProjectById } = useDefinitions();
  const { apiCall } = useAuth();
  const router = useRouter();

  const { hasCommercialFeature } = useUser();

  const hasCloudProxyFeature = hasCommercialFeature("cloud-proxy");
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes"
  );

  useEffect(() => {
    if (edit) return;
    track("View SDK Connection Form");
  }, [edit]);

  const gb = useGrowthBook();

  const [upgradeModal, setUpgradeModal] = useState(false);

  const form = useForm({
    defaultValues: {
      name: initialValue.name ?? "",
      languages: initialValue.languages ?? [],
      environment: initialValue.environment ?? environments[0]?.id ?? "",
      project: "project" in initialValue ? initialValue.project : project ?? "",
      encryptPayload: initialValue.encryptPayload ?? false,
      hashSecureAttributes:
        initialValue.hashSecureAttributes ?? hasSecureAttributesFeature,
      includeVisualExperiments: initialValue.includeVisualExperiments ?? false,
      includeDraftExperiments: initialValue.includeDraftExperiments ?? false,
      includeExperimentNames: initialValue.includeExperimentNames ?? false,
      proxyEnabled: initialValue.proxy?.enabled ?? false,
      proxyHost: initialValue.proxy?.host ?? "",
      sseEnabled: initialValue.sseEnabled ?? false,
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

  const selectedLanguagesWithoutEncryptionSupport = languages.filter(
    (l) => !languageMapping[l].supportsEncryption
  );
  const hasNoSDKsWithVisualExperimentSupport = languages.every(
    (l) => !languageMapping[l].supportsVisualExperiments
  );
  const hasNoSDKsWithSSESupport = languages.every(
    (l) => !languageMapping[l].supportsSSE
  );

  const languagesWithSSESupport = Object.entries(languageMapping).filter(
    ([_, v]) => v.supportsSSE
  );

  const projectsOptions = projects.map((p) => ({
    label: p.name,
    value: p.id,
  }));
  const projectId = initialValue.project;
  const projectName = projectId
    ? getProjectById(projectId)?.name || null
    : null;
  const projectIsDeReferenced = projectId && !projectName;
  if (projectIsDeReferenced) {
    projectsOptions.push({
      label: "Invalid project",
      value: projectId,
    });
  }

  return (
    <Modal
      header={edit ? "Edit SDK Connection" : "New SDK Connection"}
      size={"lg"}
      submit={form.handleSubmit(async (value) => {
        if (
          languages.every((l) => !languageMapping[l].supportsVisualExperiments)
        ) {
          value.includeVisualExperiments = false;
        }
        if (!value.includeVisualExperiments) {
          value.includeDraftExperiments = false;
          value.includeExperimentNames = false;
        }

        const body: Omit<CreateSDKConnectionParams, "organization"> = {
          ...value,
          project: value.project || "",
        };

        if (edit) {
          await apiCall(`/sdk-connections/${initialValue.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          mutate();
        } else {
          const res = await apiCall<{ connection: SDKConnectionInterface }>(
            `/sdk-connections`,
            {
              method: "POST",
              body: JSON.stringify(body),
            }
          );
          track("Create SDK Connection", {
            source: "SDKConnectionForm",
            languages: value.languages,
            encryptPayload: value.encryptPayload,
            hashSecureAttributes: value.hashSecureAttributes,
            proxyEnabled: value.proxyEnabled,
          });
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

      {(projects.length > 0 || projectIsDeReferenced) && (
        <SelectField
          label="Project"
          initialOption="All Projects"
          value={form.watch("project") || ""}
          onChange={(project) => form.setValue("project", project)}
          options={projectsOptions}
          sort={false}
          formatOptionLabel={({ value, label }) => {
            if (value === "") {
              return <em>{label}</em>;
            }
            if (value === projectId && projectIsDeReferenced) {
              return (
                <Tooltip
                  body={
                    <>
                      Project <code>{value}</code> not found
                    </>
                  }
                >
                  <span className="text-danger">
                    <FaExclamationTriangle /> <code>{value}</code>
                  </span>
                </Tooltip>
              );
            }
            return label;
          }}
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
              <>
                <div className="mt-3">
                  <Tooltip
                    body={
                      <>
                        <p>
                          In-development visual experiments will be sent to the
                          SDK. We recommend only enabling this for
                          non-production environments.
                        </p>
                        <p className="mb-0">
                          To force into a variation, use a URL query string such
                          as{" "}
                          <code className="d-block">?my-experiment-id=2</code>
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

                <div className="mt-3">
                  <Tooltip
                    body={
                      <>
                        <p>
                          This can help add context when debugging or tracking
                          events.
                        </p>
                        <div>
                          However, this could expose potentially sensitive
                          information to your users if enabled for a client-side
                          or mobile application.
                        </div>
                      </>
                    }
                  >
                    <label htmlFor="sdk-connection-include-experiment-meta">
                      Include experiment/variation names? <FaInfoCircle />
                    </label>
                  </Tooltip>
                  <div>
                    <Toggle
                      id="sdk-connection-include-experiment-meta"
                      value={form.watch("includeExperimentNames")}
                      setValue={(val) =>
                        form.setValue("includeExperimentNames", val)
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {(!hasNoSDKsWithSSESupport || initialValue.sseEnabled) &&
        isCloud() &&
        gb?.isOn("proxy-cloud-sse") && (
          <div className="mt-3 mb-3">
            <label htmlFor="sdk-connection-sseEnabled-toggle">
              <PremiumTooltip
                commercialFeature="cloud-proxy"
                body={
                  <>
                    <p>
                      <BsLightningFill className="text-warning" />
                      <strong>Streaming Updates</strong> allow you to instantly
                      update any subscribed SDKs when you make any feature
                      changes in GrowthBook. For front-end SDKs, active users
                      will see the changes immediately without having to refresh
                      the page.
                    </p>
                    <p>
                      To take advantage of this feature, ensure that you have
                      set{" "}
                      <code className="d-block">
                        {`{`} autoRefresh: true {`}`}
                      </code>
                      in your SDK implementation.
                    </p>
                    <div className="mb-1">
                      The following SDKs currently support real-time updates:
                    </div>
                    {languagesWithSSESupport.map(([k, v], i) => (
                      <span className="nowrap" key={k}>
                        <SDKLanguageLogo
                          language={k as SDKLanguage}
                          size={16}
                        />
                        <span
                          className="ml-1 text-muted font-weight-bold"
                          style={{ verticalAlign: "top" }}
                        >
                          {v.label}
                        </span>
                        {i < languagesWithSSESupport.length - 1 && ", "}
                      </span>
                    ))}

                    <div className="mt-4" style={{ lineHeight: 1.2 }}>
                      <p className="mb-1">
                        <span className="badge badge-purple text-uppercase mr-2">
                          Beta
                        </span>
                        <span className="text-purple">
                          This is an opt-in beta feature.
                        </span>
                      </p>
                      <p className="text-muted small mb-0">
                        While in beta, we cannot guarantee 100% reliability of
                        streaming updates. However, using this feature poses no
                        risk to any other SDK functionality.
                      </p>
                    </div>
                  </>
                }
              >
                Enable Streaming Updates? <FaInfoCircle />{" "}
                <span className="badge badge-purple text-uppercase mr-2">
                  Beta
                </span>
              </PremiumTooltip>
            </label>

            <div className="form-inline">
              <Toggle
                id="sdk-connection-sseEnabled-toggle"
                value={form.watch("sseEnabled")}
                setValue={(val) => form.setValue("sseEnabled", val)}
                disabled={!hasCloudProxyFeature}
              />
            </div>
          </div>
        )}

      {isCloud() && gb?.isOn("proxy-cloud") && (
        <div
          className="d-flex mt-3 mb-3 align-top"
          style={{ justifyContent: "space-between" }}
        >
          <div className="">
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
            <div className="ml-3 d-flex align-items-center">
              <label
                className="mr-2 mt-3 pt-2"
                htmlFor="sdk-connection-proxyHost"
              >
                Proxy Host URL
              </label>
              <Field
                id="sdk-connection-proxyHost"
                required
                placeholder="https://"
                type="url"
                containerClassName="mt-3"
                style={{ width: 400 }}
                {...form.register("proxyHost")}
              />
            </div>
          )}
        </div>
      )}

      <div className="form-group mt-4">
        <label htmlFor="hash-secure-attributes">
          <PremiumTooltip
            commercialFeature="encrypt-features-endpoint"
            body={
              <>
                <p>
                  Feature targeting conditions referencing{" "}
                  <code>secureString</code> attributes will be anonymized via
                  SHA-256 hashing. When evaluating feature flags in a public or
                  insecure environment (such as a browser), hashing provides an
                  additional layer of security through obfuscation. This allows
                  you to target users based on sensitive attributes.
                </p>
                <p className="mb-0 text-warning-orange small">
                  <FaExclamationCircle /> When using an insecure environment, do
                  not rely exclusively on hashing as a means of securing highly
                  sensitive data. Hashing is an obfuscation technique that makes
                  it very difficult, but not impossible, to extract sensitive
                  data.
                </p>
              </>
            }
          >
            Hash secure attributes? <FaInfoCircle />
          </PremiumTooltip>
        </label>
        <div className="row mb-4">
          <div className="col-md-3">
            <Toggle
              id="hash-secure-attributes"
              value={form.watch("hashSecureAttributes")}
              setValue={(val) => form.setValue("hashSecureAttributes", val)}
              disabled={!hasSecureAttributesFeature}
            />
          </div>
          <div
            className="col-md-9 text-gray text-right pt-2"
            style={{ fontSize: 11 }}
          >
            Requires changes to your implementation.{" "}
            <DocLink docSection="hashSecureAttributes">View docs</DocLink>
          </div>
        </div>
      </div>

      <EncryptionToggle
        showUpgradeModal={() => setUpgradeModal(true)}
        value={form.watch("encryptPayload")}
        setValue={(value) => form.setValue("encryptPayload", value)}
        showRequiresChangesWarning={true}
        showUpgradeMessage={false}
      />
      {form.watch("encryptPayload") &&
        selectedLanguagesWithoutEncryptionSupport.length > 0 && (
          <p
            className="mb-0 text-warning-orange small"
            style={{ marginTop: -15 }}
          >
            <FaExclamationCircle /> Payload decryption is not natively supported
            in the selected SDK
            {selectedLanguagesWithoutEncryptionSupport.length === 1 ? "" : "s"}:
            <div className="ml-2 mt-1">
              {selectedLanguagesWithoutEncryptionSupport.map((id, i) => (
                <span className="nowrap" key={id}>
                  <SDKLanguageLogo language={id} size={14} />
                  <span
                    className="text-muted font-weight-bold"
                    style={{ marginLeft: 2, verticalAlign: 3 }}
                  >
                    {languageMapping[id].label}
                  </span>
                  {i < selectedLanguagesWithoutEncryptionSupport.length - 1 &&
                    ", "}
                </span>
              ))}
            </div>
          </p>
        )}
    </Modal>
  );
}
