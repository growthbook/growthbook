import React, { useState, useEffect, ReactElement, useCallback } from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  FaAngleDown,
  FaAngleRight,
  FaExclamationCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import { PiPackage } from "react-icons/pi";
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
import Callout from "@/ui/Callout";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import SDKLanguageSelector from "./SDKConnections/SDKLanguageSelector";
import {
  getPackageRepositoryName,
  languageMapping,
} from "./SDKConnections/SDKLanguageLogo";

function trimTrailingSlash(str: string): string {
  return str.replace(/\/*$/, "");
}

export function getApiBaseUrl(connection?: SDKConnectionInterface): string {
  if (connection && connection.proxy.enabled) {
    return trimTrailingSlash(
      connection.proxy.hostExternal ||
        connection.proxy.host ||
        "https://proxy.yoursite.io",
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
  const { apiCall } = useAuth();
  useEffect(() => {
    setCurrentConnectionId(
      currentConnectionId || sdkConnection?.id || connections?.[0]?.id || "",
    );
  }, [connections]);

  const currentConnection: SDKConnectionInterface | null =
    connections.find((c) => c.id === currentConnectionId) || null;

  const [showTestModal, setShowTestModal] = useState(false);

  const [language, setLanguage] = useState<SDKLanguage>("javascript");
  const [version, setVersion] = useState<string>(
    getLatestSDKVersion("javascript"),
  );

  const [configOpen, setConfigOpen] = useState(true);
  const [installationOpen, setInstallationOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  const [usageOpen, setUsageOpen] = useState(true);
  const [eventTracker, setEventTracker] = useState(
    currentConnection?.eventTracker || "",
  );

  const [attributesOpen, setAttributesOpen] = useState(true);

  const settings = useOrgSettings();
  const attributeSchema = useAttributeSchema();

  const permissionsUtil = usePermissionsUtil();
  const canUpdate = currentConnection
    ? permissionsUtil.canUpdateSDKConnection(currentConnection, {})
    : false;
  const updateEventTracker = useCallback(
    async (value: string) => {
      try {
        track("Event Tracker Selected", {
          eventTracker,
          language: currentConnection?.languages || [],
        });
        if (canUpdate && currentConnectionId) {
          await apiCall(`/sdk-connections/${currentConnectionId}`, {
            method: "PUT",
            body: JSON.stringify({
              eventTracker: value,
            }),
          });
        }
        setEventTracker(value);
      } catch (e) {
        setEventTracker(value);
      }
    },
    [currentConnectionId, setEventTracker],
  );
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
    setEventTracker(currentConnection?.eventTracker || "");
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
      ["secureString", "secureString[]"].includes(a.datatype),
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
        trackingEventModalType=""
        close={close}
        secondaryCTA={secondaryCTA}
        className="mb-4 appbox"
        bodyClassName="p-0"
        open={true}
        inline={inline}
        size={"max"}
        header="Implementation Instructions"
        autoFocusSelector=""
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
        <div className="border-bottom mb-3 px-3 py-2">
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
              Read the{" "}
              <DocLink docSection={docs}>{docLabel || label} docs</DocLink> for
              more details.
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
                {docLabel || label} Config Settings{" "}
                {configOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {configOpen && (
                <div className="appbox bg-light p-3">
                  <table className="table table-bordered table-sm">
                    <tbody>
                      <tr>
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
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
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
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
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
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
                Installation{" "}
                {installationOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {installationOpen && (
                <div className="appbox bg-light p-3">
                  {language === "nextjs" && (
                    <div className="mb-3">
                      <p>
                        For back-end and hybrid integrations, use the official
                        GrowthBook adapter for Vercel&apos;s{" "}
                        <a
                          href="https://flags-sdk.dev/providers/growthbook"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Flags SDK
                        </a>{" "}
                        (@flags-sdk/growthbook).
                      </p>
                      <Callout status="info" mb="6">
                        Flags SDK does not run in a browser context. For
                        front-end integrations, use our{" "}
                        <strong>React SDK</strong>.
                      </Callout>
                    </div>
                  )}

                  <InstallationCodeSnippet
                    language={language}
                    eventTracker={eventTracker}
                    setEventTracker={updateEventTracker}
                    apiHost={apiHost}
                    apiKey={clientKey}
                    encryptionKey={encryptionKey}
                    remoteEvalEnabled={remoteEvalEnabled}
                  />
                  {languageMapping[language]?.packageUrl && (
                    <div className="mt-3">
                      <a
                        href={languageMapping[language].packageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm"
                      >
                        <PiPackage
                          className="mr-1"
                          style={{ fontSize: "1.2em", verticalAlign: "-0.2em" }}
                        />
                        View on{" "}
                        {getPackageRepositoryName(
                          languageMapping[language].packageUrl,
                        )}
                      </a>
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
                  setSetupOpen(!setupOpen);
                }}
              >
                Setup {setupOpen ? <FaAngleDown /> : <FaAngleRight />}
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
                    eventTracker={eventTracker}
                    setEventTracker={updateEventTracker}
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
                Targeting Attributes{" "}
                {attributesOpen ? <FaAngleDown /> : <FaAngleRight />}
              </h4>
              {attributesOpen && (
                <div className="appbox bg-light p-3">
                  <TargetingAttributeCodeSnippet
                    language={language}
                    hashSecureAttributes={hashSecureAttributes}
                    secureAttributeSalt={secureAttributeSalt}
                    version={version}
                    eventTracker={eventTracker}
                  />

                  {hashSecureAttributes && secureAttributes.length > 0 && (
                    <div className="appbox mt-4">
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

          {!(language.match(/^edge-/) || language === "other") && (
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
                  {language !== "nextjs" &&
                    (!feature || feature?.valueType !== "boolean") && (
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

          {language === "nextjs" && (
            <div>
              <div className="h4 mt-4 mb-3">Further customization</div>
              <ul>
                <li>
                  Set up <strong>Vercel Edge Config</strong> and use a
                  GrowthBook <strong>SDK Webhook</strong> to keep feature and
                  experiment values synced between GrowthBook and the web
                  server. This eliminates network requests from the web server
                  to GrowthBook.
                </li>
                <li>
                  Implement sticky bucketing using{" "}
                  <code>growthbookAdapter.setStickyBucketService()</code> for
                  advanced experimentation.
                </li>
                <li>
                  Expose GrowthBook data to Vercel&apos;s Flags Explorer by
                  creating an API route with{" "}
                  <code>createFlagsDiscoveryEndpoint</code>.
                </li>
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
