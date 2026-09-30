import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SDKConnectionFields, {
  SDKConnectionFieldsValue,
} from "@/components/Features/SDKConnections/SDKConnectionFields";
import SDKConnectionAdvancedSettings from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import { getConnectionLanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import type { LanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import {
  advancedValueFromConnection,
  defaultSavedGroupFormat,
  deliveryModeFromConnection,
  sanitizeAdvancedForSave,
  SDKConnectionAdvancedValue,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";

type FormValue = SDKConnectionFieldsValue & SDKConnectionAdvancedValue;

export default function CreateSDKConnectionModal({
  close,
  mutate,
  initialValue,
  cta = "Save",
  autoCloseOnSubmit = true,
}: {
  close: () => void;
  mutate: () => void;
  /** Duplicate seeds the form from an existing connection. */
  initialValue?: Partial<SDKConnectionInterface>;
  cta?: string;
  /**
   * Off, the modal neither navigates nor closes after creating: the caller
   * swaps in the next step (the setup flow shows the code snippet) once the
   * refreshed connection list arrives.
   */
  autoCloseOnSubmit?: boolean;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const environments = useEnvironments();
  const { project } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  // One state object feeds both shared sections, so the two modals stay
  // identical and a setting is never held in two places.
  const [value, setValue] = useState<FormValue>(() => ({
    name: initialValue?.name ?? "",
    languages: initialValue?.languages ?? [],
    sdkVersion: initialValue?.sdkVersion,
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
  const onChange = (patch: Partial<FormValue>) => {
    if (patch.savedGroupFormat !== undefined) {
      savedGroupFormatChosen.current = true;
    }
    setValue((v) => ({ ...v, ...patch }));
  };

  const [languageError, setLanguageError] = useState<string | null>(null);
  // ModalStandard closes after every submit; when the caller keeps the modal
  // open, that close is swallowed while Cancel still closes.
  const submitted = useRef(false);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter(initialValue?.languages ?? []),
  );

  // Matches the full form's create branch: a new connection opts into visual
  // editor and redirect experiments whenever the chosen SDK supports them,
  // rather than starting everything off.
  useEffect(() => {
    const caps = getConnectionSDKCapabilities(
      { languages: value.languages, sdkVersion: value.sdkVersion },
      "max-ver-intersection",
    );
    const visual = caps.includes("visualEditor");
    const redirect = caps.includes("redirects");
    setValue((v) => ({
      ...v,
      includeVisualExperiments: visual,
      includeRedirectExperiments: redirect,
      includeDraftExperiments: visual,
    }));
    // Only when the language selection changes.
  }, [value.languages, value.sdkVersion]);

  // As the full form: on a new connection the SDK is usually picked after the
  // form opens, so the default has to follow it — the most capable format the
  // chosen SDK can read. Both reference formats need the plan.
  useEffect(() => {
    if (savedGroupFormatChosen.current) return;
    const savedGroupFormat = defaultSavedGroupFormat({
      currentCapabilities: getConnectionSDKCapabilities(
        { languages: value.languages, sdkVersion: value.sdkVersion },
        "min-ver-intersection",
      ),
      hasLargeSavedGroupFeature,
    });
    setValue((v) => ({ ...v, savedGroupFormat }));
  }, [value.languages, value.sdkVersion, hasLargeSavedGroupFeature]);

  // Parity with the full form's create analytics.
  useEffect(() => {
    track("View SDK Connection Form");
  }, []);

  const currentCapabilities = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "min-ver-intersection",
  );
  // "max-ver-intersection" matches the full form's save-time sanitisation.
  const latestCapabilities = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "max-ver-intersection",
  );

  // On create the org setting always applies — there's no existing scope to
  // grandfather.
  const requireProjectSelection = !!settings.requireProjectForSdkConnections;

  return (
    <ModalStandard
      trackingEventModalType="create-sdk-connection"
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
        const plain = value.delivery === "plain";
        const body = {
          name: value.name,
          languages: value.languages,
          sdkVersion: value.sdkVersion,
          environment: value.environment,
          projects: value.projects,
          includeReferencedPrerequisites: value.includeReferencedPrerequisites,
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
        };

        const res = await apiCall<{ connection: SDKConnectionInterface }>(
          `/sdk-connections`,
          { method: "POST", body: JSON.stringify(body) },
        );
        track("Create SDK Connection", {
          source: "CreateSDKConnectionModal",
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
          edit={false}
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
