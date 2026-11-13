import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { SavedGroupFormat, SDKLanguage } from "shared/types/sdk-connection";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import SDKLanguageLogo, {
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import {
  EnvironmentField,
  PrerequisitesField,
  ProjectsField,
  SDKPackageLink,
  SDKVersionField,
} from "@/components/Features/SDKConnections/SDKConnectionFields";
import PayloadSecurityField, {
  CIPHER_OPTIONS_TITLE,
  CipherOptionsField,
  REMOTE_EVAL_OPTIONS_TITLE,
  RemoteEvalOptionsField,
} from "@/components/Features/SDKConnections/PayloadSecurityField";
import SavedGroupFormatField from "@/components/Features/SDKConnections/SavedGroupFormatField";
import {
  ExperimentSettings,
  MetadataSettings,
  ObservabilitySettings,
  ProxySettings,
  TRACES_TITLE,
  TracesSettings,
} from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import {
  languagesPatch,
  SDKCapability,
  shouldShowPayloadSecurity,
  versionedLanguage,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CATEGORY_TITLES,
  CustomFieldsLabel,
  DELIVERY_LABELS,
  DraftExperimentsLabel,
  DraftRulesLabel,
  HideNamesLabel,
  PrerequisitesLabel,
  ProjectIdsLabel,
  ProxyHostTooltip,
  SAVED_GROUP_FORMAT_LABELS,
  ScheduleDatesLabel,
  SETTING_TITLES,
  TagsLabel,
  UrlRedirectLabel,
  VisualEditorLabel,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";
import type { SDKConnectionFormValue } from "@/components/Features/SDKConnections/SDKConnectionEditModal";

type OnChange = (patch: Partial<SDKConnectionFormValue>) => void;

export type SettingRowContext = {
  latestCaps: SDKCapability[];
  currentCaps: SDKCapability[];
  customFieldName: (id: string) => string;
  projectName: (id: string) => ReactNode;
  showTraces: boolean;
  storedSavedGroupFormat: SavedGroupFormat;
  managedByVercel: boolean;
  requireProjectSelection: boolean;
  cloud: boolean;
};

type Fields = (keyof SDKConnectionFormValue)[];

export type SettingRow = {
  key: string;
  label: string;
  // The settings it shows, for its change mark; by value where another
  // setting decides which.
  fields: Fields | ((v: SDKConnectionFormValue) => Fields);
  shown: (v: SDKConnectionFormValue, ctx: SettingRowContext) => boolean;
  read: (v: SDKConnectionFormValue, ctx: SettingRowContext) => ReactNode;
  edit: (
    v: SDKConnectionFormValue,
    onChange: OnChange,
    disabled: boolean,
    ctx: SettingRowContext,
  ) => ReactNode;
};

export function rowFields(row: SettingRow, v: SDKConnectionFormValue) {
  return typeof row.fields === "function" ? row.fields(v) : row.fields;
}

const CIPHER_FIELDS: Fields = ["encryptPayload", "hashSecureAttributes"];

function NoneValue() {
  return (
    <Text color="text-mid" fontStyle="italic">
      None
    </Text>
  );
}

// The settings that are on, one per line, each as its checkbox labels it.
function EnabledList({ items }: { items: ReactNode[] }) {
  const on = items.filter((i) => !!i);
  if (!on.length) return <NoneValue />;
  return (
    <Flex direction="column" gap="1">
      {on.map((item, i) => (
        <Text key={i}>{item}</Text>
      ))}
    </Flex>
  );
}

function Checkboxes({ children }: { children: ReactNode }) {
  return (
    <Flex direction="column" gap="2">
      {children}
    </Flex>
  );
}

// A control's width, as the setup page's fields have.
function Control({ children }: { children: ReactNode }) {
  return <Box style={{ maxWidth: 560 }}>{children}</Box>;
}

function LanguageField({
  value,
  onChange,
  disabled = false,
}: {
  value: SDKLanguage[];
  onChange: OnChange;
  disabled?: boolean;
}) {
  const options = Object.keys(languageMapping) as SDKLanguage[];
  // Connections created with several SDKs keep them; new picks are one SDK.
  if (value.length > 1) {
    return (
      <MultiSelectField
        size="lg"
        aria-label="SDK"
        disabled={disabled}
        value={value}
        onChange={(langs) => onChange(languagesPatch(langs as SDKLanguage[]))}
        options={options.map((l) => ({
          value: l,
          label: languageMapping[l].label,
        }))}
        formatOptionLabel={({ value: l }) => (
          <SDKLanguageLogo language={l as SDKLanguage} showLabel size={20} />
        )}
        sort={false}
      />
    );
  }
  return (
    <SelectField
      size="lg"
      aria-label="SDK"
      disabled={disabled}
      placeholder="Choose an SDK..."
      value={value[0]}
      onChange={(lang) => onChange(languagesPatch([lang as SDKLanguage]))}
      options={options.map((lang) => ({
        label: languageMapping[lang].label,
        value: lang,
      }))}
      sort={false}
      formatOptionLabel={({ value: lang }) => (
        <SDKLanguageLogo
          language={lang as SDKLanguage}
          showLabel
          size={20}
          hideExtra
        />
      )}
    />
  );
}

export const CONNECTION_ROWS: SettingRow[] = [
  {
    key: "sdk",
    label: "SDK",
    fields: ["languages"],
    shown: () => true,
    read: (v) => (
      <Box>
        <Flex align="center" gap="3" wrap="wrap">
          {v.languages.map((language) => (
            <SDKLanguageLogo
              key={language}
              language={language}
              showLabel
              size={16}
              hideExtra
            />
          ))}
        </Flex>
        <SDKPackageLink languages={v.languages} />
      </Box>
    ),
    edit: (v, onChange, disabled) => (
      <Control>
        <LanguageField
          value={v.languages}
          onChange={onChange}
          disabled={disabled}
        />
        <SDKPackageLink languages={v.languages} />
      </Control>
    ),
  },
  {
    key: "version",
    label: "SDK version",
    fields: ["sdkVersion"],
    shown: (v) => !!versionedLanguage(v.languages),
    read: (v) => (v.sdkVersion ? <Text>{v.sdkVersion}</Text> : <NoneValue />),
    edit: (v, onChange, disabled) => (
      <Control>
        <SDKVersionField
          value={v}
          onChange={onChange}
          hideLabel
          disabled={disabled}
        />
      </Control>
    ),
  },
  {
    key: "environment",
    label: "Environment",
    fields: ["environment"],
    shown: () => true,
    read: (v) => <Text>{v.environment}</Text>,
    edit: (v, onChange, disabled, { managedByVercel }) => (
      <Control>
        <EnvironmentField
          value={v}
          onChange={onChange}
          hideLabel
          disabled={disabled}
          managedByVercel={managedByVercel}
        />
      </Control>
    ),
  },
  {
    key: "projects",
    label: "Projects",
    fields: ["projects"],
    shown: () => true,
    read: (v, { projectName }) =>
      v.projects.length ? (
        <Text>
          {v.projects.map((id, i) => (
            <span key={id}>
              {i > 0 ? ", " : ""}
              {projectName(id)}
            </span>
          ))}
        </Text>
      ) : (
        <Text>All Projects</Text>
      ),
    edit: (
      v,
      onChange,
      disabled,
      { managedByVercel, requireProjectSelection },
    ) => (
      <Control>
        <ProjectsField
          value={v}
          onChange={onChange}
          hideLabel
          disabled={disabled}
          edit
          managedByVercel={managedByVercel}
          requireProjectSelection={requireProjectSelection}
        />
      </Control>
    ),
  },
  {
    key: "prerequisites",
    label: "Prerequisites",
    fields: ["includeReferencedPrerequisites"],
    shown: () => true,
    read: (v) => (
      <EnabledList
        items={[v.includeReferencedPrerequisites && <PrerequisitesLabel />]}
      />
    ),
    edit: (v, onChange, disabled) => (
      <Checkboxes>
        <PrerequisitesField value={v} onChange={onChange} disabled={disabled} />
      </Checkboxes>
    ),
  },
];

// How the payload is secured, and that choice's options.
const readCipherOptions: SettingRow["read"] = (v, { currentCaps }) => (
  <EnabledList
    items={[
      currentCaps.includes("encryption") &&
        v.encryptPayload &&
        "Encrypt payload",
      v.hashSecureAttributes && "Hash secure attributes",
    ]}
  />
);

export const SECURITY_ROWS: SettingRow[] = [
  {
    key: "security",
    label: CATEGORY_TITLES.payloadSecurity,
    // A plain payload's cipher options follow its delivery.
    fields: (v) =>
      v.delivery === "plain" ? ["delivery", ...CIPHER_FIELDS] : ["delivery"],
    shown: (v) => shouldShowPayloadSecurity(v.languages),
    read: (v) => <Text>{DELIVERY_LABELS[v.delivery]}</Text>,
    edit: (v, onChange, disabled) => (
      <PayloadSecurityField
        value={v}
        onChange={onChange}
        languages={v.languages}
        sdkVersion={v.sdkVersion}
        hideLabel
        disabled={disabled}
      />
    ),
  },
  {
    key: "cipherOptions",
    label: CIPHER_OPTIONS_TITLE,
    fields: (v) => (v.delivery === "ciphered" ? CIPHER_FIELDS : []),
    shown: (v) =>
      v.delivery === "ciphered" && shouldShowPayloadSecurity(v.languages),
    read: readCipherOptions,
    edit: (v, onChange, disabled) => (
      <Checkboxes>
        <CipherOptionsField
          value={v}
          onChange={onChange}
          languages={v.languages}
          sdkVersion={v.sdkVersion}
          hideLabel
          disabled={disabled}
        />
      </Checkboxes>
    ),
  },
  {
    key: "remoteOptions",
    label: REMOTE_EVAL_OPTIONS_TITLE,
    fields: (v) => (v.delivery === "remote" ? CIPHER_FIELDS : []),
    shown: (v) =>
      v.delivery === "remote" && shouldShowPayloadSecurity(v.languages),
    read: readCipherOptions,
    edit: (v, onChange, disabled) => (
      <RemoteEvalOptionsField
        value={v}
        onChange={onChange}
        languages={v.languages}
        sdkVersion={v.sdkVersion}
        hideLabel
        disabled={disabled}
      />
    ),
  },
];

export const PAYLOAD_ROWS: SettingRow[] = [
  {
    key: "experiments",
    label: CATEGORY_TITLES.experiments,
    fields: [
      "includeVisualExperiments",
      "includeRedirectExperiments",
      "includeExperimentNames",
    ],
    shown: () => true,
    read: (v, { latestCaps }) => (
      <EnabledList
        items={[
          latestCaps.includes("visualEditor") && v.includeVisualExperiments && (
            <VisualEditorLabel />
          ),
          latestCaps.includes("redirects") && v.includeRedirectExperiments && (
            <UrlRedirectLabel />
          ),
          !v.includeExperimentNames && <HideNamesLabel />,
        ]}
      />
    ),
    edit: (v, onChange, disabled) => (
      <Checkboxes>
        <ExperimentSettings
          value={v}
          onChange={onChange}
          disabled={disabled}
          languages={v.languages}
          sdkVersion={v.sdkVersion}
        />
      </Checkboxes>
    ),
  },
  {
    key: "savedGroups",
    label: CATEGORY_TITLES.savedGroups,
    fields: ["savedGroupFormat"],
    shown: (v, { currentCaps }) => currentCaps.includes("savedGroupReferences"),
    read: (v) => (
      <Text>
        {SETTING_TITLES.passByReference}:{" "}
        {SAVED_GROUP_FORMAT_LABELS[v.savedGroupFormat]}
      </Text>
    ),
    edit: (v, onChange, disabled, { storedSavedGroupFormat }) => (
      <Control>
        <SavedGroupFormatField
          value={v.savedGroupFormat}
          onChange={(savedGroupFormat) => onChange({ savedGroupFormat })}
          languages={v.languages}
          sdkVersion={v.sdkVersion}
          remoteEvalEnabled={v.delivery === "remote"}
          storedFormat={storedSavedGroupFormat}
          disabled={disabled}
        />
      </Control>
    ),
  },
  {
    key: "metadata",
    label: CATEGORY_TITLES.payloadMetadata,
    fields: [
      "includeProjectIdInMetadata",
      "includeCustomFieldsInMetadata",
      "allowedCustomFieldsInMetadata",
      "includeTagsInMetadata",
      "includeExperimentScheduleInMetadata",
    ],
    shown: () => true,
    read: (v, { customFieldName }) => (
      <EnabledList
        items={[
          v.includeProjectIdInMetadata && <ProjectIdsLabel />,
          v.includeCustomFieldsInMetadata && (
            <>
              <CustomFieldsLabel />
              {v.allowedCustomFieldsInMetadata.length ? (
                <Text color="text-mid">
                  {": "}
                  {v.allowedCustomFieldsInMetadata
                    .map(customFieldName)
                    .join(", ")}
                </Text>
              ) : null}
            </>
          ),
          v.includeTagsInMetadata && <TagsLabel />,
          v.includeExperimentScheduleInMetadata && <ScheduleDatesLabel />,
        ]}
      />
    ),
    edit: (v, onChange, disabled) => (
      <Control>
        <Checkboxes>
          <MetadataSettings value={v} onChange={onChange} disabled={disabled} />
        </Checkboxes>
      </Control>
    ),
  },
  {
    key: "observability",
    label: CATEGORY_TITLES.observability,
    fields: [
      "includeRuleIds",
      "includeDraftExperimentRefs",
      "includeDraftExperiments",
    ],
    shown: () => true,
    read: (v) => (
      <EnabledList
        items={[
          v.includeRuleIds && SETTING_TITLES.ruleIds,
          v.includeDraftExperimentRefs && <DraftRulesLabel />,
          v.includeDraftExperiments && <DraftExperimentsLabel />,
        ]}
      />
    ),
    edit: (v, onChange, disabled) => (
      <Checkboxes>
        <ObservabilitySettings
          value={v}
          onChange={onChange}
          disabled={disabled}
          languages={v.languages}
          sdkVersion={v.sdkVersion}
        />
      </Checkboxes>
    ),
  },
  {
    // Self-hosted configures the proxy via env vars, so this is cloud-only.
    key: "proxy",
    label: CATEGORY_TITLES.proxy,
    fields: ["proxyEnabled", "proxyHost"],
    shown: (v, { cloud }) => cloud,
    read: (v) =>
      v.proxyEnabled ? (
        <Text>
          {v.proxyHost || SETTING_TITLES.useProxy} <ProxyHostTooltip />
        </Text>
      ) : (
        <Text>Off</Text>
      ),
    edit: (v, onChange, disabled) => (
      <Control>
        <Checkboxes>
          <ProxySettings value={v} onChange={onChange} disabled={disabled} />
        </Checkboxes>
      </Control>
    ),
  },
  {
    key: "traces",
    label: "Traces",
    fields: ["tracesEnabled"],
    shown: (v, { showTraces }) => showTraces,
    read: (v) => <EnabledList items={[v.tracesEnabled && TRACES_TITLE]} />,
    edit: (v, onChange, disabled) => (
      <Checkboxes>
        <TracesSettings value={v} onChange={onChange} disabled={disabled} />
      </Checkboxes>
    ),
  },
];
