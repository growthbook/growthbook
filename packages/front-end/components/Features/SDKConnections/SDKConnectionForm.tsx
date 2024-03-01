import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
} from "back-end/types/sdk-connection";
import { useForm } from "react-hook-form";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { FaCheck, FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import clsx from "clsx";
import {
  getConnectionSDKCapabilities,
  getDefaultSDKVersion,
  getLatestSDKVersion,
  getSDKCapabilityVersion,
  getSDKVersions,
  isSDKOutdated,
} from "shared/sdk-versioning";
import { filterProjectsByEnvironment } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Toggle from "@/components/Forms/Toggle";
import { isCloud } from "@/services/env";
import track from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SDKLanguageSelector from "./SDKLanguageSelector";
import { LanguageEnvironment, languageMapping } from "./SDKLanguageLogo";

function getSecurityTabState(
  value: Partial<SDKConnectionInterface>
): "none" | "ciphered" | "remote" {
  if (value.remoteEvalEnabled) return "remote";
  if (
    value.encryptPayload ||
    value.hashSecureAttributes ||
    !value.includeExperimentNames
  )
    return "ciphered";
  return "none";
}

export default function SDKConnectionForm({
  initialValue = {},
  edit,
  close,
  mutate,
  autoCloseOnSubmit = true,
  cta = "Save",
}: {
  initialValue?: Partial<SDKConnectionInterface>;
  edit: boolean;
  close?: () => void;
  mutate: () => void;
  autoCloseOnSubmit?: boolean;
  cta?: string;
}) {
  const environments = useEnvironments();
  const { project, projects, getProjectById } = useDefinitions();
  const projectIds = projects.map((p) => p.id);

  const { apiCall } = useAuth();
  const router = useRouter();

  const { hasCommercialFeature } = useUser();
  const hasEncryptionFeature = hasCommercialFeature(
    "encrypt-features-endpoint"
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes"
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

  const [languageError, setLanguageError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: initialValue.name ?? "",
      languages: initialValue.languages ?? [],
      sdkVersion:
        initialValue.sdkVersion ??
        getDefaultSDKVersion(
          initialValue?.languages?.length === 1
            ? initialValue.languages[0]
            : "other"
        ),
      environment: initialValue.environment ?? environments[0]?.id ?? "",
      projects:
        "projects" in initialValue
          ? initialValue.projects
          : project
          ? [project]
          : [],
      encryptPayload: initialValue.encryptPayload ?? false,
      hashSecureAttributes:
        initialValue.hashSecureAttributes ?? hasSecureAttributesFeature,
      includeVisualExperiments: initialValue.includeVisualExperiments ?? false,
      includeDraftExperiments: initialValue.includeDraftExperiments ?? false,
      includeExperimentNames: initialValue.includeExperimentNames ?? true,
      proxyEnabled: initialValue.proxy?.enabled ?? false,
      proxyHost: initialValue.proxy?.host ?? "",
      remoteEvalEnabled: initialValue.remoteEvalEnabled ?? false,
    },
  });

  const usingLatestVersion = !isSDKOutdated(
    form.watch("languages")?.[0] || "other",
    form.watch("sdkVersion")
  );

  const useLatestSdkVersion = () => {
    const language = form.watch("languages")?.[0] || "other";
    const latest = getLatestSDKVersion(language);
    form.setValue("sdkVersion", latest);
  };

  const languages = form.watch("languages");
  const languageEnvironments: Set<LanguageEnvironment> = new Set(
    languages.map((l) => languageMapping[l].environment)
  );
  const languageEnvironment =
    languageEnvironments.size === 0
      ? "backend" // show the least amount of configuration options if nothing is set
      : languageEnvironments.size === 1
      ? [...languageEnvironments][0]
      : languageEnvironments.has("frontend")
      ? "frontend"
      : languageEnvironments.has("mobile")
      ? "mobile"
      : languageEnvironments.has("backend")
      ? "backend"
      : "hybrid";

  const latestSdkCapabilities = getConnectionSDKCapabilities(
    form.getValues(),
    "max-ver-intersection"
  );
  const currentSdkCapabilities = getConnectionSDKCapabilities(
    form.getValues(),
    "min-ver-intersection"
  );

  const enableRemoteEval =
    hasRemoteEvaluationFeature && !!gb?.isOn("remote-evaluation");

  const showVisualEditorSettings = latestSdkCapabilities.includes(
    "visualEditor"
  );

  const selectedProjects = form.watch("projects");
  const selectedEnvironment = environments.find(
    (e) => e.id === form.watch("environment")
  );
  const environmentHasProjects =
    (selectedEnvironment?.projects?.length ?? 0) > 0;
  const filteredProjectIds = filterProjectsByEnvironment(
    projectIds,
    selectedEnvironment
  );
  const filteredProjects = projects.filter((p) =>
    filteredProjectIds.includes(p.id)
  );

  const projectsOptions = filteredProjects.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  if (initialValue.projects) {
    initialValue.projects.forEach((p) => {
      const name = getProjectById(p);
      if (!name) {
        projectsOptions.push({
          label: "Invalid project",
          value: p,
        });
      }
    });
  }

  useEffect(() => {
    if (languageEnvironment === "backend") {
      setSelectedSecurityTab("none");
    }
  }, [languageEnvironment, setSelectedSecurityTab]);

  useEffect(() => {
    if (!edit) {
      form.setValue("includeVisualExperiments", showVisualEditorSettings);
      form.setValue("includeDraftExperiments", showVisualEditorSettings);
    } else if (!showVisualEditorSettings) {
      form.setValue("includeVisualExperiments", false);
      form.setValue("includeDraftExperiments", false);
    }
  }, [showVisualEditorSettings, form, edit]);

  // complex setter for clicking a "SDK Payload Security" button
  useEffect(() => {
    if (selectedSecurityTab === "none") {
      form.setValue("remoteEvalEnabled", false);
      form.setValue("encryptPayload", false);
      form.setValue("hashSecureAttributes", false);
      form.setValue("includeExperimentNames", true);
    } else if (selectedSecurityTab === "ciphered") {
      const enableEncryption = hasEncryptionFeature;
      const enableSecureAttributes = hasSecureAttributesFeature;
      form.setValue("remoteEvalEnabled", false);
      if (
        !(
          form.watch("encryptPayload") ||
          form.watch("hashSecureAttributes") ||
          !form.watch("includeExperimentNames")
        )
      ) {
        form.setValue("encryptPayload", enableEncryption);
        form.setValue("hashSecureAttributes", enableSecureAttributes);
        form.setValue("includeExperimentNames", false);
      }
    } else if (selectedSecurityTab === "remote") {
      if (!enableRemoteEval) {
        form.setValue("remoteEvalEnabled", false);
        return;
      }
      form.setValue("remoteEvalEnabled", true);
      form.setValue("encryptPayload", false);
      form.setValue("hashSecureAttributes", false);
      form.setValue("includeExperimentNames", true);
    }
  }, [
    selectedSecurityTab,
    form,
    hasEncryptionFeature,
    hasSecureAttributesFeature,
    enableRemoteEval,
  ]);

  useEffect(() => {
    if (languages.length > 0 && languageError) {
      setLanguageError(null);
    }
  }, [languages, languageError, setLanguageError]);

  const projectIdsStr = JSON.stringify(projectIds);
  const selectedProjectsStr = JSON.stringify(selectedProjects);
  useEffect(
    () => {
      if (!selectedEnvironment) return;
      if (!selectedProjects) return;
      form.setValue(
        "projects",
        filterProjectsByEnvironment(selectedProjects, selectedEnvironment)
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectIdsStr, selectedProjectsStr, selectedEnvironment?.id]
  );

  return (
    <Modal
      header={edit ? "Edit SDK Connection" : "New SDK Connection"}
      size={"lg"}
      autoCloseOnSubmit={autoCloseOnSubmit}
      error={form.formState.errors.languages?.message}
      submit={form.handleSubmit(async (value) => {
        // filter for visual experiments
        if (!latestSdkCapabilities.includes("visualEditor")) {
          value.includeVisualExperiments = false;
        }
        if (!value.includeVisualExperiments) {
          value.includeDraftExperiments = false;
        }

        // filter for remote eval
        if (!latestSdkCapabilities.includes("remoteEval")) {
          value.remoteEvalEnabled = false;
        }

        const body: Omit<CreateSDKConnectionParams, "organization"> = {
          ...value,
          projects: value.projects || [],
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
            remoteEvalEnabled: value.remoteEvalEnabled,
            proxyEnabled: value.proxyEnabled,
          });
          mutate();
          if (autoCloseOnSubmit) {
            await router.push(`/sdks/${res.connection.id}`);
          }
        }
      })}
      customValidation={() => {
        // manual validation for languages
        if (languages.length === 0) {
          setLanguageError("Please select an SDK language");
          return false;
        } else {
          setLanguageError(null);
          return true;
        }
      }}
      close={close}
      open={true}
      cta={cta}
    >
      <div className="px-2">
        <Field label="Name" {...form.register("name")} required />

        <div className="form-group">
          <div className="d-flex align-items-center mt-4 mb-2">
            <label className="mb-0">SDK Language</label>
            {languageError ? (
              <span className="ml-3 alert px-1 py-0 mb-0 alert-danger">
                {languageError}
              </span>
            ) : null}
            <div className="flex-1" />
            {form.watch("languages")?.length === 1 &&
              !form.watch("languages")[0].match(/^(other|nocode-.*)$/) && (
                <div className="text-right position-relative">
                  <div className="d-inline-flex align-items-center">
                    <label className="mb-0 mr-2">SDK ver.</label>
                    <SelectField
                      className="text-left"
                      style={{ width: 120 }}
                      placeholder="0.0.0"
                      autoComplete="off"
                      sort={false}
                      options={getSDKVersions(
                        form.watch("languages")[0]
                      ).map((ver) => ({ label: ver, value: ver }))}
                      createable={true}
                      isClearable={false}
                      value={
                        form.watch("sdkVersion") ||
                        getDefaultSDKVersion(languages[0])
                      }
                      onChange={(v) => form.setValue("sdkVersion", v)}
                    />
                  </div>
                  {usingLatestVersion ? (
                    <div
                      className="small position-absolute text-muted"
                      style={{ zIndex: 1, right: 3 }}
                    >
                      Using latest
                    </div>
                  ) : (
                    <a
                      role="button"
                      className="d-block small position-absolute"
                      style={{ zIndex: 1, right: 3 }}
                      onClick={useLatestSdkVersion}
                    >
                      Use latest
                    </a>
                  )}
                </div>
              )}
          </div>
          <SDKLanguageSelector
            value={form.watch("languages")}
            setValue={(languages) => {
              form.setValue("languages", languages);
              if (languages?.length === 1) {
                form.setValue("sdkVersion", getLatestSDKVersion(languages[0]));
              }
            }}
            multiple={false}
            includeOther={true}
          />
        </div>

        <div className="row" style={{ gap: "1.5rem" }}>
          <div className="col">
            <SelectField
              label="Environment"
              required
              placeholder="Choose one..."
              value={form.watch("environment")}
              onChange={(env) => form.setValue("environment", env)}
              options={environments.map((e) => ({ label: e.id, value: e.id }))}
              formatOptionLabel={({ value, label }) => {
                const selectedEnvironment = environments.find(
                  (e) => e.id === value
                );
                const numProjects = selectedEnvironment?.projects?.length ?? 0;
                return (
                  <div className="d-flex align-items-center">
                    <div>{label}</div>
                    <div className="flex-1" />
                    {numProjects > 0 ? (
                      <div className="text-muted small">
                        {numProjects} project{numProjects === 1 ? "" : "s"}
                      </div>
                    ) : (
                      <div className="text-muted small font-italic">
                        All projects
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </div>

          {projectsOptions.length > 0 && (
            <div className="col">
              <MultiSelectField
                label="Filter by Project"
                placeholder={
                  environmentHasProjects
                    ? "All Environment Projects"
                    : "All Projects"
                }
                value={form.watch("projects") || []}
                onChange={(projects) => form.setValue("projects", projects)}
                options={projectsOptions}
                sort={false}
                closeMenuOnSelect={true}
              />
            </div>
          )}
        </div>

        {languageEnvironment !== "backend" && (
          <>
            <label>SDK Payload Security</label>
            <div className="border rounded pt-3 px-3 mb-4 bg-light">
              <ControlledTabs
                newStyle={true}
                className="mb-3"
                buttonsWrapperClassName="sdk-security-button-wrapper mb-3"
                buttonsClassName={(tab) =>
                  clsx("sdk-security-button text-center border rounded", {
                    selected: tab === getSecurityTabState(form.getValues()),
                  })
                }
                tabContentsClassName={(tab) =>
                  tab === "none" ? "d-none" : "noborder"
                }
                setActive={setSelectedSecurityTab}
                active={selectedSecurityTab}
              >
                <Tab
                  id="none"
                  padding={false}
                  className="pt-1 pb-2"
                  display={
                    <>
                      {getSecurityTabState(form.getValues()) === "none" && (
                        <>
                          <FaCheck className="check text-success" />{" "}
                        </>
                      )}
                      Plain Text
                      <Tooltip
                        popperClassName="text-left"
                        body={
                          <p className="mb-0">
                            Full feature definitions, including targeting
                            conditions and experiment variations, are viewable
                            by anyone with the Client Key.
                          </p>
                        }
                      >
                        <div className="subtitle">
                          Highly cacheable, but may leak sensitive info to users
                          <FaInfoCircle className="ml-1" />
                        </div>
                      </Tooltip>
                    </>
                  }
                >
                  <></>
                </Tab>

                {["frontend", "mobile", "hybrid"].includes(
                  languageEnvironment
                ) && (
                  <Tab
                    id="ciphered"
                    padding={false}
                    className="pt-1 pb-2"
                    display={
                      <>
                        {getSecurityTabState(form.getValues()) ===
                          "ciphered" && (
                          <>
                            <FaCheck className="check text-success" />{" "}
                          </>
                        )}
                        Ciphered
                        <Tooltip
                          popperClassName="text-left"
                          body={
                            <p className="mb-0">
                              Full feature definitions are encrypted and
                              sensitive targeting conditions are hashed to help
                              avoid leaking business logic to client-side apps.
                              Not 100% secure, but will stop most prying eyes.
                            </p>
                          }
                        >
                          <div className="subtitle">
                            Adds obfuscation while remaining cacheable
                            <FaInfoCircle className="ml-1" />
                          </div>
                        </Tooltip>
                      </>
                    }
                  >
                    <div className="d-flex">
                      <div className="col-4 px-0">
                        <label htmlFor="encryptSDK">
                          <PremiumTooltip
                            commercialFeature="encrypt-features-endpoint"
                            body={
                              <>
                                <p>
                                  SDK payloads will be encrypted via the AES
                                  encryption algorithm. When evaluating feature
                                  flags in a public or insecure environment
                                  (such as a browser), encryption provides an
                                  additional layer of security through
                                  obfuscation. This allows you to target users
                                  based on sensitive attributes.
                                </p>
                                <p className="mb-0 text-warning-orange small">
                                  <FaExclamationCircle /> When using an insecure
                                  environment, do not rely exclusively on
                                  payload encryption as a means of securing
                                  highly sensitive data. Because the client
                                  performs the decryption, the unencrypted
                                  payload may be extracted with sufficient
                                  effort.
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
                            setValue={(val) =>
                              form.setValue("encryptPayload", val)
                            }
                            disabled={!hasEncryptionFeature}
                          />
                        </div>
                      </div>

                      <div className="col-4 px-0">
                        <label htmlFor="hash-secure-attributes">
                          <PremiumTooltip
                            commercialFeature="hash-secure-attributes"
                            body={
                              <>
                                <p>
                                  Feature targeting conditions referencing{" "}
                                  <code>secureString</code> attributes will be
                                  anonymized via SHA-256 hashing. When
                                  evaluating feature flags in a public or
                                  insecure environment (such as a browser),
                                  hashing provides an additional layer of
                                  security through obfuscation. This allows you
                                  to target users based on sensitive attributes.
                                </p>
                                <p className="mb-0 text-warning-orange small">
                                  <FaExclamationCircle /> When using an insecure
                                  environment, do not rely exclusively on
                                  hashing as a means of securing highly
                                  sensitive data. Hashing is an obfuscation
                                  technique that makes it very difficult, but
                                  not impossible, to extract sensitive data.
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

                      <div className="col-4 px-0">
                        <label htmlFor="sdk-connection-include-experiment-meta">
                          <Tooltip
                            body={
                              <>
                                <p>
                                  Experiment and variation names can help add
                                  context when debugging or tracking events.
                                </p>
                                <p>
                                  However, this could expose potentially
                                  sensitive information to your users if enabled
                                  for a client-side or mobile application.
                                </p>
                                <p>
                                  For maximum privacy and security, we recommend
                                  hiding these fields.
                                </p>
                              </>
                            }
                          >
                            Hide experiment/variation names?{" "}
                            <FaInfoCircle style={{ marginRight: -10 }} />
                          </Tooltip>
                        </label>
                        <div>
                          <Toggle
                            id="sdk-connection-include-experiment-meta"
                            value={!form.watch("includeExperimentNames")}
                            setValue={(val) =>
                              form.setValue("includeExperimentNames", !val)
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {form.watch("encryptPayload") &&
                      !currentSdkCapabilities.includes("encryption") && (
                        <div
                          className="ml-2 mt-3 text-warning-orange"
                          style={{ marginBottom: -5 }}
                        >
                          <FaExclamationCircle /> Payload decryption may not be
                          available in your current SDK.
                          {languages.length === 1 && (
                            <div className="mt-1 text-gray">
                              {getSDKCapabilityVersion(
                                languages[0],
                                "encryption"
                              ) ? (
                                <>
                                  It was introduced in SDK version{" "}
                                  <code>
                                    {getSDKCapabilityVersion(
                                      languages[0],
                                      "encryption"
                                    )}
                                  </code>
                                  . The SDK version specified in this connection
                                  is{" "}
                                  <code>
                                    {form.watch("sdkVersion") ||
                                      getDefaultSDKVersion(languages[0])}
                                  </code>
                                  .
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                  </Tab>
                )}

                {["frontend", "hybrid"].includes(languageEnvironment) && (
                  <Tab
                    id="remote"
                    padding={false}
                    className="pt-1 pb-2"
                    display={
                      <>
                        {getSecurityTabState(form.getValues()) === "remote" && (
                          <>
                            <FaCheck className="check text-success" />{" "}
                          </>
                        )}
                        Remote Evaluated
                        <div
                          className="position-absolute badge badge-purple text-uppercase"
                          style={{ right: 5, top: 5 }}
                        >
                          Beta
                        </div>
                        <Tooltip
                          popperClassName="text-left"
                          body={
                            <>
                              <p className="mb-0">
                                Features and experiments are evaluated on a
                                private server and only the final assigned
                                values are exposed to users.
                              </p>
                              {isCloud() && (
                                <div className="mt-2 text-warning-orange">
                                  <FaExclamationCircle /> Requires a remote
                                  evaluation service such as GrowthBook Proxy or
                                  a CDN edge worker.
                                </div>
                              )}
                            </>
                          }
                        >
                          <div className="subtitle">
                            Completely hides business logic from users
                            <FaInfoCircle className="ml-1" />
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
                                <div className="mb-2">
                                  <strong>Remote Evaluation</strong> fully
                                  secures your SDK by evaluating feature flags
                                  exclusively on a private server instead of
                                  within a front-end environment. This ensures
                                  that any sensitive information within
                                  targeting rules or unused feature variations
                                  are never seen by the client.
                                </div>
                                <div className="mb-2">
                                  Remote evaluation provides the same security
                                  benefits as a includeExperimentNames SDK.
                                  However, remote evaluation is neither needed
                                  nor supported for backend SDKs.
                                </div>
                                <div className="mb-2">
                                  Remote evaluation does come with a few cost
                                  considerations:
                                  <ol className="pl-3 mt-2">
                                    <li className="mb-2">
                                      It will increase network traffic.
                                      Evaluated payloads cannot be shared across
                                      different users; therefore CDN cache
                                      misses will increase.
                                    </li>
                                    <li>
                                      Any connections using Streaming Updates
                                      will incur a slight delay. An additional
                                      network hop is required to retrieve the
                                      evaluated payload from the server.
                                    </li>
                                  </ol>
                                </div>
                                <div
                                  className="mt-4"
                                  style={{ lineHeight: 1.2 }}
                                >
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
                          <div className="col d-flex align-items-center">
                            {gb?.isOn("remote-evaluation") ? (
                              <>
                                <Toggle
                                  id="remote-evaluation"
                                  value={form.watch("remoteEvalEnabled")}
                                  setValue={(val) =>
                                    form.setValue("remoteEvalEnabled", val)
                                  }
                                  disabled={
                                    !hasRemoteEvaluationFeature ||
                                    !latestSdkCapabilities.includes(
                                      "remoteEval"
                                    )
                                  }
                                />
                                {isCloud() ? (
                                  <div className="alert alert-info mb-0 ml-3 py-1 px-2">
                                    <FaExclamationCircle className="mr-1" />
                                    Cloud customers must self-host a remote
                                    evaluation service such as{" "}
                                    <a
                                      target="_blank"
                                      href="https://github.com/growthbook/growthbook-proxy"
                                      rel="noreferrer"
                                    >
                                      GrowthBook Proxy
                                    </a>{" "}
                                    or a CDN edge worker.
                                  </div>
                                ) : null}
                              </>
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
                                <span className="text-muted ml-2">
                                  Coming soon
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    {gb?.isOn("remote-evaluation") &&
                    !currentSdkCapabilities.includes("remoteEval") ? (
                      <div
                        className="ml-2 mt-3 text-warning-orange"
                        style={{ marginBottom: -5 }}
                      >
                        <FaExclamationCircle /> Remote evaluation may not be
                        available in your current SDK.
                        {languages.length === 1 && (
                          <div className="mt-1 text-gray">
                            {getSDKCapabilityVersion(
                              languages[0],
                              "remoteEval"
                            ) ? (
                              <>
                                It was introduced in SDK version{" "}
                                <code>
                                  {getSDKCapabilityVersion(
                                    languages[0],
                                    "remoteEval"
                                  )}
                                </code>
                                . The SDK version specified in this connection
                                is{" "}
                                <code>
                                  {form.watch("sdkVersion") ||
                                    getDefaultSDKVersion(languages[0])}
                                </code>
                                .
                              </>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </Tab>
                )}
              </ControlledTabs>
            </div>
          </>
        )}

        {showVisualEditorSettings && (
          <>
            <label>Visual experiments</label>
            <div className="border rounded pt-2 pb-3 px-3 bg-light">
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
                </>
              )}
            </div>
          </>
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
      </div>
    </Modal>
  );
}
