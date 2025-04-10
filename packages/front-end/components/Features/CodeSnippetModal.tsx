import React, { useState, useEffect, ReactElement } from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import {
  FaAngleDown,
  FaAngleRight,
  FaExclamationCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import useOrgSettings from "@/hooks/useOrgSettings";
import { getApiHost, getCdnHost } from "@/services/env";
import Code from "@/components/SyntaxHighlighting/Code";
import { useAttributeSchema } from "@/services/features";
import { GBHashLock } from "@/components/Icons";
import Modal from "@/components/Modal";
import { DocLink } from "@/components/DocLink";
import InstallationCodeSnippet from "@/components/SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import GrowthBookSetupCodeSnippet from "@/components/SyntaxHighlighting/Snippets/GrowthBookSetupCodeSnippet";
import BooleanFeatureCodeSnippet from "@/components/SyntaxHighlighting/Snippets/BooleanFeatureCodeSnippet";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import TargetingAttributeCodeSnippet from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import SelectField from "@/components/Forms/SelectField";
import CheckSDKConnectionModal from "@/components/GuidedGetStarted/CheckSDKConnectionModal";
import MultivariateFeatureCodeSnippet from "@/components/SyntaxHighlighting/Snippets/MultivariateFeatureCodeSnippet";
import SDKLanguageSelector from "./SDKConnections/SDKLanguageSelector";
import { languageMapping } from "./SDKConnections/SDKLanguageLogo";

function trimTrailingSlash(str: string): string {
  return str.replace(/\/*$/, "");
}

export function getApiBaseUrl(connection?: SDKConnectionInterface): string {
  if (connection && connection.proxy.enabled) {
    return trimTrailingSlash(
      connection.proxy.hostExternal ||
      connection.proxy.host ||
      "https://proxy.yoursite.io"
    );
  }

  return trimTrailingSlash(getCdnHost() || getApiHost());
}

export default function CodeSnippetModal({
  close,
  feature,
  inline,
  cta = "结束",
  submit,
  secondaryCTA,
  sdkConnection,
  connections,
  mutateConnections,
  includeCheck,
  allowChangingConnection,
}: {
  close?: () => void;
  feature?: FeatureInterface;
  featureId?: string;
  inline?: boolean;
  cta?: string;
  submit?: () => void;
  secondaryCTA?: ReactElement;
  sdkConnection?: SDKConnectionInterface;
  connections: SDKConnectionInterface[];
  mutateConnections: () => Promise<unknown>;
  includeCheck?: boolean;
  allowChangingConnection?: boolean;
}) {
  const [currentConnectionId, setCurrentConnectionId] = useState("");

  useEffect(() => {
    setCurrentConnectionId(
      currentConnectionId || sdkConnection?.id || connections?.[0]?.id || ""
    );
  }, [connections]);

  const currentConnection: SDKConnectionInterface | null =
    connections.find((c) => c.id === currentConnectionId) || null;

  const [showTestModal, setShowTestModal] = useState(false);

  const [language, setLanguage] = useState<SDKLanguage>("javascript");
  const [version, setVersion] = useState<string>(
    getLatestSDKVersion("javascript")
  );

  const [configOpen, setConfigOpen] = useState(true);
  const [installationOpen, setInstallationOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  const [usageOpen, setUsageOpen] = useState(true);
  const [attributesOpen, setAttributesOpen] = useState(true);

  const settings = useOrgSettings();
  const attributeSchema = useAttributeSchema();

  useEffect(() => {
    if (!currentConnection) return;

    const language = currentConnection.languages[0] ?? "javascript";
    const version =
      (currentConnection?.languages?.length === 1 &&
        currentConnection?.languages?.[0] === language
        ? currentConnection?.sdkVersion
        : undefined) ?? getLatestSDKVersion(language);
    setLanguage(language);
    setVersion(version);
  }, [currentConnection]);

  if (!currentConnection) {
    return null;
  }

  const { docs, docLabel, label } = languageMapping[language];
  const hasProxy = currentConnection.proxy.enabled;
  const apiHost = getApiBaseUrl(currentConnection);
  const clientKey = currentConnection.key;
  const featuresEndpoint = apiHost + "/api/features/" + clientKey;
  const encryptionKey = currentConnection.encryptPayload
    ? currentConnection.encryptionKey
    : undefined;
  const hashSecureAttributes = !!currentConnection.hashSecureAttributes;
  const secureAttributes =
    attributeSchema?.filter((a) =>
      ["secureString", "secureString[]"].includes(a.datatype)
    ) || [];
  const secureAttributeSalt = settings.secureAttributeSalt ?? "";
  const remoteEvalEnabled = !!currentConnection.remoteEvalEnabled;

  if (showTestModal && includeCheck && !inline) {
    return (
      <CheckSDKConnectionModal
        close={() => {
          mutateConnections();
          setShowTestModal(false);
        }}
        connection={currentConnection}
        mutate={mutateConnections}
        goToNextStep={submit}
        cta={"结束"}
        showModalClose={false}
      />
    );
  }

  return (
    <>
      {showTestModal && setShowTestModal && (
        <CheckSDKConnectionModal
          close={() => {
            mutateConnections();
            setShowTestModal(false);
          }}
          connection={currentConnection}
          mutate={mutateConnections}
          goToNextStep={submit}
          showModalClose={true}
        />
      )}
      <Modal
        trackingEventModalType=""
        close={close}
        secondaryCTA={secondaryCTA}
        className="mb-4"
        bodyClassName="p-0"
        open={true}
        inline={inline}
        size={"max"}
        header="实现说明"
        autoCloseOnSubmit={false}
        submit={
          includeCheck
            ? async () => {
              setShowTestModal(true);
            }
            : submit
              ? async () => {
                submit();
                close && close();
              }
              : undefined
        }
        cta={cta}
      >
        <div
          className="border-bottom mb-3 px-3 py-2 position-sticky bg-white shadow-sm"
          style={{ top: 0, zIndex: 999 }}
        >
          <div className="row">
            {connections?.length > 1 && allowChangingConnection && (
              <div className="col-auto">
                <SelectField
                  label="SDK连接"
                  labelClassName="font-weight-bold small text-dark"
                  options={connections.map((connection) => ({
                    value: connection.id,
                    label: connection.name,
                  }))}
                  value={currentConnection?.id ?? ""}
                  onChange={(id) => {
                    setCurrentConnectionId(id);
                  }}
                />
              </div>
            )}
            <div className="col">
              <SDKLanguageSelector
                value={[language]}
                setValue={([language]) => {
                  const version =
                    (currentConnection?.languages?.length === 1 &&
                      currentConnection?.languages?.[0] === language
                      ? currentConnection?.sdkVersion
                      : undefined) ?? getLatestSDKVersion(language);
                  setLanguage(language);
                  setVersion(version);
                }}
                multiple={false}
                includeOther={false}
                limitLanguages={currentConnection.languages}
              />
            </div>
          </div>
        </div>
        <div className="px-3">
          {language === "other" ? (
            <div className="mb-4">
              <p>
                我们目前还没有针对您所用语言的SDK，但如果您想自行构建并回馈给社区，我们有详尽的文档！
              </p>
              {/* <DocLink
                docSection="buildYourOwn"
                className="btn btn-outline-primary"
              >
                查看文档
              </DocLink> */}
            </div>
          ) : (
            <p>
              以下是一些将CSII集成到您应用中的入门代码。阅读 <DocLink docSection={docs}>{docLabel || label} 文档</DocLink> 以获取更多详细信息。
            </p>
          )}
          {!language.match(/^nocode/) && (
            <div className="mb-3">
              <h4
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setConfigOpen(!configOpen);
                }}
              >
                {docLabel || label} 配置设置{" "}
                {configOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {configOpen && (
                <div className="appbox bg-light p-3">
                  <table className="gbtable table table-bordered table-sm">
                    <tbody>
                      <tr>
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
                          完整API端点
                          {hasProxy ? (
                            <>
                              {" "}
                              <small>(代理的)</small>
                            </>
                          ) : null}
                        </th>
                        <td>
                          <ClickToCopy>{featuresEndpoint}</ClickToCopy>
                        </td>
                      </tr>
                      <tr>
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
                          API主机
                          {hasProxy ? (
                            <>
                              {" "}
                              <small>(代理的)</small>
                            </>
                          ) : null}
                        </th>
                        <td>
                          <ClickToCopy>{apiHost}</ClickToCopy>
                        </td>
                      </tr>
                      <tr>
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
                          客户端密钥
                        </th>
                        <td>
                          <ClickToCopy>{clientKey}</ClickToCopy>
                        </td>
                      </tr>
                      {encryptionKey && (
                        <tr>
                          <th
                            className="pl-3"
                            style={{ verticalAlign: "middle" }}
                          >
                            解密密钥
                          </th>
                          <td>
                            <ClickToCopy>{encryptionKey}</ClickToCopy>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {language !== "other" && (
            <div className="mb-3">
              <h4
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setInstallationOpen(!installationOpen);
                }}
              >
                安装{" "}
                {installationOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {installationOpen && (
                <div className="appbox bg-light p-3">
                  <InstallationCodeSnippet
                    language={language}
                    apiHost={apiHost}
                    apiKey={clientKey}
                    encryptionKey={encryptionKey}
                    remoteEvalEnabled={remoteEvalEnabled}
                  />
                </div>
              )}
            </div>
          )}
          {language !== "other" && (
            <div className="mb-3">
              <h4
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setSetupOpen(!setupOpen);
                }}
              >
                设置 {setupOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {setupOpen && (
                <div className="appbox bg-light p-3">
                  <GrowthBookSetupCodeSnippet
                    language={language}
                    version={version}
                    apiHost={apiHost}
                    apiKey={clientKey}
                    encryptionKey={encryptionKey}
                    remoteEvalEnabled={remoteEvalEnabled}
                  />
                </div>
              )}
            </div>
          )}

          {!(language.match(/^edge-/) || language === "other") && (
            <div className="mb-3">
              <h4
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setAttributesOpen(!attributesOpen);
                }}
              >
                定向属性{" "}
                {attributesOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {attributesOpen && (
                <div className="appbox bg-light p-3">
                  <TargetingAttributeCodeSnippet
                    language={language}
                    hashSecureAttributes={hashSecureAttributes}
                    secureAttributeSalt={secureAttributeSalt}
                  />

                  {hashSecureAttributes && secureAttributes.length > 0 && (
                    <div
                      className="appbox mt-4"
                      style={{ background: "rgb(209 236 241 / 25%)" }}
                    >
                      <div className="alert alert-info mb-0">
                        <GBHashLock className="text-blue" /> 此连接已启用 <strong>安全属性哈希</strong>。您必须在SDK实现代码中手动对数据类型为 <code>secureString</code> 或 <code>secureString[]</code> 的所有属性进行哈希处理。
                      </div>
                      <div className="px-3 pb-3">
                        <div className="mt-3">
                          您的组织目前有 {secureAttributes.length} 个安全属性
                          {secureAttributes.length > 0 && (
                            <>
                              {" "}
                              在SDK中使用它们之前需要进行哈希处理：
                              <table className="table table-borderless w-auto mt-1 ml-2">
                                <tbody>
                                  {secureAttributes.map((a, i) => (
                                    <tr key={i}>
                                      <td className="pt-1 pb-0">
                                        <code className="font-weight-bold">
                                          {a.property}
                                        </code>
                                      </td>
                                      <td className="pt-1 pb-0">
                                        <span className="text-gray">
                                          {a.datatype}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </>
                          )}
                        </div>
                        <div className="mt-3">
                          要对属性进行哈希处理，请使用支持 <strong>SHA-256</strong> 的加密库，并计算您的属性加上您组织的安全属性盐的SHA-256哈希值。
                        </div>
                        <div className="mt-2">
                          例如，使用您组织的安全属性盐：
                          {secureAttributeSalt === "" && (
                            <div className="提示信息 警告类型 顶部外边距_2px 左右内边距_2px 上下内边距_1px">
                              <FaExclamationTriangle /> 您的组织有一个空的盐字符串。在您的 <Link href="/settings">组织设置</Link> 中添加一个盐字符串，以提高哈希定向条件的安全性。
                            </div>
                          )}
                          <Code
                            filename="pseudocode"
                            language="javascript"
                            code={`const salt = "${secureAttributeSalt}";

// hashing a secureString attribute
myAttribute = sha256(salt + myAttribute);

// hashing a secureString[] attribute
myAttributes = myAttributes.map(attribute => sha256(salt + attribute));`}
                          />
                        </div>
                        <div className="alert text-warning-orange mt-3 mb-0 px-2 py-1">
                          <FaExclamationCircle /> 在使用不安全的环境（如浏览器）时，不要仅仅依靠哈希作为保护高度敏感数据的唯一手段。哈希是一种混淆技术，它使得提取敏感数据变得非常困难，但并非不可能。
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!(language.match(/^edge-/) || language === "other") && (
            <div className="mb-3">
              <h4
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setUsageOpen(!usageOpen);
                }}
              >
                使用情况 {usageOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {usageOpen && (
                <div className="appbox bg-light p-3">
                  {(!feature || feature?.valueType === "boolean") && (
                    <>
                      开关特性：
                      <BooleanFeatureCodeSnippet
                        language={language}
                        featureId={feature?.id || "my-feature"}
                      />
                    </>
                  )}
                  {(!feature || feature?.valueType !== "boolean") && (
                    <>
                      {feature?.valueType || "String"}特性：
                      <MultivariateFeatureCodeSnippet
                        valueType={feature?.valueType || "string"}
                        language={language}
                        featureId={feature?.id || "my-feature"}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
