import { useState, useEffect, ReactElement } from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import { getApiHost, isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "../Modal";
import { DocLink } from "../DocLink";
import InstallationCodeSnippet from "../SyntaxHighlighting/Snippets/InstallationCodeSnippet";
import GrowthBookSetupCodeSnippet from "../SyntaxHighlighting/Snippets/GrowthBookSetupCodeSnippet";
import BooleanFeatureCodeSnippet from "../SyntaxHighlighting/Snippets/BooleanFeatureCodeSnippet";
import MultivariateFeatureCodeSnippet from "../SyntaxHighlighting/Snippets/MultivariateFeatureCodeSnippet";
import ClickToCopy from "../Settings/ClickToCopy";
import SDKEndpointSelector from "./SDKEndpointSelector";
import { languageMapping } from "./SDKConnections/SDKLanguageLogo";
import SDKLanguageSelector from "./SDKConnections/SDKLanguageSelector";

export function getApiBaseUrl(connection?: SDKConnectionInterface): string {
  if (connection?.proxy?.enabled && connection?.proxy?.host) {
    return connection.proxy.host.replace(/\/*$/, "") + "/";
  }

  if (isCloud()) {
    return `https://cdn.growthbook.io/`;
  }

  return getApiHost() + "/";
}

export default function CodeSnippetModal({
  close,
  featureId = "my-feature",
  defaultLanguage = "javascript",
  inline,
  cta = "Finish",
  submit,
  secondaryCTA,
  sdkConnection,
  limitLanguages,
}: {
  close?: () => void;
  featureId?: string;
  defaultLanguage?: SDKLanguage;
  inline?: boolean;
  cta?: string;
  submit?: () => Promise<void>;
  secondaryCTA?: ReactElement;
  sdkConnection?: SDKConnectionInterface;
  allowChangingLanguage?: boolean;
  limitLanguages?: SDKLanguage[];
}) {
  const [language, setLanguage] = useState<SDKLanguage>(defaultLanguage);
  const permissions = usePermissions();

  const [configOpen, setConfigOpen] = useState(true);
  const [installationOpen, setInstallationOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(true);
  const [usageOpen, setUsageOpen] = useState(true);

  const [apiKey, setApiKey] = useState("");

  const { apiCall } = useAuth();

  const { refreshOrganization } = useUser();
  const settings = useOrgSettings();

  // Record the fact that the SDK instructions have been seen
  useEffect(() => {
    if (!settings) return;
    if (settings.sdkInstructionsViewed) return;
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
  }, [settings]);

  const { docs, label, usesEntireEndpoint } = languageMapping[language];
  const apiHost = getApiBaseUrl(sdkConnection);
  const clientKey = sdkConnection ? sdkConnection.key : apiKey;
  const featuresEndpoint = apiHost + "api/features/" + clientKey;
  const encryptionKey =
    sdkConnection &&
    sdkConnection.encryptPayload &&
    sdkConnection.encryptionKey;

  return (
    <Modal
      close={close}
      secondaryCTA={secondaryCTA}
      bodyClassName="p-0"
      open={true}
      inline={inline}
      size={"lg"}
      header="Implementation Instructions"
      submit={async () => {
        if (submit) await submit();
      }}
      cta={cta}
    >
      {!sdkConnection && (
        <SDKEndpointSelector apiKey={apiKey} setApiKey={setApiKey} />
      )}
      {(!limitLanguages || limitLanguages.length > 1) && (
        <div
          className="border-bottom mb-3 px-3 py-2 position-sticky bg-white shadow-sm"
          style={{ top: 0, zIndex: 999 }}
        >
          <SDKLanguageSelector
            value={[language]}
            setValue={([language]) => setLanguage(language)}
            multiple={false}
            includeOther={false}
            limitLanguages={limitLanguages}
          />
        </div>
      )}
      <div className="px-3">
        <p>
          Below is some starter code to integrate GrowthBook into your app. Read
          the <DocLink docSection={docs}>{label} docs</DocLink> for more
          details.
        </p>
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
                      <th style={{ verticalAlign: "middle" }}>
                        Features Endpoint
                      </th>
                      <td>
                        <ClickToCopy>{featuresEndpoint}</ClickToCopy>
                      </td>
                    </tr>
                  ) : (
                    <>
                      <tr>
                        <th style={{ width: "140px", verticalAlign: "middle" }}>
                          API Host
                        </th>
                        <td>
                          <ClickToCopy>{apiHost}</ClickToCopy>
                        </td>
                      </tr>
                      <tr>
                        <th style={{ verticalAlign: "middle" }}>Client Key</th>
                        <td>
                          <ClickToCopy>{clientKey}</ClickToCopy>
                        </td>
                      </tr>
                    </>
                  )}
                  {encryptionKey && (
                    <tr>
                      <th style={{ verticalAlign: "middle" }}>
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
        <div className="mb-3">
          <h4
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setInstallationOpen(!installationOpen);
            }}
          >
            {label} Installation{" "}
            {installationOpen ? <FaAngleDown /> : <FaAngleRight />}
          </h4>
          {installationOpen && (
            <div className="appbox bg-light p-3">
              <InstallationCodeSnippet language={language} />
            </div>
          )}
        </div>
        <div className="mb-3">
          <h4
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setSetupOpen(!setupOpen);
            }}
          >
            {label} Setup {setupOpen ? <FaAngleDown /> : <FaAngleRight />}
          </h4>
          {setupOpen && (
            <div className="appbox bg-light p-3">
              <GrowthBookSetupCodeSnippet
                language={language}
                apiHost={apiHost}
                apiKey={clientKey}
                encryptionKey={encryptionKey}
                useStreaming={!!sdkConnection?.proxy?.enabled}
              />
            </div>
          )}
        </div>

        <div className="mb-3">
          <h4
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setUsageOpen(!usageOpen);
            }}
          >
            {label} Usage {usageOpen ? <FaAngleDown /> : <FaAngleRight />}
          </h4>
          {usageOpen && (
            <div className="appbox bg-light p-3">
              On/Off Feature:
              <BooleanFeatureCodeSnippet
                language={language}
                featureId={featureId}
              />
              String Feature:
              <MultivariateFeatureCodeSnippet
                language={language}
                featureId={featureId}
                valueType={"string"}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
