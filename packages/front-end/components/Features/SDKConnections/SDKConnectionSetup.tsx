import { ReactNode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import isEqual from "lodash/isEqual";
import { PiCaretUp } from "react-icons/pi";
import {
  SavedGroupFormat,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getLatestSDKVersion,
  savedGroupFormatFromConnection,
} from "shared/sdk-versioning";
import { Box, Flex, Grid, Separator } from "@radix-ui/themes";
import { Popover } from "@/ui/Popover";
import { StagedChange } from "@/components/Experiment/TabbedPage/StagedChanges";
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
  SAVED_GROUP_FORMAT_LABELS,
  SETTING_TITLES,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";
import SDKConnectionSaveButton from "@/components/Features/SDKConnections/edit-modals/SDKConnectionSaveButton";
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

// Each setting as the page labels it.
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  languages: "SDK",
  sdkVersion: "SDK version",
  environment: "Environment",
  projects: "Projects",
  includeReferencedPrerequisites: SETTING_TITLES.prerequisites,
  encryptPayload: "Encrypt payload",
  hashSecureAttributes: "Hash secure attributes",
  remoteEvalEnabled: "Use remote evaluation",
  includeVisualExperiments: SETTING_TITLES.visualEditor,
  includeRedirectExperiments: SETTING_TITLES.urlRedirect,
  includeExperimentNames: SETTING_TITLES.hideNames,
  savedGroupFormat: SETTING_TITLES.savedGroupReferences,
  includeProjectIdInMetadata: SETTING_TITLES.projectIds,
  includeCustomFieldsInMetadata: SETTING_TITLES.customFields,
  allowedCustomFieldsInMetadata: "Allowed custom fields",
  includeTagsInMetadata: SETTING_TITLES.tags,
  includeExperimentScheduleInMetadata: SETTING_TITLES.scheduleDates,
  includeRuleIds: SETTING_TITLES.ruleIds,
  includeDraftExperimentRefs: SETTING_TITLES.draftRules,
  includeDraftExperiments: SETTING_TITLES.draftExperiments,
  proxyEnabled: SETTING_TITLES.useProxy,
  proxyHost: SETTING_TITLES.proxyHost,
};

// Values the page shows differently from how they're saved.
const FIELD_DISPLAY: Record<string, (value: unknown) => unknown> = {
  // Shown as "Hide names from payload", the opposite of what's saved.
  includeExperimentNames: (v) => !v,
  savedGroupFormat: (v) =>
    SAVED_GROUP_FORMAT_LABELS[v as SavedGroupFormat] ?? v,
};
const shownValue = (key: string, value: unknown) =>
  FIELD_DISPLAY[key] ? FIELD_DISPLAY[key](value) : value;

// A saved value as the page shows it, for the staged changes diff.
function display(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if ((value ?? "") === "") return "None";
  return String(value);
}

// A row's values as lines of "Setting: value", or the bare value for one.
function displayStaged(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value)
      .map(([label, v]) => `${label}: ${display(v)}`)
      .join("\n");
  }
  return display(value);
}

// Each row's label on the page, which names its staged change.
const ROW_LABELS: Record<string, string> = {
  name: "Name",
  sdk: "SDK",
  version: "SDK version",
  environment: "Environment",
  projects: "Projects",
  prerequisites: "Prerequisites",
  security: CATEGORY_TITLES.payloadSecurity,
  experiments: CATEGORY_TITLES.experiments,
  savedGroups: SETTING_TITLES.savedGroupReferences,
  metadata: CATEGORY_TITLES.payloadMetadata,
  observability: CATEGORY_TITLES.observability,
  proxy: CATEGORY_TITLES.proxy,
};

// The form fields a row's Discard puts back, beyond the saved fields it shows.
const ROW_FORM_EXTRAS: Record<string, string[]> = {
  sdk: ["sdkVersion"],
  security: ["delivery"],
};

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
        onChange={(langs) =>
          onChange({
            languages: langs as SDKLanguage[],
            ...(langs.length === 1 && {
              sdkVersion: getLatestSDKVersion(langs[0] as SDKLanguage),
            }),
          })
        }
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
  saveBarSlot = null,
  ...revisionProps
}: {
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown> | void;
  canUpdate: boolean;
  // Where the save bar goes, like the experiment page's layout footer; inline
  // when there is none.
  saveBarSlot?: HTMLElement | null;
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

  const { revisionAware, destination, save } = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    proposedScope: { projects: value.projects, environment: value.environment },
    ...revisionProps,
  });

  const renderBar = (bar: ReactNode) =>
    saveBarSlot ? createPortal(bar, saveBarSlot) : bar;

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

  // One staged change per edited row, like the experiment page's list.
  const staged = Object.keys(ROW_FIELDS)
    .filter(isEdited)
    .map((row) => {
      const keys = ROW_FIELDS[row].filter((k) => changed.includes(k));
      const pickValues = (body: Record<string, unknown>) =>
        // A row of several settings names the one that changed.
        ROW_FIELDS[row].length === 1
          ? shownValue(keys[0], body[keys[0]])
          : Object.fromEntries(
              keys.map((k) => [FIELD_LABELS[k] ?? k, shownValue(k, body[k])]),
            );
      return {
        row,
        label: ROW_LABELS[row] ?? row,
        review: { before: pickValues(before), after: pickValues(after) },
      };
    });
  const discardRow = (row: string) => {
    const keys = [...ROW_FIELDS[row], ...(ROW_FORM_EXTRAS[row] ?? [])].filter(
      (k) => k in initial,
    ) as (keyof FormValue)[];
    setValue((v) => ({
      ...v,
      ...Object.fromEntries(keys.map((k) => [k, initial[k]])),
    }));
  };

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
    // Only what the user changed: the form's defaults for unset fields must not
    // be written behind their back.
    await save(Object.fromEntries(changed.map((k) => [k, after[k]])));
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

      {canUpdate &&
        changed.length > 0 &&
        renderBar(
          <Box
            // The experiment page's save bar.
            style={{
              background: "var(--color-panel-solid)",
              borderTop: "1px solid var(--gray-a5)",
              boxShadow:
                "0 -1px 2px rgba(0, 0, 0, 0.1), 0 -4px 4px rgba(0, 0, 0, 0.025)",
              paddingLeft: 15,
            }}
            // Clears the floating help button in the corner.
            pr="9"
            py="2"
          >
            <Flex align="center" justify="between" gap="3" wrap="wrap">
              <Popover
                open={showChanges}
                onOpenChange={setShowChanges}
                side="top"
                align="start"
                sideOffset={8}
                contentStyle={{
                  width: 640,
                  maxWidth: "90vw",
                  padding: "12px 16px",
                }}
                trigger={
                  <Button
                    variant="ghost"
                    color="gray"
                    size="sm"
                    icon={<PiCaretUp />}
                    iconPosition="right"
                  >
                    {staged.length} staged{" "}
                    {staged.length === 1 ? "change" : "changes"}
                  </Button>
                }
                content={
                  <Flex direction="column" gap="2">
                    {staged.map((c) => (
                      <StagedChange
                        key={c.row}
                        label={c.label}
                        review={c.review}
                        discard={() => discardRow(c.row)}
                        keepMine={null}
                        incompatible={false}
                        saving={false}
                        format={displayStaged}
                      />
                    ))}
                  </Flex>
                }
              />
              <Flex align="center" gap="3" wrap="wrap" justify="end">
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
                <SDKConnectionSaveButton
                  destination={destination}
                  revisionAware={revisionAware}
                  onSave={submit}
                />
              </Flex>
            </Flex>
            {(languageError || environmentError) && (
              <HelperText status="error" size="sm" mt="2">
                {languageError ?? environmentError}
              </HelperText>
            )}
          </Box>,
        )}
    </Flex>
  );
}
