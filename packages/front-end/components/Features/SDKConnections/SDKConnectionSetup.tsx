import { ReactNode, useMemo, useState } from "react";
import isEqual from "lodash/isEqual";
import { PiCaretUp } from "react-icons/pi";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getLatestSDKVersion,
  savedGroupFormatFromConnection,
} from "shared/sdk-versioning";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import MultiSelectField from "@/ui/MultiSelectField";
import SDKLanguageLogo, {
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import {
  EnvironmentField,
  PrerequisitesField,
  ProjectsField,
  SDKConnectionFieldsValue,
  SDKVersionField,
} from "@/components/Features/SDKConnections/SDKConnectionFields";
import PayloadSecurityField from "@/components/Features/SDKConnections/PayloadSecurityField";
import SavedGroupFormatField from "@/components/Features/SDKConnections/SavedGroupFormatField";
import {
  ExperimentSettings,
  MetadataSettings,
  ObservabilitySettings,
  ProxySettings,
} from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import {
  advancedValueFromConnection,
  deliveryModeFromConnection,
  sanitizeAdvancedForSave,
  SDKConnectionAdvancedValue,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CATEGORY_TITLES,
  SETTING_TITLES,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";
import useOrgSettings from "@/hooks/useOrgSettings";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";

type FormValue = SDKConnectionFieldsValue & SDKConnectionAdvancedValue;

function valueFromConnection(connection: SDKConnectionInterface): FormValue {
  return {
    name: connection.name,
    languages: connection.languages ?? [],
    sdkVersion: connection.sdkVersion,
    environment: connection.environment,
    projects: connection.projects ?? [],
    includeReferencedPrerequisites: !!connection.includeReferencedPrerequisites,
    delivery: deliveryModeFromConnection(connection),
    encryptPayload: !!connection.encryptPayload,
    hashSecureAttributes: !!connection.hashSecureAttributes,
    ...advancedValueFromConnection(connection),
  };
}

// Which saved fields each row owns, for its "edited" marker.
const ROW_FIELDS: Record<string, string[]> = {
  name: ["name"],
  sdk: ["languages"],
  version: ["sdkVersion"],
  environment: ["environment"],
  projects: ["projects"],
  prerequisites: ["includeReferencedPrerequisites"],
  security: ["encryptPayload", "hashSecureAttributes", "remoteEvalEnabled"],
  experiments: [
    "includeVisualExperiments",
    "includeRedirectExperiments",
    "includeExperimentNames",
  ],
  savedGroups: ["savedGroupFormat"],
  metadata: [
    "includeProjectIdInMetadata",
    "includeCustomFieldsInMetadata",
    "allowedCustomFieldsInMetadata",
    "includeTagsInMetadata",
    "includeExperimentScheduleInMetadata",
  ],
  observability: [
    "includeRuleIds",
    "includeDraftExperimentRefs",
    "includeDraftExperiments",
  ],
  proxy: ["proxyEnabled", "proxyHost"],
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  languages: "SDK",
  sdkVersion: "SDK version",
  environment: "Environment",
  projects: "Projects",
  includeReferencedPrerequisites: "Prerequisite Feature Flags",
  encryptPayload: "Encrypt payload",
  hashSecureAttributes: "Hash secure attributes",
  remoteEvalEnabled: "Remote evaluation",
  includeVisualExperiments: "Visual Editor experiments",
  includeRedirectExperiments: "URL Redirect experiments",
  includeExperimentNames: "Experiment names",
  savedGroupFormat: "Saved Groups by reference",
  includeProjectIdInMetadata: "Project IDs",
  includeCustomFieldsInMetadata: "Custom fields",
  allowedCustomFieldsInMetadata: "Allowed custom fields",
  includeTagsInMetadata: "Tags",
  includeExperimentScheduleInMetadata: "Experiment schedule dates",
  includeRuleIds: "Rule IDs",
  includeDraftExperimentRefs: "Draft Experiment rules",
  includeDraftExperiments: "Draft Visual Editor and URL Redirect experiments",
  proxyEnabled: "GrowthBook Proxy",
  proxyHost: "Proxy host",
};

function display(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if ((value ?? "") === "") return "None";
  return String(value);
}

function Row({
  label,
  edited,
  align = "start",
  children,
}: {
  label: ReactNode;
  edited?: boolean;
  align?: "start" | "center";
  children: ReactNode;
}) {
  return (
    <Grid
      columns={{ initial: "1", sm: "200px minmax(0, 1fr)" }}
      gap={{ initial: "2", sm: "4" }}
      align={align}
    >
      <Flex align="center" gap="2" pt={align === "start" ? "1" : "0"}>
        <Text weight="medium">{label}</Text>
        {edited ? (
          <Badge color="violet" variant="soft" radius="full" label="Edited" />
        ) : null}
      </Flex>
      <Box style={{ minWidth: 0, maxWidth: 560 }}>{children}</Box>
    </Grid>
  );
}

function LanguageField({
  value,
  onChange,
  disabled,
  error,
}: {
  value: SDKLanguage[];
  onChange: (patch: Partial<FormValue>) => void;
  disabled: boolean;
  error: string | null;
}) {
  const options = Object.keys(languageMapping) as SDKLanguage[];
  // Connections created with several SDKs keep them; new picks are one SDK.
  if (value.length > 1) {
    return (
      <MultiSelectField
        size="md"
        aria-label="SDK"
        disabled={disabled}
        value={value}
        onChange={(langs) => onChange({ languages: langs as SDKLanguage[] })}
        options={options.map((l) => ({
          value: l,
          label: languageMapping[l].label,
        }))}
        formatOptionLabel={({ value: l }) => (
          <SDKLanguageLogo language={l as SDKLanguage} showLabel size={14} />
        )}
        sort={false}
      />
    );
  }
  return (
    <Select
      aria-label="SDK"
      disabled={disabled}
      error={error ?? undefined}
      placeholder="Choose an SDK..."
      value={value[0]}
      setValue={(lang) =>
        onChange({
          languages: [lang as SDKLanguage],
          sdkVersion: getLatestSDKVersion(lang as SDKLanguage),
        })
      }
    >
      {options.map((lang) => (
        <SelectItem key={lang} value={lang}>
          <SDKLanguageLogo language={lang} showLabel size={14} hideExtra />
        </SelectItem>
      ))}
    </Select>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="4">
      <Heading as="h3" size="md" mb="0">
        {title}
      </Heading>
      {children}
    </Flex>
  );
}

// The connection's settings, edited in place and saved together.
export default function SDKConnectionSetup({
  connection,
  mutate,
  canUpdate,
  ...revisionProps
}: {
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown> | void;
  canUpdate: boolean;
} & SdkConnectionRevisionProps) {
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const initial = useMemo(() => valueFromConnection(connection), [connection]);
  const [value, setValue] = useState<FormValue>(initial);
  const [showChanges, setShowChanges] = useState(false);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const onChange = (patch: Partial<FormValue>) =>
    setValue((v) => ({ ...v, ...patch }));

  const { draftSelector, save } = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    proposedScope: { projects: value.projects, environment: value.environment },
    ...revisionProps,
  });

  const disabled = !canUpdate;
  const managedByVercel = connection.managedBy?.type === "vercel";
  const requireProjectSelection =
    !!settings.requireProjectForSdkConnections &&
    (connection.projects?.length ?? 0) > 0;

  // The same body the full edit form saved, so rules and gating match it.
  const bodyFor = (v: FormValue): Record<string, unknown> => {
    const caps = { languages: v.languages, sdkVersion: v.sdkVersion };
    const latestCapabilities = getConnectionSDKCapabilities(
      caps,
      "max-ver-intersection",
    );
    const currentCapabilities = getConnectionSDKCapabilities(
      caps,
      "min-ver-intersection",
    );
    const plain = v.delivery === "plain";
    return {
      name: v.name,
      languages: v.languages,
      sdkVersion: v.sdkVersion,
      environment: v.environment,
      projects: v.projects,
      includeReferencedPrerequisites: v.includeReferencedPrerequisites,
      encryptPayload: plain ? false : v.encryptPayload,
      hashSecureAttributes: plain ? false : v.hashSecureAttributes,
      remoteEvalEnabled:
        v.delivery === "remote" &&
        latestCapabilities.includes("remoteEval") &&
        hasCommercialFeature("remote-evaluation"),
      ...sanitizeAdvancedForSave(v, {
        latestCapabilities,
        currentCapabilities,
      }),
    };
  };

  const before = bodyFor(initial);
  const after = bodyFor(value);
  const changed = Object.keys(after).filter(
    (k) => !isEqual(after[k] ?? null, before[k] ?? null),
  );
  const isEdited = (row: string) =>
    ROW_FIELDS[row].some((k) => changed.includes(k));

  const currentCaps = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "min-ver-intersection",
  );
  const showSavedGroups = currentCaps.includes("savedGroupReferences");
  const showVersion =
    value.languages.length === 1 &&
    !/^(other|nocode-.*)$/.test(value.languages[0]);

  const submit = async () => {
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
    await save(after);
    setShowChanges(false);
  };

  return (
    <Flex direction="column" gap="5">
      {disabled && (
        <Text size="sm" color="text-mid">
          You don&apos;t have permission to edit this SDK Connection.
        </Text>
      )}

      <Section title="Connection">
        <Row label="Name" edited={isEdited("name")} align="center">
          <TextField
            aria-label="Name"
            value={value.name}
            disabled={disabled}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Row>
        <Row label="SDK" edited={isEdited("sdk")} align="center">
          <LanguageField
            value={value.languages}
            onChange={onChange}
            disabled={disabled}
            error={languageError}
          />
        </Row>
        {showVersion && (
          <Row label="SDK version" edited={isEdited("version")}>
            <SDKVersionField
              value={value}
              onChange={onChange}
              hideLabel
              disabled={disabled}
            />
          </Row>
        )}
        <Row label="Environment" edited={isEdited("environment")}>
          <EnvironmentField
            value={value}
            onChange={onChange}
            hideLabel
            disabled={disabled}
            error={environmentError}
            managedByVercel={managedByVercel}
          />
        </Row>
        <Row label="Projects" edited={isEdited("projects")}>
          <ProjectsField
            value={value}
            onChange={onChange}
            hideLabel
            disabled={disabled}
            edit
            managedByVercel={managedByVercel}
            requireProjectSelection={requireProjectSelection}
          />
        </Row>
        <Row
          label="Prerequisites"
          edited={isEdited("prerequisites")}
          align="center"
        >
          <PrerequisitesField
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </Row>
      </Section>

      <Separator size="4" />

      <Section title="Payload">
        {shouldShowPayloadSecurity(value.languages) && (
          <Row
            label={CATEGORY_TITLES.payloadSecurity}
            edited={isEdited("security")}
          >
            <PayloadSecurityField
              value={value}
              onChange={onChange}
              languages={value.languages}
              sdkVersion={value.sdkVersion}
              hideLabel
              disabled={disabled}
            />
          </Row>
        )}
        <Row
          label={CATEGORY_TITLES.experiments}
          edited={isEdited("experiments")}
        >
          <Flex direction="column" gap="2" pt="1">
            <ExperimentSettings
              value={value}
              onChange={onChange}
              disabled={disabled}
              languages={value.languages}
              sdkVersion={value.sdkVersion}
            />
          </Flex>
        </Row>
        {showSavedGroups && (
          <Row
            label={SETTING_TITLES.savedGroupReferences}
            edited={isEdited("savedGroups")}
          >
            <SavedGroupFormatField
              value={value.savedGroupFormat}
              onChange={(savedGroupFormat) => onChange({ savedGroupFormat })}
              languages={value.languages}
              sdkVersion={value.sdkVersion}
              remoteEvalEnabled={value.delivery === "remote"}
              storedFormat={savedGroupFormatFromConnection(connection)}
              hideLabel
              disabled={disabled}
            />
          </Row>
        )}
        <Row
          label={CATEGORY_TITLES.payloadMetadata}
          edited={isEdited("metadata")}
        >
          <Flex direction="column" gap="2" pt="1">
            <MetadataSettings
              value={value}
              onChange={onChange}
              disabled={disabled}
            />
          </Flex>
        </Row>
        <Row
          label={CATEGORY_TITLES.observability}
          edited={isEdited("observability")}
        >
          <Flex direction="column" gap="2" pt="1">
            <ObservabilitySettings
              value={value}
              onChange={onChange}
              disabled={disabled}
              languages={value.languages}
              sdkVersion={value.sdkVersion}
            />
          </Flex>
        </Row>
        {isCloud() && (
          <Row label={CATEGORY_TITLES.proxy} edited={isEdited("proxy")}>
            <Flex direction="column" gap="2" pt="1">
              <ProxySettings
                value={value}
                onChange={onChange}
                disabled={disabled}
              />
            </Flex>
          </Row>
        )}
      </Section>

      {canUpdate && changed.length > 0 && (
        <Box
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 5,
            background: "var(--color-panel-solid)",
            borderTop: "1px solid var(--gray-a5)",
            boxShadow: "0 -4px 12px var(--black-a2)",
          }}
          mx="-4"
          pl="4"
          // Clears the floating help button in the corner.
          pr="9"
          py="3"
        >
          {showChanges && (
            <Flex direction="column" gap="1" mb="3">
              {changed.map((k) => (
                <Grid key={k} columns="220px minmax(0, 1fr)" gap="3">
                  <Text size="sm" weight="medium">
                    {FIELD_LABELS[k] ?? k}
                  </Text>
                  <Text size="sm" color="text-mid">
                    {display(before[k])} → {display(after[k])}
                  </Text>
                </Grid>
              ))}
            </Flex>
          )}
          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Button
              variant="ghost"
              color="gray"
              size="sm"
              icon={
                <PiCaretUp
                  style={{
                    transform: showChanges ? "rotate(180deg)" : undefined,
                  }}
                />
              }
              iconPosition="right"
              onClick={() => setShowChanges((v) => !v)}
            >
              {changed.length} staged change{changed.length === 1 ? "" : "s"}
            </Button>
            <Flex align="center" gap="3" wrap="wrap" justify="end">
              <Box style={{ maxWidth: 520 }}>{draftSelector}</Box>
              <Button
                variant="ghost"
                onClick={() => {
                  setValue(initial);
                  setShowChanges(false);
                  setLanguageError(null);
                  setEnvironmentError(null);
                }}
              >
                Discard changes
              </Button>
              <Button onClick={submit}>Save</Button>
            </Flex>
          </Flex>
          {(languageError || environmentError) && (
            <HelperText status="error" size="sm" mt="2">
              {languageError ?? environmentError}
            </HelperText>
          )}
        </Box>
      )}
    </Flex>
  );
}
