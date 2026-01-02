import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { useForm } from "react-hook-form";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import {
  FaCheck,
  FaExclamationCircle,
  FaExclamationTriangle,
  FaInfoCircle,
} from "react-icons/fa";
import clsx from "clsx";
import {
  getConnectionSDKCapabilities,
  getDefaultSDKVersion,
  getLatestSDKVersion,
  getSDKCapabilityVersion,
  getSDKVersions,
  isSDKOutdated,
} from "shared/sdk-versioning";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import { PiPackage } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { isCloud } from "@/services/env";
import track from "@/services/track";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import Checkbox from "@/ui/Checkbox";
import SDKLanguageSelector from "./SDKLanguageSelector";
import {
  LanguageType,
  languageMapping,
  LanguageFilter,
  getConnectionLanguageFilter,
  getPackageRepositoryName,
} from "./SDKLanguageLogo";

function shouldShowPayloadSecurity(
  languageType: LanguageType,
  languages: SDKLanguage[],
): boolean {
  // Next.js should always use plain text
  if (languages.includes("nextjs")) return false;

  // all languages support encryption and secure attributes.
  return true;
}

function getSecurityTabState(
  value: Partial<SDKConnectionInterface>,
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
  const permissionsUtil = usePermissionsUtil();
  const hasEncryptionFeature = hasCommercialFeature(
    "encrypt-features-endpoint",
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes",
  );
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");

  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  useEffect(() => {
    if (edit) return;
    track("View SDK Connection Form");
  }, [edit]);

  const [selectedSecurityTab, setSelectedSecurityTab] = useState<string | null>(
    getSecurityTabState(initialValue),
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
            : "other",
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
      includeRedirectExperiments:
        initialValue.includeRedirectExperiments ?? false,
      includeRuleIds: initialValue.includeRuleIds ?? false,
      proxyEnabled: initialValue.proxy?.enabled ?? false,
      proxyHost: initialValue.proxy?.host ?? "",
      remoteEvalEnabled: initialValue.remoteEvalEnabled ?? false,
      savedGroupReferencesEnabled:
        initialValue.savedGroupReferencesEnabled ?? false,
    },
  });

  const usingLatestVersion = !isSDKOutdated(
    form.watch("languages")?.[0] || "other",
    form.watch("sdkVersion"),
  );

  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter(initialValue.languages ?? []),
  );

  const useLatestSdkVersion = () => {
    const language = form.watch("languages")?.[0] || "other";
    const latest = getLatestSDKVersion(language);
    form.setValue("sdkVersion", latest);
  };

  const languages = form.watch("languages");
  const languageTypes: Set<LanguageType> = new Set(
    languages.map((l) => languageMapping[l].type),
  );
  const languageType =
    languageTypes.size === 0
      ? "backend" // show the least amount of configuration options if nothing is set
      : languageTypes.size === 1
        ? [...languageTypes][0]
        : languageTypes.has("frontend")
          ? "frontend"
          : languageTypes.has("backend")
            ? "backend"
            : languageTypes.has("mobile")
              ? "mobile"
              : languageTypes.has("nocode")
                ? "mobile"
                : languageTypes.has("edge")
                  ? "edge"
                  : "other";

  const latestSdkCapabilities = getConnectionSDKCapabilities(
    form.getValues(),
    "max-ver-intersection",
  );
  const currentSdkCapabilities = getConnectionSDKCapabilities(
    form.getValues(),
    "min-ver-intersection",
  );
  const showVisualEditorSettings =
    latestSdkCapabilities.includes("visualEditor");
  const showRedirectSettings = latestSdkCapabilities.includes("redirects");
  const showEncryption = currentSdkCapabilities.includes("encryption");
  const showRemoteEval = currentSdkCapabilities.includes("remoteEval");

  const showSavedGroupSettings = useMemo(
    () => currentSdkCapabilities.includes("savedGroupReferences"),
    [currentSdkCapabilities],
  );

  useEffect(() => {
    if (!showSavedGroupSettings) {
      form.setValue("savedGroupReferencesEnabled", false);
    }
  }, [showSavedGroupSettings, form]);

  const selectedProjects = form.watch("projects");
  const selectedEnvironment = environments.find(
    (e) => e.id === form.watch("environment"),
  );
  const environmentHasProjects =
    (selectedEnvironment?.projects?.length ?? 0) > 0;
  const filteredProjectIds = filterProjectsByEnvironment(
    projectIds,
    selectedEnvironment,
  );
  const filteredProjects = projects.filter((p) =>
    filteredProjectIds.includes(p.id),
  );

  const disallowedProjects = getDisallowedProjects(
    projects,
    selectedProjects ?? [],
    selectedEnvironment,
  );

  const permissionRequired = (project: string) => {
    return edit
      ? permissionsUtil.canUpdateSDKConnection(
          { projects: [project], environment: form.watch("environment") },
          {},
        )
      : permissionsUtil.canCreateSDKConnection({
          projects: [project],
          environment: form.watch("environment"),
        });
  };

  const projectsOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || [],
    [...filteredProjects, ...disallowedProjects],
  );
  const selectedValidProjects = selectedProjects?.filter((p) => {
    return disallowedProjects?.find((dp) => dp.id === p) === undefined;
  });

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
    if (!shouldShowPayloadSecurity(languageType, languages)) {
      setSelectedSecurityTab("none");
    }
  }, [languageType, languages, setSelectedSecurityTab]);

  useEffect(() => {
    if (!edit) {
      form.setValue("includeVisualExperiments", showVisualEditorSettings);
      form.setValue("includeDraftExperiments", showVisualEditorSettings);
      form.setValue("includeRedirectExperiments", showRedirectSettings);
    } else {
      if (!showVisualEditorSettings) {
        form.setValue("includeVisualExperiments", false);
      }
      if (!showRedirectSettings) {
        form.setValue("includeRedirectExperiments", false);
      }
      if (!showVisualEditorSettings && !showRedirectSettings) {
        form.setValue("includeDraftExperiments", false);
      }
    }
  }, [showVisualEditorSettings, form, edit, showRedirectSettings]);

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
      if (!hasRemoteEvaluationFeature) {
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
    hasRemoteEvaluationFeature,
  ]);

  useEffect(() => {
    if (languages.length > 0 && languageError) {
      setLanguageError(null);
    }
  }, [languages, languageError, setLanguageError]);

  // If the SDK Connection is externally managed, filter the environments that are in 'All Projects' or where the current project is included
  const filteredEnvironments =
    initialValue.managedBy?.type === "vercel"
      ? environments.filter((e) => {
          if (!e.projects?.length) {
            return true;
          }
          if (
            initialValue.projects?.[0] &&
            e.projects?.includes(initialValue.projects?.[0])
          ) {
            return true;
          }
        })
      : environments;

  return (
    <Modal
      trackingEventModalType=""
      header={edit ? "Edit SDK Connection" : "New SDK Connection"}
      size={"lg"}
      autoCloseOnSubmit={autoCloseOnSubmit}
      error={form.formState.errors.languages?.message}
      submit={form.handleSubmit(async (value) => {
        // filter for visual experiments
        if (!latestSdkCapabilities.includes("visualEditor")) {
          value.includeVisualExperiments = false;
        }
        if (!latestSdkCapabilities.includes("redirects")) {
          value.includeRedirectExperiments = false;
        }
        if (
          !value.includeVisualExperiments &&
          !value.includeRedirectExperiments
        ) {
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
            },
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
      <div className="px-2 pb-2">
        <Field label="Name" {...form.register("name")} required />

        <div className="mb-4">
          <div className="form-group">
            <label>SDK Language</label>
            {languageError ? (
              <span className="ml-3 alert px-1 py-0 mb-0 alert-danger">
                {languageError}
              </span>
            ) : null}
            <SDKLanguageSelector
              value={form.watch("languages")}
              setValue={(languages) => {
                form.setValue("languages", languages);
                if (languages?.length === 1) {
                  form.setValue(
                    "sdkVersion",
                    getLatestSDKVersion(languages[0]),
                  );
                }
              }}
              languageFilter={languageFilter}
              setLanguageFilter={setLanguageFilter}
              multiple={form.watch("languages").length > 1}
              includeOther={true}
              skipLabel={form.watch("languages").length <= 1}
              hideShowAllLanguages={true}
            />
          </div>

          {form.watch("languages")?.length === 1 &&
            !form.watch("languages")[0].match(/^(other|nocode-.*)$/) && (
              <div className="form-group" style={{ marginTop: -10 }}>
                <label>SDK version</label>
                <div className="d-flex align-items-center">
                  <div>
                    <SelectField
                      style={{ width: 180 }}
                      className="mr-4"
                      placeholder="0.0.0"
                      autoComplete="off"
                      sort={false}
                      options={getSDKVersions(form.watch("languages")[0]).map(
                        (ver) => ({ label: ver, value: ver }),
                      )}
                      createable={true}
                      isClearable={false}
                      value={
                        form.watch("sdkVersion") ||
                        getDefaultSDKVersion(languages[0])
                      }
                      onChange={(v) => form.setValue("sdkVersion", v)}
                      formatOptionLabel={({ value, label }) => {
                        const latest = getLatestSDKVersion(
                          form.watch("languages")[0],
                        );
                        return (
                          <span>
                            {label}
                            {value === latest && (
                              <span
                                className="text-muted uppercase-title float-right position-relative"
                                style={{ top: 3 }}
                              >
                                latest
                              </span>
                            )}
                          </span>
                        );
                      }}
                    />
                    {!usingLatestVersion && (
                      <a
                        role="button"
                        className="small"
                        onClick={useLatestSdkVersion}
                      >
                        Use latest
                      </a>
                    )}
                  </div>
                  {languageMapping[form.watch("languages")[0]]?.packageUrl && (
                    <div className="ml-3">
                      <a
                        href={
                          languageMapping[form.watch("languages")[0]].packageUrl
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm"
                      >
                        <PiPackage
                          className="mr-1"
                          style={{ fontSize: "1.2em", verticalAlign: "-0.2em" }}
                        />
                        {getPackageRepositoryName(
                          languageMapping[form.watch("languages")[0]]
                            .packageUrl || "",
                        )}
                      </a>
                      <code
                        className="d-block text-muted"
                        style={{ fontSize: "0.7rem" }}
                      >
                        {
                          languageMapping[form.watch("languages")[0]]
                            .packageName
                        }
                      </code>
                    </div>
                  )}
                </div>
              </div>
            )}
        </div>

        <div className="mb-4">
          <SelectField
            label="Environment"
            required
            placeholder="Choose one..."
            value={form.watch("environment")}
            onChange={(env) => {
              form.setValue("environment", env);
              // Only reset projects when environment changes if the SDK Connection is not externally managed by vercel
              if (initialValue.managedBy?.type !== "vercel") {
                form.setValue("projects", []);
              }
            }}
            options={filteredEnvironments.map((e) => ({
              label: e.id,
              value: e.id,
            }))}
            sort={false}
            formatOptionLabel={({ value, label }) => {
              const selectedEnvironment = environments.find(
                (e) => e.id === value,
              );
              const numProjects = selectedEnvironment?.projects?.length ?? 0;
              return (
                <div className="d-flex align-items-center">
                  <div>{label}</div>
                  <div className="flex-1" />
                  {numProjects > 0 ? (
                    <div className="text-muted small">
                      Includes {numProjects} project
                      {numProjects === 1 ? "" : "s"}
                    </div>
                  ) : (
                    <div className="text-muted small font-italic">
                      Includes all projects
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>

        <div className="mb-4">
          <label>
            Filter by Projects{" "}
            <Tooltip
              body={`The dropdown below has been filtered to only include projects where you have permission to ${
                edit ? "update" : "create"
              } SDK Connections.`}
            />
            {!!selectedProjects?.length && (
              <> ({selectedValidProjects?.length ?? 0})</>
            )}
          </label>
          <MultiSelectField
            placeholder={
              environmentHasProjects
                ? "All Environment Projects"
                : "All Projects"
            }
            containerClassName="w-100"
            value={form.watch("projects") || []}
            onChange={(projects) => form.setValue("projects", projects)}
            disabled={initialValue.managedBy?.type === "vercel"}
            options={projectsOptions}
            sort={false}
            closeMenuOnSelect={true}
            formatOptionLabel={({ value, label }) => {
              const disallowed = disallowedProjects?.find(
                (p) => p.id === value,
              );
              return disallowed ? (
                <Tooltip body="This project is not allowed in the selected environment and will not be included in the SDK payload.">
                  <del className="text-danger">
                    <FaExclamationTriangle className="mr-1" />
                    {label}
                  </del>
                </Tooltip>
              ) : (
                label
              );
            }}
          />
          {disallowedProjects.length > 0 && (
            <div className="text-danger mt-2 small px-1">
              <FaExclamationTriangle className="mr-1" />
              This SDK Connection references {disallowedProjects.length} project
              {disallowedProjects.length !== 1 && "s"} that{" "}
              {disallowedProjects.length === 1 ? "is" : "are"} not allowed in
              the selected environment. This may have occurred as a result of a
              project being removed from the selected environment.
            </div>
          )}
        </div>

        {shouldShowPayloadSecurity(languageType, languages) && (
          <>
            <label>SDK Payload Security</label>
            <div className="bg-highlight rounded pt-4 pb-2 px-4 mb-4">
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

                {shouldShowPayloadSecurity(languageType, languages) && (
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
                    <div className="p-3">
                      <label className="mb-3">Cipher Options</label>
                      {showEncryption && (
                        <div className="mb-2 d-flex align-items-center">
                          <Checkbox
                            value={form.watch("encryptPayload")}
                            setValue={(val) =>
                              form.setValue("encryptPayload", val)
                            }
                            disabled={!hasEncryptionFeature}
                            label={
                              <PremiumTooltip
                                commercialFeature="encrypt-features-endpoint"
                                body={
                                  <>
                                    <p>
                                      SDK payloads will be encrypted via the AES
                                      encryption algorithm. When evaluating
                                      feature flags in a public or insecure
                                      environment (such as a browser),
                                      encryption provides an additional layer of
                                      security through obfuscation. This allows
                                      you to target users based on sensitive
                                      attributes.
                                    </p>
                                    <p className="mb-0 text-warning-orange small">
                                      <FaExclamationCircle /> When using an
                                      insecure environment, do not rely
                                      exclusively on payload encryption as a
                                      means of securing highly sensitive data.
                                      Because the client performs the
                                      decryption, the unencrypted payload may be
                                      extracted with sufficient effort.
                                    </p>
                                  </>
                                }
                              >
                                Encrypt SDK payload <FaInfoCircle />
                              </PremiumTooltip>
                            }
                          />
                        </div>
                      )}

                      <div className="mb-2 d-flex align-items-center">
                        <Checkbox
                          value={form.watch("hashSecureAttributes")}
                          setValue={(val) =>
                            form.setValue("hashSecureAttributes", val)
                          }
                          disabled={!hasSecureAttributesFeature}
                          label={
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
                                    security through obfuscation. This allows
                                    you to target users based on sensitive
                                    attributes.
                                  </p>
                                  <p className="mb-0 text-warning-orange small">
                                    <FaExclamationCircle /> When using an
                                    insecure environment, do not rely
                                    exclusively on hashing as a means of
                                    securing highly sensitive data. Hashing is
                                    an obfuscation technique that makes it very
                                    difficult, but not impossible, to extract
                                    sensitive data.
                                  </p>
                                </>
                              }
                            >
                              Hash secure attributes <FaInfoCircle />
                            </PremiumTooltip>
                          }
                        />
                      </div>

                      <div className="d-flex align-items-center">
                        <Checkbox
                          value={!form.watch("includeExperimentNames")}
                          setValue={(val) =>
                            form.setValue("includeExperimentNames", !val)
                          }
                          label={
                            <Tooltip
                              body={
                                <>
                                  <p>
                                    Experiment and variation names can help add
                                    context when debugging or tracking events.
                                  </p>
                                  <p>
                                    However, this could expose potentially
                                    sensitive information to your users if
                                    enabled for a client-side or mobile
                                    application.
                                  </p>
                                  <p className="mb-0">
                                    For maximum privacy and security, we
                                    recommend hiding these fields.
                                  </p>
                                </>
                              }
                            >
                              Hide experiment and variation names{" "}
                              <FaInfoCircle />
                            </Tooltip>
                          }
                        />
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
                                "encryption",
                              ) ? (
                                <>
                                  It was introduced in SDK version{" "}
                                  <code>
                                    {getSDKCapabilityVersion(
                                      languages[0],
                                      "encryption",
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

                {showRemoteEval && (
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
                    <div className="px-3 pb-3">
                      <label className="mb-3">Remote Evaluation Options</label>
                      <div className="d-flex align-items-center">
                        <Checkbox
                          value={form.watch("remoteEvalEnabled")}
                          setValue={(val) =>
                            form.setValue("remoteEvalEnabled", val)
                          }
                          disabled={
                            !hasRemoteEvaluationFeature ||
                            !latestSdkCapabilities.includes("remoteEval")
                          }
                          label={
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
                                        Evaluated payloads cannot be shared
                                        across different users; therefore CDN
                                        cache misses will increase.
                                      </li>
                                      <li>
                                        Any connections using Streaming Updates
                                        will incur a slight delay. An additional
                                        network hop is required to retrieve the
                                        evaluated payload from the server.
                                      </li>
                                    </ol>
                                  </div>
                                </>
                              }
                            >
                              Use remote evaluation <FaInfoCircle />
                            </PremiumTooltip>
                          }
                        />
                      </div>
                      {isCloud() ? (
                        <div className="alert alert-info mb-0 mt-3 py-1 px-2 d-flex flex-row">
                          <div className="pr-2">
                            <FaExclamationCircle className="mr-1" />
                          </div>
                          <div>
                            Cloud customers must self-host a remote evaluation
                            service such as{" "}
                            <a
                              target="_blank"
                              href="https://github.com/growthbook/growthbook-proxy"
                              rel="noreferrer"
                            >
                              GrowthBook Proxy
                            </a>{" "}
                            or a CDN edge worker.
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {!currentSdkCapabilities.includes("remoteEval") ? (
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
                              "remoteEval",
                            ) ? (
                              <>
                                It was introduced in SDK version{" "}
                                <code>
                                  {getSDKCapabilityVersion(
                                    languages[0],
                                    "remoteEval",
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

        {(showVisualEditorSettings || showRedirectSettings) && (
          <div className="mt-5">
            <label>Auto Experiments</label>
            <div className="mt-2">
              {showVisualEditorSettings && (
                <div className="mb-2 d-flex align-items-center">
                  <Checkbox
                    value={form.watch("includeVisualExperiments")}
                    setValue={(val) =>
                      form.setValue("includeVisualExperiments", val)
                    }
                    label={
                      <>
                        Enable <strong>Visual Editor experiments</strong> (
                        <DocLink docSection="visual_editor">docs</DocLink>)
                      </>
                    }
                  />
                </div>
              )}

              {showRedirectSettings && (
                <div className="mb-2 d-flex align-items-center">
                  <Checkbox
                    value={form.watch("includeRedirectExperiments")}
                    setValue={(val) =>
                      form.setValue("includeRedirectExperiments", val)
                    }
                    label={
                      <>
                        Enable <strong>URL Redirect experiments</strong> (
                        <DocLink docSection="url_redirects">docs</DocLink>)
                      </>
                    }
                  />
                </div>
              )}

              {(form.watch("includeVisualExperiments") ||
                form.watch("includeRedirectExperiments")) && (
                <>
                  <div className="mb-2 d-flex align-items-center">
                    <Checkbox
                      value={form.watch("includeDraftExperiments")}
                      setValue={(val) =>
                        form.setValue("includeDraftExperiments", val)
                      }
                      label={
                        <Tooltip
                          body={
                            <>
                              <p>
                                In-development auto experiments will be sent to
                                the SDK. We recommend only enabling this for
                                non-production environments.
                              </p>
                              <p className="mb-0">
                                To force into a variation, use a URL query
                                string such as{" "}
                                <code className="d-block">
                                  ?my-experiment-id=2
                                </code>
                              </p>
                            </>
                          }
                        >
                          <label
                            className="mb-0 cursor-pointer"
                            htmlFor="sdk-connection-include-draft-experiments-toggle"
                          >
                            Include draft experiments <FaInfoCircle />
                          </label>
                        </Tooltip>
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {isCloud() && (
          <div className="mt-5">
            <label className="mb-1">GrowthBook Proxy</label>
            <div className="mt-2">
              <div className="d-flex align-items-center">
                <Checkbox
                  value={form.watch("proxyEnabled")}
                  setValue={(val) => form.setValue("proxyEnabled", val)}
                  label="Use GrowthBook Proxy"
                />
              </div>
              {form.watch("proxyEnabled") && (
                <Field
                  id="sdk-connection-proxyHost"
                  containerClassName="mt-3"
                  label={
                    <>
                      Proxy Host URL <small>(optional)</small>
                      <Tooltip
                        className="ml-1"
                        body={
                          <>
                            <p>
                              Optionally add your proxy&apos;s public URL to
                              enable faster rollouts. Providing your proxy host
                              will allow GrowthBook to push updates to your
                              proxy whenever feature definitions change.
                            </p>
                            <p className="mb-0">
                              Without GrowthBook&apos;s push updates, the proxy
                              will fall back to a stale-while-revalidate caching
                              strategy.
                            </p>
                          </>
                        }
                      >
                        <FaInfoCircle />
                      </Tooltip>
                    </>
                  }
                  placeholder="https://"
                  type="url"
                  {...form.register("proxyHost")}
                />
              )}
            </div>
          </div>
        )}
        {showSavedGroupSettings && (
          <div className="mt-4">
            <label>Saved Groups</label>
            <div className="mt-2">
              <div className="mb-2 d-flex align-items-center">
                <Checkbox
                  value={form.watch("savedGroupReferencesEnabled")}
                  setValue={(val) =>
                    form.setValue("savedGroupReferencesEnabled", val)
                  }
                  disabled={!hasLargeSavedGroupFeature}
                  label={
                    <PremiumTooltip
                      commercialFeature="large-saved-groups"
                      body={
                        <>
                          <p>
                            Reduce the size of your payload by moving ID List
                            Saved Groups from inline evaluation to a separate
                            key in the payload json. Re-using an ID List in
                            multiple features or experiments will no longer
                            meaningfully increase the size of your payload.
                          </p>
                          <p>
                            This feature is not supported by old SDK versions.
                            Ensure that your SDK implementation is up to date
                            before enabling this feature.
                          </p>
                          {form.watch("remoteEvalEnabled") && (
                            <p>
                              You will also need to update your proxy server for
                              remote evaluation to continue working correctly.
                            </p>
                          )}
                        </>
                      }
                    >
                      Pass Saved Groups by reference <FaInfoCircle />
                    </PremiumTooltip>
                  }
                />
              </div>
            </div>
          </div>
        )}
        <div className="mt-4">
          <label>Feature Options</label>
          <div>
            <Checkbox
              label={"Include Feature Rule IDs in Payload"}
              value={!!form.watch("includeRuleIds")}
              setValue={(val) => form.setValue("includeRuleIds", val)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
