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
import useOrgSettings from "@/hooks/useOrgSettings";
import { getApiHost, getCdnHost } from "@/services/env";
import Code from "@/components/SyntaxHighlighting/Code";
import { useAttributeSchema } from "@/services/features";
import { GBHashLock } from "@/components/Icons";
import Modal from "../Modal";
import { DocLink } from "../DocLink";
import InstallationCodeSnippet from "../SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import GrowthBookSetupCodeSnippet from "../SyntaxHighlighting/Snippets/GrowthBookSetupCodeSnippet";
import BooleanFeatureCodeSnippet from "../SyntaxHighlighting/Snippets/BooleanFeatureCodeSnippet";
import ClickToCopy from "../Settings/ClickToCopy";
import TargetingAttributeCodeSnippet from "../SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import SelectField from "../Forms/SelectField";
import CheckSDKConnectionModal from "../GuidedGetStarted/CheckSDKConnectionModal";
import MultivariateFeatureCodeSnippet from "../SyntaxHighlighting/Snippets/MultivariateFeatureCodeSnippet";
import SDKLanguageSelector from "./SDKConnections/SDKLanguageSelector";
import { languageMapping } from "./SDKConnections/SDKLanguageLogo";

function trimTrailingSlash(str: string): string {
  return str.replace(/\/*$/, "");
}

export function getApiBaseUrl(connection?: SDKConnectionInterface): string {
  if (connection && connection.proxy.enabled && connection.proxy.host) {
    return trimTrailingSlash(
      connection.proxy.hostExternal || connection.proxy.host
    );
  }

  return trimTrailingSlash(getCdnHost() || getApiHost());
}

export default function CodeSnippetModal({
  close,
  feature,
  inline,
  cta = "Finish",
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

  const [configOpen, setConfigOpen] = useState(true);
  const [installationOpen, setInstallationOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  const [usageOpen, setUsageOpen] = useState(true);
  const [attributesOpen, setAttributesOpen] = useState(true);

  const settings = useOrgSettings();
  const attributeSchema = useAttributeSchema();

  useEffect(() => {
    if (!currentConnection) return;

    // connection changes & current language isn't included in new connection, reset to default
    if (!currentConnection.languages.includes(language)) {
      setLanguage(currentConnection.languages[0] || "javascript");
    }
  }, [currentConnection]);

  if (!currentConnection) {
    return null;
  }

  const { docs, label } = languageMapping[language];
  const hasProxy =
    currentConnection.proxy.enabled && !!currentConnection.proxy.host;
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
        cta={"Finish"}
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
        close={close}
        secondaryCTA={secondaryCTA}
        className="mb-4"
        bodyClassName="p-0"
        open={true}
        inline={inline}
        size={"max"}
        header="Implementation Instructions"
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
                  label="SDK Connection"
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
                  setLanguage(language);
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
                We don&apos;t have an SDK for your language yet, but we do have
                extensive documentation if you want to build your own and
                contribute it back to the community!{" "}
              </p>
              <DocLink
                docSection="buildYourOwn"
                className="btn btn-outline-primary"
              >
                View Documentation
              </DocLink>
            </div>
          ) : (
            <p>
              Below is some starter code to integrate GrowthBook into your app.
              Read the <DocLink docSection={docs}>{label} docs</DocLink> for
              more details.
            </p>
          )}
          <div className="mb-3">
            <h4
              className="cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                setConfigOpen(!configOpen);
              }}
            >
              {label} Config Settings{" "}
              {configOpen ? <FaAngleDown /> : <FaAngleRight />}
            </h4>
            {configOpen && (
              <div className="appbox bg-light p-3">
                <table className="gbtable table table-bordered table-sm">
                  <tbody>
                    <tr>
                      <th className="pl-3" style={{ verticalAlign: "middle" }}>
                        Full API Endpoint
                        {hasProxy ? (
                          <>
                            {" "}
                            <small>(proxied)</small>
                          </>
                        ) : null}
                      </th>
                      <td>
                        <ClickToCopy>{featuresEndpoint}</ClickToCopy>
                      </td>
                    </tr>
                    <tr>
                      <th className="pl-3" style={{ verticalAlign: "middle" }}>
                        API Host
                        {hasProxy ? (
                          <>
                            {" "}
                            <small>(proxied)</small>
                          </>
                        ) : null}
                      </th>
                      <td>
                        <ClickToCopy>{apiHost}</ClickToCopy>
                      </td>
                    </tr>
                    <tr>
                      <th className="pl-3" style={{ verticalAlign: "middle" }}>
                        Client Key
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
                          Decryption Key
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
          {language !== "other" && (
            <div className="mb-3">
              <h4
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setInstallationOpen(!installationOpen);
                }}
              >
                Installation{" "}
                {installationOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {installationOpen && (
                <div className="appbox bg-light p-3">
                  <InstallationCodeSnippet language={language} />
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
                Setup {setupOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {setupOpen && (
                <div className="appbox bg-light p-3">
                  <GrowthBookSetupCodeSnippet
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
                  setAttributesOpen(!attributesOpen);
                }}
              >
                Targeting Attributes (Optional){" "}
                {attributesOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {attributesOpen && (
                <div className="appbox bg-light p-3">
                  <span>
                    Replace the placeholders with your real targeting attribute
                    values. This enables you to target feature flags based on
                    user attributes.
                  </span>
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
                        <GBHashLock className="text-blue" /> This connection has{" "}
                        <strong>secure attribute hashing</strong> enabled. You
                        must manually hash all attributes with datatype{" "}
                        <code>secureString</code> or <code>secureString[]</code>{" "}
                        in your SDK implementation code.
                      </div>
                      <div className="px-3 pb-3">
                        <div className="mt-3">
                          Your organization currently has{" "}
                          {secureAttributes.length} secure attribute
                          {secureAttributes.length === 1 ? "" : "s"}
                          {secureAttributes.length > 0 && (
                            <>
                              {" "}
                              which need to be hashed before using them in the
                              SDK:
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
                          To hash an attribute, use a cryptographic library with{" "}
                          <strong>SHA-256</strong> support, and compute the
                          SHA-256 hashed value of your attribute <em>plus</em>{" "}
                          your organization&apos;s secure attribute salt.
                        </div>
                        <div className="mt-2">
                          Example, using your organization&apos;s secure
                          attribute salt:
                          {secureAttributeSalt === "" && (
                            <div className="alert alert-warning mt-2 px-2 py-1">
                              <FaExclamationTriangle /> Your organization has an
                              empty salt string. Add a salt string in your{" "}
                              <Link href="/settings">
                                organization settings
                              </Link>{" "}
                              to improve the security of hashed targeting
                              conditions.
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
                          <FaExclamationCircle /> When using an insecure
                          environment (such as a browser), do not rely
                          exclusively on hashing as a means of securing highly
                          sensitive data. Hashing is an obfuscation technique
                          that makes it very difficult, but not impossible, to
                          extract sensitive data.
                        </div>
                      </div>
                    </div>
                  )}
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
                  setUsageOpen(!usageOpen);
                }}
              >
                Usage {usageOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {usageOpen && (
                <div className="appbox bg-light p-3">
                  {(!feature || feature?.valueType === "boolean") && (
                    <>
                      On/Off feature:
                      <BooleanFeatureCodeSnippet
                        language={language}
                        featureId={feature?.id || "my-feature"}
                      />
                    </>
                  )}
                  {(!feature || feature?.valueType !== "boolean") && (
                    <>
                      {feature?.valueType || "String"} feature:
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
