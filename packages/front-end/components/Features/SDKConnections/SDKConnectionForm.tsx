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
  FaCheck,
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
import UpgradeModal from "@/components/Settings/UpgradeModal";
import Toggle from "@/components/Forms/Toggle";
import { isCloud } from "@/services/env";
import track from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import SDKLanguageSelector from "./SDKLanguageSelector";
import SDKLanguageLogo, { languageMapping } from "./SDKLanguageLogo";

function getSecurityTabState(
  value: Partial<SDKConnectionInterface>
): "none" | "client" | "server" {
  if (value.remoteEvalEnabled) return "server";
  if (value.encryptPayload || value.hashSecureAttributes) return "client";
  return "none";
}

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

  const hasProxy =
    !isCloud() && initialValue?.proxy?.enabled && initialValue?.proxy?.host;

  const hasCloudProxyFeature = hasCommercialFeature("cloud-proxy");
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes"
  );
  const hasEncryptionFeature = hasCommercialFeature(
    "encrypt-features-endpoint"
  );
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");

  useEffect(() => {
    if (edit) return;
    track("View SDK Connection Form");
  }, [edit]);

  const gb = useGrowthBook();

  const [selectedSecurityTab, setSelectedSecurityTab] = useState<string | null>(
    getSecurityTabState(initialValue)
  );
  console.log({ selectedSecurityTab });
  const [upgradeModal, setUpgradeModal] = useState(false);

  const form = useForm({
    defaultValues: {
      name: initialValue.name || "",
      languages: initialValue.languages || [],
      environment: initialValue.environment || environments[0]?.id || "",
      project: "project" in initialValue ? initialValue.project : project || "",
      encryptPayload: initialValue.encryptPayload || false,
      hashSecureAttributes: initialValue.hashSecureAttributes || false,
      includeVisualExperiments: initialValue.includeVisualExperiments || false,
      includeDraftExperiments: initialValue.includeDraftExperiments || false,
      includeExperimentNames: initialValue.includeExperimentNames || false,
      proxyEnabled: initialValue.proxy?.enabled || false,
      proxyHost: initialValue.proxy?.host || "",
      sseEnabled: initialValue.sseEnabled || false,
      remoteEvalEnabled: initialValue.remoteEvalEnabled || false,
    },
  });

  const languages = form.watch("languages");

  const hasSDKsWithoutEncryptionSupport = languages.some(
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

  useEffect(() => {
    if (selectedSecurityTab === "none") {
      form.setValue("remoteEvalEnabled", false);
      form.setValue("encryptPayload", false);
      form.setValue("hashSecureAttributes", false);
    } else if (selectedSecurityTab === "client") {
      const enableEncryption =
        hasEncryptionFeature &&
        languages.length > 0 &&
        !hasSDKsWithoutEncryptionSupport;
      const enableSecureAttributes = hasSecureAttributesFeature;
      form.setValue("remoteEvalEnabled", false);
      form.setValue("encryptPayload", enableEncryption);
      form.setValue("hashSecureAttributes", enableSecureAttributes);
    } else if (selectedSecurityTab === "server") {
      const enableRemoteEval =
        hasRemoteEvaluationFeature && !!gb?.isOn("remote-evaluation");
      form.setValue("remoteEvalEnabled", enableRemoteEval);
      form.setValue("encryptPayload", false);
      form.setValue("hashSecureAttributes", false);
    }
  }, [
    selectedSecurityTab,
    initialValue,
    form,
    languages,
    hasSDKsWithoutEncryptionSupport,
    gb,
    hasEncryptionFeature,
    hasSecureAttributesFeature,
    hasRemoteEvaluationFeature,
  ]);

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
          value.languages.some((l) => !languageMapping[l].supportsRemoteEval)
        ) {
          value.remoteEvalEnabled = false;
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
          project: value.project || "",
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
            hashSecureAttributes: value.hashSecureAttributes,
            remoteEvalEnabled: value.remoteEvalEnabled,
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
      <div className="px-2">
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

        <div className="row">
          {(projects.length > 0 || projectIsDeReferenced) && (
            <div className="col">
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
            </div>
          )}

          <div className="col">
            <SelectField
              label="Environment"
              required
              placeholder="Choose one..."
              value={form.watch("environment")}
              onChange={(env) => form.setValue("environment", env)}
              options={environments.map((e) => ({ label: e.id, value: e.id }))}
            />
          </div>
        </div>

        {(!hasNoSDKsWithSSESupport || initialValue.sseEnabled) &&
          isCloud() &&
          gb?.isOn("proxy-cloud-sse") && (
            <>
              <label>Streaming</label>

              <div className="row border rounded mx-0 mb-3 px-1 pt-2 pb-3">
                <div className="col">
                  <label htmlFor="sdk-connection-sseEnabled-toggle">
                    <PremiumTooltip
                      commercialFeature="cloud-proxy"
                      body={
                        <>
                          <p>
                            <BsLightningFill className="text-warning" />
                            <strong>Streaming Updates</strong> allow you to
                            instantly update any subscribed SDKs when you make
                            any feature changes in GrowthBook. For front-end
                            SDKs, active users will see the changes immediately
                            without having to refresh the page.
                          </p>
                          <p>
                            To take advantage of this feature, ensure that you
                            have set{" "}
                            <code className="d-block">
                              {`{`} autoRefresh: true {`}`}
                            </code>
                            in your SDK implementation.
                          </p>
                          <div className="mb-1">
                            The following SDKs currently support real-time
                            updates:
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
                              While in beta, we cannot guarantee 100%
                              reliability of streaming updates. However, using
                              this feature poses no risk to any other SDK
                              functionality.
                            </p>
                          </div>
                        </>
                      }
                    >
                      Enable streaming updates <FaInfoCircle />{" "}
                      <span className="badge badge-purple text-uppercase mr-2">
                        Beta
                      </span>
                    </PremiumTooltip>
                  </label>
                  <div>
                    <Toggle
                      id="sdk-connection-sseEnabled-toggle"
                      value={form.watch("sseEnabled")}
                      setValue={(val) => form.setValue("sseEnabled", val)}
                      disabled={!hasCloudProxyFeature}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

        {isCloud() && gb?.isOn("proxy-cloud") && (
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

        <label>SDK Payload Security</label>
        <ControlledTabs
          newStyle={true}
          className="mb-3"
          buttonsWrapperClassName="sdk-security-button-wrapper mb-3"
          buttonsClassName="sdk-security-button text-center border rounded"
          tabContentsClassName="border"
          setActive={setSelectedSecurityTab}
          active={selectedSecurityTab}
        >
          <Tab
            id="none"
            padding={false}
            className="px-2 pt-2 pb-3"
            display={
              <>
                {getSecurityTabState(form.getValues()) === "none" && (
                  <>
                    <FaCheck className="text-success" />{" "}
                  </>
                )}
                Plain Text
                <Tooltip
                  popperClassName="text-left"
                  body={
                    <p className="mb-0">
                      Full feature definitions, including targeting conditions
                      and experiment variations, are viewable by anyone with the
                      SDK Key. Best for server-side SDKs.
                    </p>
                  }
                >
                  <div className="subtitle">
                    Extremely fast and cacheable&nbsp;
                    <FaInfoCircle />
                  </div>
                </Tooltip>
              </>
            }
          >
            <div className="text-muted mx-2 mt-2 mb-0">
              <FaExclamationCircle /> No additional security features enabled
              for this SDK connection.
            </div>
          </Tab>

          <Tab
            id="client"
            padding={false}
            className="px-2 pt-2 pb-3"
            display={
              <>
                {getSecurityTabState(form.getValues()) === "client" && (
                  <>
                    <FaCheck className="text-success" />{" "}
                  </>
                )}
                Encrypted
                <Tooltip
                  popperClassName="text-left"
                  body={
                    <p className="mb-0">
                      Full feature definitions are encrypted and sensitive
                      targeting conditions are hashed to help avoid leaking
                      business logic to client-side apps. Not 100% safe, but
                      will stop most prying eyes.
                    </p>
                  }
                >
                  <div className="subtitle">
                    Good mix of performance and security&nbsp;
                    <FaInfoCircle />
                  </div>
                </Tooltip>
              </>
            }
          >
            <div className="d-flex">
              {languages.length > 0 && !hasSDKsWithoutEncryptionSupport && (
                <div className="col-4">
                  <label htmlFor="encryptSDK">
                    <PremiumTooltip
                      commercialFeature="encrypt-features-endpoint"
                      body={
                        <>
                          <p>
                            SDK payloads will be encrypted via the AES
                            encryption algorithm. When evaluating feature flags
                            in a public or insecure environment (such as a
                            browser), encryption provides an additional layer of
                            security through obfuscation. This allows you to
                            target users based on sensitive attributes.
                          </p>
                          <p className="mb-0 text-warning-orange small">
                            <FaExclamationCircle /> When using an insecure
                            environment, do not rely exclusively on payload
                            encryption as a means of securing highly sensitive
                            data. Because the client performs the decryption,
                            the unencrypted payload may be extracted with
                            sufficient effort.
                          </p>
                        </>
                      }
                    >
                      Encrypt SDK payload <FaInfoCircle />
                    </PremiumTooltip>
                  </label>
                  <div>
                    <Toggle
                      id="encryptSDK"
                      value={form.watch("encryptPayload")}
                      setValue={(val) => form.setValue("encryptPayload", val)}
                      disabled={!hasEncryptionFeature}
                    />
                  </div>
                </div>
              )}

              <div className="col-4">
                <label htmlFor="hash-secure-attributes">
                  <PremiumTooltip
                    commercialFeature="hash-secure-attributes"
                    body={
                      <>
                        <p>
                          Feature targeting conditions referencing{" "}
                          <code>secureString</code> attributes will be
                          anonymized via SHA-256 hashing. When evaluating
                          feature flags in a public or insecure environment
                          (such as a browser), hashing provides an additional
                          layer of security through obfuscation. This allows you
                          to target users based on sensitive attributes.
                        </p>
                        <p className="mb-0 text-warning-orange small">
                          <FaExclamationCircle /> When using an insecure
                          environment, do not rely exclusively on hashing as a
                          means of securing highly sensitive data. Hashing is an
                          obfuscation technique that makes it very difficult,
                          but not impossible, to extract sensitive data.
                        </p>
                      </>
                    }
                  >
                    Hash secure attributes <FaInfoCircle />
                  </PremiumTooltip>
                </label>
                <div>
                  <Toggle
                    id="hash-secure-attributes"
                    value={form.watch("hashSecureAttributes")}
                    setValue={(val) =>
                      form.setValue("hashSecureAttributes", val)
                    }
                    disabled={!hasSecureAttributesFeature}
                  />
                </div>
              </div>
            </div>
          </Tab>

          <Tab
            id="server"
            padding={false}
            className="px-2 pt-2 pb-3"
            display={
              <>
                {getSecurityTabState(form.getValues()) === "server" && (
                  <>
                    <FaCheck className="text-success" />{" "}
                  </>
                )}
                Remote Evaluated
                <Tooltip
                  popperClassName="text-left"
                  body={
                    <>
                      <p className="mb-0">
                        Features and experiments are evaluated on{" "}
                        {isCloud()
                          ? "our Cloud CDN"
                          : "your GrowthBook Proxy server"}{" "}
                        and only the final assigned values are exposed to users.
                      </p>
                      {!hasProxy && (
                        <div className="mt-2 text-warning-orange">
                          <FaExclamationCircle /> Requires a GrowthBook Proxy
                          server to be configured for self-hosted users
                        </div>
                      )}
                    </>
                  }
                >
                  <div className="subtitle">
                    Completely hides business logic from users&nbsp;
                    <FaInfoCircle />
                  </div>
                </Tooltip>
              </>
            }
          >
            <div className="d-flex">
              <div className="col">
                <label htmlFor="remote-evaluation">
                  <PremiumTooltip
                    commercialFeature="remote-evaluation"
                    tipMinWidth="600px"
                    body={
                      <>
                        <p>
                          <strong>Remote Evaluation</strong> fully secures your
                          SDK by evaluating feature flags exclusively on a
                          private server instead of within a front-end
                          environment. This ensures that any sensitive
                          information within targeting rules or unused feature
                          variations are never seen by the client. When used in
                          a front-end context, server side evaluation provides
                          the same benefits as a backend SDK. However, this
                          feature is not needed nor recommended for backend
                          contexts.
                        </p>
                        <p>
                          Remote evaluation does come with a few cost
                          considerations:
                          <ol className="pl-3 mt-2">
                            <li className="mb-2">
                              It will increase network traffic. Evaluated
                              payloads cannot be shared across different users;
                              therefore CDN cache misses will increase.
                            </li>
                            <li>
                              Connections using instant feature deployments
                              through{" "}
                              <strong>
                                {isCloud()
                                  ? "Streaming Updates"
                                  : "GrowthBook Proxy"}
                              </strong>{" "}
                              will incur a slight delay. An additional network
                              hop is required to retrieve the evaluated payload
                              from the server.
                            </li>
                          </ol>
                        </p>
                        <div className="mt-4" style={{ lineHeight: 1.2 }}>
                          <p className="mb-0">
                            <span className="badge badge-purple text-uppercase mr-2">
                              Beta
                            </span>
                            <span className="text-purple">
                              This is an opt-in beta feature.
                            </span>
                          </p>
                        </div>
                      </>
                    }
                  >
                    Use remote evaluation <FaInfoCircle />{" "}
                    <span className="badge badge-purple text-uppercase mr-2">
                      Beta
                    </span>
                  </PremiumTooltip>
                </label>
                <div className="row">
                  <div className="col">
                    {/*todo: enable remote eval for cloud once CDN is ready*/}
                    {gb?.isOn("remote-evaluation") && !isCloud() ? (
                      <Toggle
                        id="remote-evaluation"
                        value={form.watch("remoteEvalEnabled")}
                        setValue={(val) =>
                          form.setValue("remoteEvalEnabled", val)
                        }
                        disabled={
                          !hasRemoteEvaluationFeature ||
                          (!isCloud() && !hasProxy)
                        }
                      />
                    ) : (
                      <>
                        <Toggle
                          id="remote-evaluation"
                          value={false}
                          disabled={true}
                          setValue={() => {
                            return;
                          }}
                        />
                        <span className="text-muted ml-2">Coming soon...</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Tab>
        </ControlledTabs>

        {!hasNoSDKsWithVisualExperimentSupport && (
          <>
            <label>Visual Experiments</label>
            <div className="row border rounded mx-0 mb-3 px-1 pt-2 pb-3">
              <div className="col-4">
                <label htmlFor="sdk-connection-visual-experiments-toggle">
                  <PremiumTooltip
                    commercialFeature="visual-editor"
                    body={
                      <>
                        <p>
                          <strong>Visual Experiments</strong> allow you to make
                          front-end changes to your site without deploying code
                          by using the Visual Editor.
                        </p>
                        <p className="mb-0">
                          Front-end SDK environments that support these visual
                          experiments should enable this option.
                        </p>
                      </>
                    }
                  >
                    Include visual experiments <FaInfoCircle />
                  </PremiumTooltip>
                </label>
                <div>
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
                  <div className="col-4">
                    <Tooltip
                      body={
                        <>
                          <p>
                            In-development visual experiments will be sent to
                            the SDK. We recommend only enabling this for
                            non-production environments.
                          </p>
                          <p className="mb-0">
                            To force into a variation, use a URL query string
                            such as{" "}
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

                  <div className="col-4">
                    <Tooltip
                      body={
                        <>
                          <p>
                            Normally, experiment and variation names will be
                            removed from the payload. Enabling this keeps the
                            names in the payload. This can help add context when
                            debugging or tracking events.
                          </p>
                          <div>
                            However, this could expose potentially sensitive
                            information to your users if enabled for a
                            client-side or mobile application.
                          </div>
                        </>
                      }
                    >
                      <label htmlFor="sdk-connection-include-experiment-meta">
                        Include experiment names <FaInfoCircle />
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
      </div>
    </Modal>
  );
}
