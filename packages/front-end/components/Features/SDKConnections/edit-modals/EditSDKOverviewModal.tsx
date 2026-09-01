import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { useState } from "react";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SDKConnectionFields, {
  DeliveryMode,
  SDKConnectionFieldsValue,
} from "@/components/Features/SDKConnections/SDKConnectionFields";
import {
  getConnectionLanguageFilter,
  LanguageFilter,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "./useSdkConnectionRevisionFlow";

function modeFromConnection(c: SDKConnectionInterface): DeliveryMode {
  if (c.remoteEvalEnabled) return "remote";
  if (c.encryptPayload || c.hashSecureAttributes) return "ciphered";
  return "plain";
}

export default function EditSDKOverviewModal({
  connection,
  close,
  mutate,
  ...revisionProps
}: {
  connection: SDKConnectionInterface;
  close: () => void;
  mutate: () => Promise<unknown> | void;
} & SdkConnectionRevisionProps) {
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const { draftSelector, save } = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    ...revisionProps,
  });

  const [value, setValue] = useState<SDKConnectionFieldsValue>({
    name: connection.name,
    languages: connection.languages ?? [],
    sdkVersion: connection.sdkVersion,
    environment: connection.environment,
    projects: connection.projects ?? [],
    delivery: modeFromConnection(connection),
    encryptPayload: !!connection.encryptPayload,
    includeExperimentNames: connection.includeExperimentNames ?? true,
    hashSecureAttributes: !!connection.hashSecureAttributes,
    includeRuleIds: !!connection.includeRuleIds,
    includeVisualExperiments: !!connection.includeVisualExperiments,
    includeRedirectExperiments: !!connection.includeRedirectExperiments,
  });
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter(connection.languages ?? []),
  );

  const onChange = (patch: Partial<SDKConnectionFieldsValue>) =>
    setValue((v) => ({ ...v, ...patch }));

  // "max-ver-intersection" matches the full form: save-time sanitisation is
  // based on what the SDK supports at its latest version, not the pinned one.
  const latestCapabilities = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "max-ver-intersection",
  );

  const isExternallyManaged = connection.managedBy?.type === "vercel";
  const requireProjectSelection =
    !!settings.requireProjectForSdkConnections &&
    (connection.projects?.length ?? 0) > 0;

  return (
    <ModalStandard
      trackingEventModalType="edit-sdk-connection"
      open={true}
      close={close}
      header="Edit SDK Connection"
      size="lg"
      cta="Save Settings"
      submit={async () => {
        // Every capability lookup reads languages[0], so a connection without
        // one breaks downstream.
        if (!value.languages.length) {
          setLanguageError("Please select an SDK language");
          throw new Error("Please select an SDK language");
        }
        setLanguageError(null);
        const remote =
          value.delivery === "remote" &&
          latestCapabilities.includes("remoteEval") &&
          hasCommercialFeature("remote-evaluation");
        // Never persist an option this SDK can't use.
        const visual =
          latestCapabilities.includes("visualEditor") &&
          value.includeVisualExperiments;
        const redirect =
          latestCapabilities.includes("redirects") &&
          value.includeRedirectExperiments;
        await save({
          name: value.name,
          languages: value.languages,
          sdkVersion: value.sdkVersion,
          environment: value.environment,
          projects: value.projects,
          // Plain Text is the only mode that implies no encryption.
          encryptPayload:
            value.delivery === "plain" ? false : value.encryptPayload,
          hashSecureAttributes:
            value.delivery === "plain" ? false : value.hashSecureAttributes,
          remoteEvalEnabled: remote,
          includeExperimentNames: value.includeExperimentNames,
          includeRuleIds: value.includeRuleIds,
          includeVisualExperiments: visual,
          includeRedirectExperiments: redirect,
        });
      }}
    >
      {draftSelector}
      <SDKConnectionFields
        value={value}
        onChange={onChange}
        languageFilter={languageFilter}
        setLanguageFilter={setLanguageFilter}
        languageError={languageError}
        disableScope={isExternallyManaged}
        requireProjectSelection={requireProjectSelection}
      />
    </ModalStandard>
  );
}
