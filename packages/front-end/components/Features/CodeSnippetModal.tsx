import { useState, useEffect, ReactElement } from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { getApiHost, isCloud } from "@/services/env";
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

function trimTrailingSlash(str) {
  return str.replace(/\/*$/, "");
}

export function getApiBaseUrl(connection?: SDKConnectionInterface): string {
  if (connection && connection.proxy.enabled && connection.proxy.host) {
    return trimTrailingSlash(
      connection.proxy.hostExternal || connection.proxy.host
    );
  }

  if (isCloud()) {
    return `https://cdn.growthbook.io`;
  }

  return trimTrailingSlash(getApiHost());
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
  const permissions = usePermissions();

  const [configOpen, setConfigOpen] = useState(true);
  const [installationOpen, setInstallationOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  const [usageOpen, setUsageOpen] = useState(true);
  const [attributesOpen, setAttributesOpen] = useState(false);

  const { apiCall } = useAuth();

  const { refreshOrganization } = useUser();
  const settings = useOrgSettings();

  // Record the fact that the SDK instructions have been seen
  useEffect(() => {
    if (!settings) return;
    if (settings.sdkInstructionsViewed) return;
    if (!connections.length) return;
    if (!permissions.check("manageEnvironments", "", [])) return;
    (async () => {
      await apiCall(`/organization`, {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            sdkInstructionsViewed: true,
          },
        }),
      });
      await refreshOrganization();
    })();
  }, [settings, connections.length]);

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

  const { docs, label, usesEntireEndpoint } = languageMapping[language];
  const apiHost = getApiBaseUrl(currentConnection);
  const clientKey = currentConnection.key;
  const featuresEndpoint = apiHost + "/api/features/" + clientKey;
  const encryptionKey =
    currentConnection &&
    currentConnection.encryptPayload &&
    currentConnection.encryptionKey;

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
        />
      )}
      <Modal
        close={close}
        secondaryCTA={secondaryCTA}
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
            : null
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
                  value={currentConnection?.id}
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
                    {usesEntireEndpoint ? (
                      <tr>
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
                          Features Endpoint
                        </th>
                        <td>
                          <ClickToCopy>{featuresEndpoint}</ClickToCopy>
                        </td>
                      </tr>
                    ) : (
                      <>
                        <tr>
                          <th
                            className="pl-3"
                            style={{ verticalAlign: "middle" }}
                          >
                            API Host
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
                      </>
                    )}
                    {encryptionKey && (
                      <tr>
                        <th
                          className="pl-3"
                          style={{ verticalAlign: "middle" }}
                        >
                          Encryption Key
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
                  Replace the placeholders with your real targeting attribute
                  values. This enables you to target feature flags based on user
                  attributes.
                  <TargetingAttributeCodeSnippet language={language} />
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
