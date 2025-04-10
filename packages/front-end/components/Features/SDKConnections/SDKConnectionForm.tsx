import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
} from "back-end/types/sdk-connection";
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
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import SDKLanguageSelector from "./SDKLanguageSelector";
import {
  LanguageType,
  languageMapping,
  LanguageFilter,
  getConnectionLanguageFilter,
} from "./SDKLanguageLogo";

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
  cta = "保存",
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
    "encrypt-features-endpoint"
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes"
  );
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");

  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  useEffect(() => {
    if (edit) return;
    track("查看SDK连接表单");
  }, [edit]);

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
      includeRedirectExperiments:
        initialValue.includeRedirectExperiments ?? false,
      proxyEnabled: initialValue.proxy?.enabled ?? false,
      proxyHost: initialValue.proxy?.host ?? "",
      remoteEvalEnabled: initialValue.remoteEvalEnabled ?? false,
      savedGroupReferencesEnabled:
        initialValue.savedGroupReferencesEnabled ?? false,
    },
  });

  const usingLatestVersion = !isSDKOutdated(
    form.watch("languages")?.[0] || "other",
    form.watch("sdkVersion")
  );

  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter(initialValue.languages ?? [])
  );

  const useLatestSdkVersion = () => {
    const language = form.watch("languages")?.[0] || "other";
    const latest = getLatestSDKVersion(language);
    form.setValue("sdkVersion", latest);
  };

  const languages = form.watch("languages");
  const languageTypes: Set<LanguageType> = new Set(
    languages.map((l) => languageMapping[l].type)
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
    "max-ver-intersection"
  );
  const currentSdkCapabilities = getConnectionSDKCapabilities(
    form.getValues(),
    "min-ver-intersection"
  );
  const showVisualEditorSettings = latestSdkCapabilities.includes(
    "visualEditor"
  );
  const showRedirectSettings = latestSdkCapabilities.includes("redirects");
  const showEncryption = currentSdkCapabilities.includes("encryption");
  const showRemoteEval = currentSdkCapabilities.includes("remoteEval");

  const showSavedGroupSettings = useMemo(
    () => currentSdkCapabilities.includes("savedGroupReferences"),
    [currentSdkCapabilities]
  );

  useEffect(() => {
    if (!showSavedGroupSettings) {
      form.setValue("savedGroupReferencesEnabled", false);
    }
  }, [showSavedGroupSettings, form]);

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

  const disallowedProjects = getDisallowedProjects(
    projects,
    selectedProjects ?? [],
    selectedEnvironment
  );

  const permissionRequired = (project: string) => {
    return edit
      ? permissionsUtil.canUpdateSDKConnection(
        { projects: [project], environment: form.watch("environment") },
        {}
      )
      : permissionsUtil.canCreateSDKConnection({
        projects: [project],
        environment: form.watch("environment"),
      });
  };

  const projectsOptions = useProjectOptions(
    permissionRequired,
    form.watch("projects") || [],
    [...filteredProjects, ...disallowedProjects]
  );
  const selectedValidProjects = selectedProjects?.filter((p) => {
    return disallowedProjects?.find((dp) => dp.id === p) === undefined;
  });

  if (initialValue.projects) {
    initialValue.projects.forEach((p) => {
      const name = getProjectById(p);
      if (!name) {
        projectsOptions.push({
          label: "无效项目",
          value: p,
        });
      }
    });
  }

  useEffect(() => {
    if (languageType === "backend") {
      setSelectedSecurityTab("none");
    }
  }, [languageType, setSelectedSecurityTab]);

  useEffect(() => {
    if (!edit) {
      form.setValue("includeVisualExperiments", showVisualEditorSettings);
      form.setValue("includeDraftExperiments", showVisualEditorSettings);
      form.setValue("includeRedirectExperiments", showRedirectSettings);
    } else if (!showVisualEditorSettings) {
      form.setValue("includeVisualExperiments", false);
      form.setValue("includeDraftExperiments", false);
      form.setValue("includeRedirectExperiments", false);
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

  return (
    <Modal
      trackingEventModalType=""
      header={edit ? "编辑SDK连接" : "新建SDK连接"}
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
            }
          );
          track("创建SDK连接", {
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
        // 对语言的手动验证
        if (languages.length === 0) {
          setLanguageError("请选择一种SDK语言");
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
        <Field label="名称" {...form.register("name")} required />

        <div className="mb-4">
          <div className="form-group">
            <label>SDK语言</label>
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
                    getLatestSDKVersion(languages[0])
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
                  <SelectField
                    style={{ width: 180 }}
                    className="mr-4"
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
                    formatOptionLabel={({ value, label }) => {
                      const latest = getLatestSDKVersion(
                        form.watch("languages")[0]
                      );
                      return (
                        <span>
                          {label}
                          {value === latest && (
                            <span
                              className="text-muted uppercase-title float-right position-relative"
                              style={{ top: 3 }}
                            >
                              最新版
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
                      使用最新版
                    </a>
                  )}
                </div>
              </div>
            )}
        </div>

        <div className="mb-4">
          <SelectField
            label="环境"
            required
            placeholder="请选择一个..."
            value={form.watch("environment")}
            onChange={(env) => {
              form.setValue("environment", env);
              form.setValue("projects", []); // Reset projects when environment changes
            }}
            options={environments.map((e) => ({ label: e.id, value: e.id }))}
            sort={false}
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
                      包含 {numProjects} 个项目
                      {numProjects === 1 ? "" : "s"}
                    </div>
                  ) : (
                    <div className="text-muted small font-italic">
                      包含所有项目
                    </div>
                  )}
                </div>
              );
            }}
          />
        </div>

        <div className="mb-4">
          <label>
            按项目过滤{" "}
            <Tooltip
              body={`下面的下拉菜单已进行过滤，仅包含您有权限进行${edit ? "更新" : "创建"} SDK连接的项目。`}
            />
            {!!selectedProjects?.length && (
              <> ({selectedValidProjects?.length ?? 0})</>
            )}
          </label>
          <MultiSelectField
            placeholder={
              environmentHasProjects
                ? "所有环境项目"
                : "所有项目"
            }
            containerClassName="w-100"
            value={form.watch("projects") || []}
            onChange={(projects) => form.setValue("projects", projects)}
            options={projectsOptions}
            sort={false}
            closeMenuOnSelect={true}
            formatOptionLabel={({ value, label }) => {
              const disallowed = disallowedProjects?.find(
                (p) => p.id === value
              );
              return disallowed ? (
                <Tooltip body="此项目在所选环境中不被允许，将不会包含在SDK负载中。">
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
              此SDK连接引用了 {disallowedProjects.length} 个项目
              {disallowedProjects.length !== 1 && "s"}，这些项目在所选环境中不被允许。这可能是由于某个项目从所选环境中移除所导致的。
            </div>
          )}
        </div>

        {languageType !== "backend" && (
          <>
            <label>SDK负载安全</label>
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
                      纯文本
                      <Tooltip
                        popperClassName="text-left"
                        body={
                          <p className="mb-0">
                            完整的功能定义，包括定位条件和实验版本，任何拥有客户端密钥的人都可查看。
                          </p>
                        }
                      >
                        <div className="subtitle">
                          高度可缓存，但可能会向用户泄露敏感信息
                          <FaInfoCircle className="ml-1" />
                        </div>
                      </Tooltip>
                    </>
                  }
                >
                  <></>
                </Tab>

                {["frontend", "mobile", "nocode", "edge", "other"].includes(
                  languageType
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
                          加密
                          <Tooltip
                            popperClassName="text-left"
                            body={
                              <p className="mb-0">
                                完整的功能定义将被加密，敏感的定位条件将被哈希处理，以帮助避免将业务逻辑泄露给客户端应用程序。并非100%安全，但能阻止大多数窥探。
                              </p>
                            }
                          >
                            <div className="subtitle">
                              在保持可缓存的同时增加混淆
                              <FaInfoCircle className="ml-1" />
                            </div>
                          </Tooltip>
                        </>
                      }
                    >
                      <div>
                        <label className="mb-3">加密选项</label>
                        {/* {showEncryption && (
                          <div className="mb-4 d-flex align-items-center">
                            <Toggle
                              id="encryptSDK"
                              value={form.watch("encryptPayload")}
                              setValue={(val) =>
                                form.setValue("encryptPayload", val)
                              }
                              disabled={!hasEncryptionFeature}
                            />
                            <label className="ml-2 mb-0" htmlFor="encryptSDK">
                              <PremiumTooltip
                                commercialFeature="encrypt-features-endpoint"
                                body={
                                  <>
                                    <p>
                                      SDK负载将通过AES加密算法进行加密。在公共或不安全的环境（如浏览器）中评估功能标志时，加密通过混淆提供了额外的安全层。这使您能够基于敏感属性定位用户。
                                    </p>
                                    <p className="mb-0 text-warning-orange small">
                                      <FaExclamationCircle /> 在使用不安全环境时，不要仅依赖负载加密作为保护高度敏感数据的手段。因为客户端执行解密操作，所以通过足够的努力可能会提取出未加密的负载。
                                    </p>
                                  </>
                                }
                              >
                                加密SDK负载 <FaInfoCircle />
                              </PremiumTooltip>
                            </label>
                          </div>
                        )} */}

                        {/* <div className="mb-4 d-flex align-items-center">
                          <Toggle
                            id="hash-secure-attributes"
                            value={form.watch("hashSecureAttributes")}
                            setValue={(val) =>
                              form.setValue("hashSecureAttributes", val)
                            }
                            disabled={!hasSecureAttributesFeature}
                          />
                          <label
                            className="ml-2 mb-0"
                            htmlFor="hash-secure-attributes"
                          >
                            <PremiumTooltip
                              commercialFeature="hash-secure-attributes"
                              body={
                                <>
                                  <p>
                                    引用 <code>secureString</code> 属性的功能定位条件将通过SHA-256哈希进行匿名化。在公共或不安全的环境（如浏览器）中评估功能标志时，哈希通过混淆提供了额外的安全层。这使您能够基于敏感属性定位用户。
                                  </p>
                                  <p className="mb-0 text-warning-orange small">
                                    <FaExclamationCircle /> 在使用不安全环境时，不要仅依赖哈希作为保护高度敏感数据的手段。哈希是一种混淆技术，它使提取敏感数据变得非常困难，但并非不可能。
                                  </p>
                                </>
                              }
                            >
                              哈希安全属性 <FaInfoCircle />
                            </PremiumTooltip>
                          </label>
                        </div> */}

                        <div className="d-flex align-items-center">
                          <Toggle
                            id="sdk-connection-include-experiment-meta"
                            value={!form.watch("includeExperimentNames")}
                            setValue={(val) =>
                              form.setValue("includeExperimentNames", !val)
                            }
                          />
                          <label
                            className="ml-2 mb-0"
                            htmlFor="sdk-connection-include-experiment-meta"
                          >
                            <Tooltip
                              body={
                                <>
                                  <p>
                                    实验和版本名称在调试或跟踪事件时有助于添加上下文。
                                  </p>
                                  <p>
                                    然而，如果在客户端或移动应用程序中启用此功能，可能会向用户暴露潜在的敏感信息。
                                  </p>
                                  <p className="mb-0">
                                    为了实现最大程度的隐私和安全，我们建议隐藏这些字段。
                                  </p>
                                </>
                              }
                            >
                              隐藏实验和版本名称 <FaInfoCircle />
                            </Tooltip>
                          </label>
                        </div>
                      </div>

                      {form.watch("encryptPayload") &&
                        !currentSdkCapabilities.includes("encryption") && (
                          <div
                            className="ml-2 mt-3 text-warning-orange"
                            style={{ marginBottom: -5 }}
                          >
                            <FaExclamationCircle /> 在您当前的SDK中可能无法进行负载解密。
                            {languages.length === 1 && (
                              <div className="mt-1 text-gray">
                                {getSDKCapabilityVersion(
                                  languages[0],
                                  "encryption"
                                ) ? (
                                  <>
                                    在SDK版本{" "}
                                    <code>
                                      {getSDKCapabilityVersion(
                                        languages[0],
                                        "encryption"
                                      )}
                                    </code>
                                    中引入。此连接中指定的SDK版本是
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
                        远程评估
                        <Tooltip
                          popperClassName="text-left"
                          body={
                            <>
                              <p className="mb-0">
                                功能和实验在私有服务器上进行评估，只有最终分配的值会暴露给用户。
                              </p>
                              {isCloud() && (
                                <div className="mt-2 text-warning-orange">
                                  <FaExclamationCircle /> 需要诸如CSII代理或CDN边缘工作者之类的远程评估服务。
                                </div>
                              )}
                            </>
                          }
                        >
                          <div className="subtitle">
                            完全向用户隐藏业务逻辑
                            <FaInfoCircle className="ml-1" />
                          </div>
                        </Tooltip>
                      </>
                    }
                  >
                    <div>
                      <label className="mb-3">远程评估选项</label>
                      <div className="d-flex align-items-center">
                        <Toggle
                          id="remote-evaluation"
                          value={form.watch("remoteEvalEnabled")}
                          setValue={(val) =>
                            form.setValue("remoteEvalEnabled", val)
                          }
                          disabled={
                            !hasRemoteEvaluationFeature ||
                            !latestSdkCapabilities.includes("remoteEval")
                          }
                        />
                        <label
                          className="ml-2 mb-0"
                          htmlFor="remote-evaluation"
                        >
                          <PremiumTooltip
                            commercialFeature="remote-evaluation"
                            tipMinWidth="600px"
                            body={
                              <>
                                <div className="mb-2">
                                  <strong>远程评估</strong> 通过仅在私有服务器而非前端环境中评估功能标志，全面保障您的SDK安全。这确保了定位规则内的任何敏感信息或未使用的功能版本都不会被客户端看到。
                                </div>
                                <div className="mb-2">
                                  远程评估提供与包含实验名称的SDK相同的安全优势。然而，后端SDK既不需要也不支持远程评估。
                                </div>
                                <div className="mb-2">
                                  远程评估确实涉及一些成本考量：
                                  <ol className="pl-3 mt-2">
                                    <li className="mb-2">
                                      它会增加网络流量。评估后的负载无法在不同用户间共享；因此CDN缓存未命中的情况会增加。
                                    </li>
                                    <li>
                                      任何使用流更新的连接都会产生轻微延迟。需要额外的网络跳转从服务器获取评估后的负载。
                                    </li>
                                  </ol>
                                </div>
                              </>
                            }
                          >
                            使用远程评估 <FaInfoCircle />
                          </PremiumTooltip>
                        </label>
                      </div>
                      {isCloud() ? (
                        <div className="alert alert-info mb-0 mt-3 py-1 px-2 d-flex flex-row">
                          <div className="pr-2">
                            <FaExclamationCircle className="mr-1" />
                          </div>
                          <div>
                            云客户必须自行托管诸如{" "}
                            <a
                              target="_blank"
                              href="https://github.com/growthbook/growthbook-proxy"
                              rel="noreferrer"
                            >
                              CSII代理
                            </a>{" "}
                            或CDN边缘工作者之类的远程评估服务。
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {!currentSdkCapabilities.includes("remoteEval") ? (
                      <div
                        className="ml-2 mt-3 text-warning-orange"
                        style={{ marginBottom: -5 }}
                      >
                        <FaExclamationCircle /> 在您当前的SDK中可能无法进行远程评估。
                        {languages.length === 1 && (
                          <div className="mt-1 text-gray">
                            {getSDKCapabilityVersion(
                              languages[0],
                              "remoteEval"
                            ) ? (
                              <>
                                在SDK版本{" "}
                                <code>
                                  {getSDKCapabilityVersion(
                                    languages[0],
                                    "remoteEval"
                                  )}
                                </code>
                                中引入。此连接中指定的SDK版本是{" "}
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
            <label>全自动实验</label>
            <div className="mt-2">
              {showVisualEditorSettings && (
                <div className="mb-4 d-flex align-items-center">
                  <Toggle
                    id="sdk-connection-visual-experiments-toggle"
                    value={form.watch("includeVisualExperiments")}
                    setValue={(val) =>
                      form.setValue("includeVisualExperiments", val)
                    }
                  />
                  <label
                    className="ml-2 mb-0 cursor-pointer"
                    htmlFor="sdk-connection-visual-experiments-toggle"
                  >
                    启用 <strong>可视化编辑器实验</strong>
                    {/* （<DocLink docSection="visual_editor">docs</DocLink>) */}
                  </label>
                </div>
              )}

              {showRedirectSettings && (
                <div className="mb-4 d-flex align-items-center">
                  <Toggle
                    id="sdk-connection-redirects-toggle"
                    value={form.watch("includeRedirectExperiments")}
                    setValue={(val) =>
                      form.setValue("includeRedirectExperiments", val)
                    }
                  />
                  <label
                    className="ml-2 mb-0 cursor-pointer"
                    htmlFor="sdk-connection-redirects-toggle"
                  >
                    启用 <strong>URL重定向实验</strong>
                    {/* （<DocLink docSection="url_redirects">docs</DocLink>) */}
                  </label>
                </div>
              )}

              {(form.watch("includeVisualExperiments") ||
                form.watch("includeRedirectExperiments")) && (
                  <>
                    <div className="mb-4 d-flex align-items-center">
                      <Toggle
                        id="sdk-connection-include-draft-experiments-toggle"
                        value={form.watch("includeDraftExperiments")}
                        setValue={(val) =>
                          form.setValue("includeDraftExperiments", val)
                        }
                      />
                      <Tooltip
                        body={
                          <>
                            <p>
                              开发中的自动实验将发送到SDK。我们建议仅在非生产环境中启用此功能。
                            </p>
                            <p className="mb-0">
                              要强制进入某个版本，可使用诸如{" "}
                              <code className="d-block">?my-experiment-id=2</code>
                              这样的URL查询字符串。
                            </p>
                          </>
                        }
                      >
                        <label
                          className="ml-2 mb-0 cursor-pointer"
                          htmlFor="sdk-connection-include-draft-experiments-toggle"
                        >
                          包含草稿实验 <FaInfoCircle />
                        </label>
                      </Tooltip>
                    </div>
                  </>
                )}
            </div>
          </div>
        )}

        {isCloud() && (
          <div className="mt-5">
            <label className="mb-1">CSII代理</label>
            <div className="mt-2">
              <div className="d-flex align-items-center">
                <Toggle
                  id="sdk-connection-proxy-toggle"
                  value={form.watch("proxyEnabled")}
                  setValue={(val) => form.setValue("proxyEnabled", val)}
                />
                <label
                  className="ml-2 mb-0"
                  htmlFor="sdk-connection-proxy-toggle"
                >
                  使用CSII代理
                </label>
              </div>
              {form.watch("proxyEnabled") && (
                <Field
                  id="sdk-connection-proxyHost"
                  containerClassName="mt-3"
                  label={
                    <>
                      代理主机URL <small>(可选)</small>
                      <Tooltip
                        className="ml-1"
                        body={
                          <>
                            <p>
                              可选地添加您的代理的公共URL以实现更快的部署。提供代理主机将允许CSII在功能定义发生变化时向您的代理推送更新。
                            </p>
                            <p className="mb-0">
                              如果没有CSII的推送更新，代理将回退到过时验证缓存策略。
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
        {/* {showSavedGroupSettings && (
          <div className="mt-1">
            <label>保存的组</label>
            <div className="mt-2">
              <div className="mb-4 d-flex align-items-center">
                <Toggle
                  id="sdk-connection-large-saved-groups-toggle"
                  value={form.watch("savedGroupReferencesEnabled")}
                  setValue={(val) =>
                    form.setValue("savedGroupReferencesEnabled", val)
                  }
                  disabled={!hasLargeSavedGroupFeature}
                />
                <label
                  className="ml-2 mb-0 cursor-pointer"
                  htmlFor="sdk-connection-large-saved-groups-toggle"
                >
                  <PremiumTooltip
                    commercialFeature="large-saved-groups"
                    body={
                      <>
                        <p>
                          通过将ID列表保存组从内联评估移到负载JSON中的单独键，来减小负载大小。在多个功能或实验中重复使用ID列表将不再显著增加负载大小。
                        </p>
                        <p>
                          旧版本的SDK不支持此功能。在启用此功能之前，请确保您的SDK实现是最新的。
                        </p>
                        {form.watch("remoteEvalEnabled") && (
                          <p>
                            您还需要更新远程评估的代理服务器，以使其继续正常工作。
                          </p>
                        )}
                      </>
                    }
                  >
                    通过引用传递保存组 <FaInfoCircle />
                  </PremiumTooltip>
                </label>
              </div>
            </div>
          </div>
        )} */}
      </div>
    </Modal>
  );
}
