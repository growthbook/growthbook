import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/router";
import { PiCaretDown } from "react-icons/pi";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import { filterProjectsByEnvironment } from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Checkbox from "@/ui/Checkbox";
import TextField from "@/ui/TextField";
import MultiSelectField from "@/ui/MultiSelectField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import SDKConnectionFields, {
  SDKConnectionFieldsValue,
} from "@/components/Features/SDKConnections/SDKConnectionFields";
import { getConnectionLanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { deliveryModeFromConnection } from "@/components/Features/SDKConnections/sdkConnectionRules";
import type { LanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import { useEnvironments } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import track from "@/services/track";

export default function CreateSDKConnectionModal({
  close,
  mutate,
  initialValue,
}: {
  close: () => void;
  mutate: () => void;
  /** Duplicate seeds the form from an existing connection. */
  initialValue?: Partial<SDKConnectionInterface>;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const environments = useEnvironments();
  const { projects, project } = useDefinitions();
  const customFields = useCustomFields();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  // The fields shared with the edit modal, so the two stay identical.
  const [value, setValue] = useState<SDKConnectionFieldsValue>(() => ({
    name: initialValue?.name ?? "",
    languages: initialValue?.languages ?? [],
    sdkVersion: initialValue?.sdkVersion,
    environment: initialValue?.environment ?? environments[0]?.id ?? "",
    projects: initialValue?.projects ?? (project ? [project] : []),
    delivery: initialValue ? deliveryModeFromConnection(initialValue) : "plain",
    encryptPayload: !!initialValue?.encryptPayload,
    includeExperimentNames: initialValue?.includeExperimentNames ?? true,
    hashSecureAttributes: !!initialValue?.hashSecureAttributes,
    includeRuleIds: initialValue?.includeRuleIds ?? true,
    includeVisualExperiments: !!initialValue?.includeVisualExperiments,
    includeRedirectExperiments: !!initialValue?.includeRedirectExperiments,
  }));
  const onChange = (patch: Partial<SDKConnectionFieldsValue>) =>
    setValue((v) => ({ ...v, ...patch }));

  const [languageError, setLanguageError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter(initialValue?.languages ?? []),
  );

  // Settings the design doesn't surface, kept reachable at creation.
  const [includeDraftExperiments, setIncludeDraftExperiments] = useState(
    !!initialValue?.includeDraftExperiments,
  );
  const [includeDraftExperimentRefs, setIncludeDraftExperimentRefs] = useState(
    !!initialValue?.includeDraftExperimentRefs,
  );
  const [
    includeExperimentScheduleInMetadata,
    setIncludeExperimentScheduleInMetadata,
  ] = useState(!!initialValue?.includeExperimentScheduleInMetadata);
  const [includeTagsInMetadata, setIncludeTagsInMetadata] = useState(
    !!initialValue?.includeTagsInMetadata,
  );
  const [includeProjectIdInMetadata, setIncludeProjectIdInMetadata] = useState(
    !!initialValue?.includeProjectIdInMetadata,
  );
  const [savedGroupReferencesEnabled, setSavedGroupReferencesEnabled] =
    useState(!!initialValue?.savedGroupReferencesEnabled);
  const [includeCustomFieldsInMetadata, setIncludeCustomFieldsInMetadata] =
    useState(!!initialValue?.includeCustomFieldsInMetadata);
  const [allowedCustomFieldsInMetadata, setAllowedCustomFieldsInMetadata] =
    useState<string[]>(initialValue?.allowedCustomFieldsInMetadata ?? []);
  const [proxyEnabled, setProxyEnabled] = useState(
    !!initialValue?.proxy?.enabled,
  );
  const [proxyHost, setProxyHost] = useState(initialValue?.proxy?.host ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedPanelId = useId();

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
    }));
    setIncludeDraftExperiments(visual);
    // Only when the language selection changes.
  }, [value.languages, value.sdkVersion]);

  // Parity with the full form's create analytics.
  useEffect(() => {
    track("View SDK Connection Form");
  }, []);

  // Scroll newly-expanded content to the top of the modal body.
  const advancedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (advancedOpen) {
      advancedRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [advancedOpen]);

  // Capabilities are meaningless until a language is picked, so gate only after
  // one is chosen; `submit` still sanitises against the chosen SDK.
  const capabilities = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "min-ver-intersection",
  );
  // "max-ver-intersection" matches the full form.
  const latestCapabilities = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "max-ver-intersection",
  );
  const languageChosen = value.languages.length > 0;
  const supports = (capability: string) =>
    !languageChosen || capabilities.includes(capability as never);
  const supportsSavedGroups = supports("savedGroupReferences");

  const selectedEnvironment = environments.find(
    (e) => e.id === value.environment,
  );
  const allowedProjectIds = filterProjectsByEnvironment(
    projects.map((p) => p.id),
    selectedEnvironment,
    true,
  );
  // On create the org setting always applies — there's no existing scope to
  // grandfather.
  const requireProjectSelection = !!settings.requireProjectForSdkConnections;

  return (
    <ModalStandard
      trackingEventModalType="create-sdk-connection"
      open={true}
      close={close}
      header="New SDK Connection"
      size="lg"
      cta="Create"
      submit={async () => {
        if (!value.languages.length) {
          setLanguageError("Please select an SDK language");
          throw new Error("Please select an SDK language");
        }
        setLanguageError(null);
        const remote =
          value.delivery === "remote" &&
          latestCapabilities.includes("remoteEval") &&
          hasCommercialFeature("remote-evaluation");
        const visual =
          latestCapabilities.includes("visualEditor") &&
          value.includeVisualExperiments;
        const redirect =
          latestCapabilities.includes("redirects") &&
          value.includeRedirectExperiments;

        const body = {
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
          includeDraftExperiments:
            visual || redirect ? includeDraftExperiments : false,
          includeDraftExperimentRefs,
          includeExperimentScheduleInMetadata,
          includeTagsInMetadata,
          includeProjectIdInMetadata,
          savedGroupReferencesEnabled:
            supportsSavedGroups &&
            hasLargeSavedGroupFeature &&
            savedGroupReferencesEnabled,
          includeCustomFieldsInMetadata,
          allowedCustomFieldsInMetadata: includeCustomFieldsInMetadata
            ? allowedCustomFieldsInMetadata
            : [],
          proxyEnabled,
          proxyHost: proxyEnabled ? proxyHost : "",
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
          proxyEnabled,
        });
        mutate();
        await router.push(`/sdks/${res.connection.id}`);
      }}
    >
      <Flex direction="column" gap="4">
        <SDKConnectionFields
          value={value}
          onChange={onChange}
          languageFilter={languageFilter}
          setLanguageFilter={setLanguageFilter}
          languageError={languageError}
          requireProjectSelection={requireProjectSelection}
        />

        {value.projects.some((p) => !allowedProjectIds.includes(p)) && (
          <Text size="sm" color="text-mid">
            Some selected projects aren&apos;t allowed in this environment and
            won&apos;t be included in the SDK payload.
          </Text>
        )}

        {isCloud() && (
          <AdvancedGroup title="GrowthBook Proxy">
            <Switch
              label="Use GrowthBook Proxy"
              description="Route SDK requests through a self-hosted proxy."
              value={proxyEnabled}
              onChange={setProxyEnabled}
            />
            {proxyEnabled && (
              <TextField
                label="Proxy Host URL"
                placeholder="https://"
                value={proxyHost}
                onChange={(e) => setProxyHost(e.target.value)}
              />
            )}
          </AdvancedGroup>
        )}

        <Box
          ref={advancedRef}
          style={{
            border: "1px solid var(--gray-a5)",
            borderRadius: 8,
            overflow: "hidden",
            scrollMarginTop: 8,
          }}
        >
          <Flex
            align="center"
            justify="between"
            gap="2"
            px="3"
            py="3"
            onClick={() => setAdvancedOpen((v) => !v)}
            role="button"
            aria-expanded={advancedOpen}
            aria-controls={advancedPanelId}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAdvancedOpen((v) => !v);
              }
            }}
            style={{
              cursor: "pointer",
              userSelect: "none",
              background: "var(--gray-a2)",
              borderBottom: advancedOpen
                ? "1px solid var(--gray-a5)"
                : undefined,
            }}
          >
            <Flex align="center" gap="2">
              <Text size="md" weight="medium">
                Advanced settings
              </Text>
              {!advancedOpen && (
                <Text size="sm" color="text-mid">
                  Experiments · Payload Metadata
                </Text>
              )}
            </Flex>
            <PiCaretDown
              size={16}
              style={{
                color: "var(--gray-11)",
                transition: "transform 180ms ease",
                transform: advancedOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </Flex>
          <Box id={advancedPanelId} p="3" hidden={!advancedOpen}>
            <Flex direction="column" gap="4">
              <AdvancedGroup title="Experiments">
                <Checkbox
                  label="Rule IDs"
                  description="Include feature rule IDs in the SDK payload."
                  value={value.includeRuleIds}
                  setValue={(v) => onChange({ includeRuleIds: v })}
                />
                {latestCapabilities.includes("visualEditor") && (
                  <Checkbox
                    label="Visual editor"
                    description="Include visual editor experiments in the SDK payload."
                    value={value.includeVisualExperiments}
                    setValue={(v) => onChange({ includeVisualExperiments: v })}
                  />
                )}
                {latestCapabilities.includes("redirects") && (
                  <Checkbox
                    label="URL redirects"
                    description="Include URL redirect experiments in the SDK payload."
                    value={value.includeRedirectExperiments}
                    setValue={(v) =>
                      onChange({ includeRedirectExperiments: v })
                    }
                  />
                )}
                <Checkbox
                  label="Draft experiments"
                  description="Include draft Visual Editor and URL Redirect experiments."
                  value={includeDraftExperiments}
                  setValue={setIncludeDraftExperiments}
                />
                <Checkbox
                  label="Draft experiment rules"
                  description="Include draft Experiment rules in feature definitions."
                  value={includeDraftExperimentRefs}
                  setValue={setIncludeDraftExperimentRefs}
                />
                <Checkbox
                  label="Experiment schedule dates"
                  description="Include experiment schedule dates in the SDK payload."
                  value={includeExperimentScheduleInMetadata}
                  setValue={setIncludeExperimentScheduleInMetadata}
                />
              </AdvancedGroup>

              <AdvancedGroup title="Payload Metadata">
                <Checkbox
                  label="Tags in metadata"
                  value={includeTagsInMetadata}
                  setValue={setIncludeTagsInMetadata}
                />
                <Checkbox
                  label="Project IDs in metadata"
                  value={includeProjectIdInMetadata}
                  setValue={setIncludeProjectIdInMetadata}
                />
                {supportsSavedGroups && (
                  <Checkbox
                    label="Saved group references"
                    description="Move ID List Saved Groups to a separate key in the payload, so re-using one across features no longer inflates its size."
                    value={savedGroupReferencesEnabled}
                    // Premium, as in the full form: without the entitlement
                    // this must not be settable.
                    disabled={!hasLargeSavedGroupFeature}
                    setValue={setSavedGroupReferencesEnabled}
                  />
                )}
                <Switch
                  label="Custom fields"
                  value={includeCustomFieldsInMetadata}
                  onChange={(v) => {
                    setIncludeCustomFieldsInMetadata(v);
                    if (!v) setAllowedCustomFieldsInMetadata([]);
                  }}
                />
                {includeCustomFieldsInMetadata && (
                  <MultiSelectField
                    label="Allowed custom fields"
                    placeholder="No fields included"
                    value={allowedCustomFieldsInMetadata}
                    onChange={(fields) =>
                      setAllowedCustomFieldsInMetadata(fields as string[])
                    }
                    options={(customFields || []).map((cf) => ({
                      label: cf.name,
                      value: cf.id,
                    }))}
                    sort={false}
                    closeMenuOnSelect={true}
                  />
                )}
              </AdvancedGroup>
            </Flex>
          </Box>
        </Box>
      </Flex>
    </ModalStandard>
  );
}

function AdvancedGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Box
        mb="2"
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--gray-11)",
        }}
      >
        {title}
      </Box>
      <Flex direction="column" gap="3">
        {children}
      </Flex>
    </Box>
  );
}
