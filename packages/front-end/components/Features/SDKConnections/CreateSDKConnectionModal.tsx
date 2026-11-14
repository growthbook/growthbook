import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getDefaultSDKVersion } from "shared/sdk-versioning";
import { Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SDKConnectionFields from "@/components/Features/SDKConnections/SDKConnectionFields";
import {
  sdkConnectionBody,
  SDKConnectionFormValue,
} from "@/components/Features/SDKConnections/SDKConnectionEditModal";
import SDKConnectionAdvancedSettings from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import { getConnectionLanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import type { LanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import {
  advancedValueFromConnection,
  connectionCapabilities,
  defaultSavedGroupFormat,
  deliveryModeFromConnection,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";

export default function CreateSDKConnectionModal({
  close,
  mutate,
  initialValue,
  cta = "Save",
  autoCloseOnSubmit = true,
}: {
  close: () => void;
  mutate: () => void;
  initialValue?: Partial<SDKConnectionInterface>;
  cta?: string;
  // When false, the caller swaps in the next step instead of navigating away.
  autoCloseOnSubmit?: boolean;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const environments = useEnvironments();
  const { project } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  const [value, setValue] = useState<SDKConnectionFormValue>(() => ({
    name: initialValue?.name ?? "",
    languages: initialValue?.languages ?? [],
    sdkVersion:
      initialValue?.sdkVersion ??
      getDefaultSDKVersion(
        initialValue?.languages?.length === 1
          ? initialValue.languages[0]
          : "other",
      ),
    environment: initialValue?.environment ?? environments[0]?.id ?? "",
    projects: initialValue?.projects ?? (project ? [project] : []),
    includeReferencedPrerequisites:
      initialValue?.includeReferencedPrerequisites ?? true,
    delivery: initialValue ? deliveryModeFromConnection(initialValue) : "plain",
    encryptPayload: !!initialValue?.encryptPayload,
    hashSecureAttributes: !!initialValue?.hashSecureAttributes,
    ...advancedValueFromConnection(initialValue),
  }));
  // The Saved Groups default follows the chosen SDK until someone picks an
  // option themselves.
  const savedGroupFormatChosen = useRef(false);
  const onChange = (patch: Partial<SDKConnectionFormValue>) => {
    if (patch.savedGroupFormat !== undefined) {
      savedGroupFormatChosen.current = true;
    }
    setValue((v) => ({ ...v, ...patch }));
  };

  const [languageError, setLanguageError] = useState<string | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  // ModalStandard closes after every submit; when the caller keeps the modal
  // open, that close is swallowed while Cancel still closes.
  const submitted = useRef(false);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter(initialValue?.languages ?? []),
  );

  const { latestCaps } = connectionCapabilities(value);
  const showVisualEditorSettings = latestCaps.includes("visualEditor");
  const showRedirectSettings = latestCaps.includes("redirects");

  useEffect(() => {
    setValue((v) => ({
      ...v,
      includeVisualExperiments: showVisualEditorSettings,
      includeRedirectExperiments: showRedirectSettings,
      includeDraftExperiments: showVisualEditorSettings,
    }));
  }, [showVisualEditorSettings, showRedirectSettings]);

  useEffect(() => {
    if (savedGroupFormatChosen.current) return;
    const savedGroupFormat = defaultSavedGroupFormat({
      currentCapabilities: connectionCapabilities({
        languages: value.languages,
        sdkVersion: value.sdkVersion,
      }).currentCaps,
      hasLargeSavedGroupFeature,
    });
    setValue((v) => ({ ...v, savedGroupFormat }));
  }, [value.languages, value.sdkVersion, hasLargeSavedGroupFeature]);

  useEffect(() => {
    track("View SDK Connection Form");
  }, []);

  const requireProjectSelection = !!settings.requireProjectForSdkConnections;

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={() => {
        if (!autoCloseOnSubmit && submitted.current) return;
        close();
      }}
      header="New SDK Connection"
      size="lg"
      cta={cta}
      submit={async () => {
        if (!value.languages.length) {
          setLanguageError("Please select an SDK language");
          throw new Error("Please select an SDK language");
        }
        setLanguageError(null);
        if (!value.environment) {
          setEnvironmentError("Please select an environment");
          throw new Error("Please select an environment");
        }
        setEnvironmentError(null);
        const body = sdkConnectionBody(value);

        const res = await apiCall<{ connection: SDKConnectionInterface }>(
          `/sdk-connections`,
          { method: "POST", body: JSON.stringify(body) },
        );
        track("Create SDK Connection", {
          source: "SDKConnectionForm",
          languages: value.languages,
          encryptPayload: body.encryptPayload,
          hashSecureAttributes: body.hashSecureAttributes,
          remoteEvalEnabled: body.remoteEvalEnabled,
          proxyEnabled: body.proxyEnabled,
        });
        mutate();
        if (autoCloseOnSubmit) {
          await router.push(`/sdks/${res.connection.id}`);
        } else {
          submitted.current = true;
        }
      }}
    >
      <Flex direction="column" gap="4">
        <SDKConnectionFields
          value={value}
          onChange={onChange}
          languageFilter={languageFilter}
          setLanguageFilter={setLanguageFilter}
          languageError={languageError}
          environmentError={environmentError}
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
