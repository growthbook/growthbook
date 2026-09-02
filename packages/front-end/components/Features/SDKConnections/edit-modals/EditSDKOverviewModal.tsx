import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SDKConnectionFields, {
  SDKConnectionFieldsValue,
} from "@/components/Features/SDKConnections/SDKConnectionFields";
import SDKConnectionAdvancedSettings from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import {
  advancedValueFromConnection,
  deliveryModeFromConnection,
  sanitizeAdvancedForSave,
  SDKConnectionAdvancedValue,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
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

type FormValue = SDKConnectionFieldsValue & SDKConnectionAdvancedValue;

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
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");
  const { draftSelector, save } = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    ...revisionProps,
  });

  // Same shape as the create modal, so the two share both form sections.
  const [value, setValue] = useState<FormValue>(() => ({
    name: connection.name,
    languages: connection.languages ?? [],
    sdkVersion: connection.sdkVersion,
    environment: connection.environment,
    projects: connection.projects ?? [],
    delivery: deliveryModeFromConnection(connection),
    encryptPayload: !!connection.encryptPayload,
    hashSecureAttributes: !!connection.hashSecureAttributes,
    ...advancedValueFromConnection(connection),
  }));
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter(connection.languages ?? []),
  );

  const onChange = (patch: Partial<FormValue>) =>
    setValue((v) => ({ ...v, ...patch }));

  // Gates follow the selection being edited, not the stored connection, so
  // switching language updates what gets persisted.
  const currentCapabilities = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "min-ver-intersection",
  );
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
        const plain = value.delivery === "plain";
        await save({
          name: value.name,
          languages: value.languages,
          sdkVersion: value.sdkVersion,
          environment: value.environment,
          projects: value.projects,
          // Plain Text is the only mode that implies no encryption.
          encryptPayload: plain ? false : value.encryptPayload,
          hashSecureAttributes: plain ? false : value.hashSecureAttributes,
          // As the full form: never persist Remote Eval the SDK can't run at
          // its latest version, or that the plan doesn't include.
          remoteEvalEnabled:
            value.delivery === "remote" &&
            latestCapabilities.includes("remoteEval") &&
            hasCommercialFeature("remote-evaluation"),
          ...sanitizeAdvancedForSave(value, {
            latestCapabilities,
            currentCapabilities,
            hasLargeSavedGroupFeature,
          }),
        });
      }}
    >
      <Flex direction="column" gap="4">
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
        <SDKConnectionAdvancedSettings
          value={value}
          onChange={onChange}
          languages={value.languages}
          sdkVersion={value.sdkVersion}
          remoteEvalEnabled={value.delivery === "remote"}
        />
      </Flex>
    </ModalStandard>
  );
}
