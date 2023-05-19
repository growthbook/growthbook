import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
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
  const hasServerSideEvaluationFeature = hasCommercialFeature(
    "server-side-evaluation"
  );

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
      includeExperimentNames: initialValue.includeExperimentNames || false,
      proxyEnabled: initialValue.proxy?.enabled || false,
      proxyHost: initialValue.proxy?.host || "",
      sseEnabled: initialValue.sseEnabled || false,
      ssEvalEnabled: initialValue.ssEvalEnabled || false,
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
  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
  const projectName = getProjectById(projectId)?.name || null;
  const projectIsOprhaned = projectId && !projectName;
  if (projectIsOprhaned) {
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

        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ name: string; languages: SDKLanguage[]; en... Remove this comment to see the full error message
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

      <div className="row">
        {(projects.length > 0 || projectIsOprhaned) && (
          <div className="col">
            <SelectField
              label="Project"
              initialOption="All Projects"
              // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
              value={form.watch("project")}
              onChange={(project) => form.setValue("project", project)}
              options={projectsOptions}
              sort={false}
              formatOptionLabel={({ value, label }) => {
                if (value === "") {
                  return <em>{label}</em>;
                }
                if (value === projectId && projectIsOprhaned) {
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

      {!hasNoSDKsWithVisualExperimentSupport && (
        <>
          <label>
            <PremiumTooltip
              commercialFeature="visual-editor"
              body={
                <>
                  <p>
                    <strong>Visual Experiments</strong> allow you to make
                    front-end changes to your site without deploying code by
                    using the Visual Editor.
                  </p>
                  <p className="mb-0">
                    Front-end SDK environments that support these visual
                    experiments should enable this option.
                  </p>
                </>
              }
            >
              Visual Experiments <FaInfoCircle />
            </PremiumTooltip>
          </label>
          <div className="row border rounded mx-0 px-1 pt-2 pb-3">
            <div className="col">
              <label htmlFor="sdk-connection-visual-experiments-toggle">
                Include visual experiments?
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
                <div className="col">
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

                <div className="col">
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
                          information to your users if enabled for a client-side
                          or mobile application.
                        </div>
                      </>
                    }
                  >
                    <label htmlFor="sdk-connection-include-experiment-meta">
                      Include experiment names? <FaInfoCircle />
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
        !isCloud() &&
        // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
        gb.isOn("proxy-cloud-sse") && (
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

      {/*todo: deprecate this in favor of sseEnabled switch?*/}
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

      {gb?.isOn("server-side-evaluation") && (
        <div className="form-group mt-4">
          <label htmlFor="server-side-evaluation">
            <PremiumTooltip
              commercialFeature="server-side-evaluation"
              tipMinWidth="600px"
              body={
                <>
                  <p>
                    <strong>Server Side Evaluation</strong> fully secures your
                    SDK by evaluating feature flags exclusively on a private
                    server instead of within a front-end environment. This
                    ensures that any sensitive information within targeting
                    rules or unused feature variations are never seen by the
                    client. When used in a front-end context, server side
                    evaluation provides the same benefits as a backend SDK.
                    However, this feature is not needed nor recommended for
                    backend contexts.
                  </p>
                  <p>
                    Server side evaluation does come with a few cost
                    considerations:
                    <ol className="pl-3 mt-2">
                      <li className="mb-2">
                        It will increase network traffic. Evaluated payloads
                        cannot be shared across different users; therefore CDN
                        cache misses will increase.
                      </li>
                      <li>
                        Connections using instant feature deployments through{" "}
                        <strong>
                          {isCloud() ? "Streaming Updates" : "GrowthBook Proxy"}
                        </strong>{" "}
                        will incur a slight delay. An additional network hop is
                        required to retrieve the evaluated payload from the
                        server.
                      </li>
                    </ol>
                  </p>
                  <p className="text-warning-orange">
                    <FaExclamationCircle /> Neither <strong>Encryption</strong>{" "}
                    nor <strong>Secure Attribute Hashing</strong> may be used in
                    conjunction with <strong>Server Side Evaluation</strong>.
                    However, these features are not needed as the SDK will never
                    receive sensitive information.
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
              Use Server Side Evaluation? <FaInfoCircle />{" "}
              <span className="badge badge-purple text-uppercase mr-2">
                Beta
              </span>
            </PremiumTooltip>
          </label>
          <div className="row mb-4">
            <div className="col-md-3">
              <Toggle
                id="server-side-evaluation"
                value={form.watch("ssEvalEnabled")}
                setValue={(val) => form.setValue("ssEvalEnabled", val)}
                disabled={!hasServerSideEvaluationFeature}
              />
            </div>
          </div>
        </div>
      )}

      {languages.length > 0 &&
        !hasSDKsWithoutEncryptionSupport &&
        !form.watch("ssEvalEnabled") && (
          <EncryptionToggle
            showUpgradeModal={() => setUpgradeModal(true)}
            value={form.watch("encryptPayload")}
            setValue={(value) => form.setValue("encryptPayload", value)}
            showRequiresChangesWarning={edit}
            showUpgradeMessage={false}
          />
        )}
    </Modal>
  );
}
