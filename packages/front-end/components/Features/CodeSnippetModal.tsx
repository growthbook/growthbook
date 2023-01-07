import { useState, useEffect, ReactElement } from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
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
  allowChangingLanguage = true,
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
}) {
  const [language, setLanguage] = useState<SDKLanguage>(defaultLanguage);
  const permissions = usePermissions();

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

  const { docs, label } = languageMapping[language];

  return (
    <Modal
      close={close}
      secondaryCTA={secondaryCTA}
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

      {allowChangingLanguage ? (
        <>
          <h4>Choose your language</h4>
          <SDKLanguageSelector
            value={[language]}
            setValue={([language]) => setLanguage(language)}
            multiple={false}
            includeOther={false}
          />
        </>
      ) : (
        <h4>{label} Instructions</h4>
      )}
      <p className="mt-3">
        Below is some starter code to integrate GrowthBook into your app. Read
        the <DocLink docSection={docs}>{label} docs</DocLink> for more details.
      </p>

      <h4>Installation</h4>
      <InstallationCodeSnippet language={language} />

      <h4>Setup</h4>
      <GrowthBookSetupCodeSnippet
        language={language}
        apiHost={getApiBaseUrl(sdkConnection)}
        apiKey={sdkConnection ? sdkConnection.key : apiKey}
        useStreaming={!!sdkConnection?.proxy?.enabled}
      />

      <h4>Usage</h4>
      <BooleanFeatureCodeSnippet language={language} featureId={featureId} />
    </Modal>
  );
}
