import { SDKLanguage } from "shared/types/sdk-connection";
import {
  getLatestSDKVersion,
  getSDKVersions,
  isSDKOutdated,
} from "shared/sdk-versioning";
import { useEffect } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Tooltip from "@/components/Tooltip/Tooltip";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import {
  LanguageFilter,
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import PayloadSecurityField, {
  PayloadSecurityValue,
} from "@/components/Features/SDKConnections/PayloadSecurityField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";

export type SDKConnectionFieldsValue = PayloadSecurityValue & {
  name: string;
  languages: SDKLanguage[];
  sdkVersion?: string;
  environment: string;
  projects: string[];
};

/**
 * The connection fields shared by the create and edit modals, so the two can't
 * drift. Purely controlled: the modals own submission, the revision flow and
 * any capability sanitisation applied on save.
 */
export default function SDKConnectionFields({
  value,
  onChange,
  languageFilter,
  setLanguageFilter,
  languageError,
  disableScope = false,
  requireProjectSelection = false,
}: {
  value: SDKConnectionFieldsValue;
  onChange: (patch: Partial<SDKConnectionFieldsValue>) => void;
  languageFilter: LanguageFilter;
  setLanguageFilter: (f: LanguageFilter) => void;
  languageError?: string | null;
  /** Externally managed connections own their own scope. */
  disableScope?: boolean;
  requireProjectSelection?: boolean;
}) {
  const { projects } = useDefinitions();
  const environments = useEnvironments();

  const singleLanguage =
    value.languages.length === 1 ? value.languages[0] : undefined;
  const mapping = singleLanguage ? languageMapping[singleLanguage] : undefined;
  const showVersionPicker =
    !!singleLanguage && !mapping?.hideVersion && singleLanguage !== "other";
  const latestVersion = singleLanguage
    ? getLatestSDKVersion(singleLanguage)
    : undefined;
  // Offer a one-click jump to the newest version when the selected one is
  // behind, as the full form does.
  const versionOutdated =
    !!singleLanguage && isSDKOutdated(singleLanguage, value.sdkVersion);
  const selectedEnvironment = environments.find(
    (e) => e.id === value.environment,
  );
  const environmentHasProjects = !!selectedEnvironment?.projects?.length;

  // Pin the latest version as soon as a language that has versions is chosen.
  // The field already displayed `latestVersion` as a fallback, but the value
  // stayed unset, so a create could save a connection with no version at all.
  useEffect(() => {
    if (showVersionPicker && latestVersion && !value.sdkVersion) {
      onChange({ sdkVersion: latestVersion });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVersionPicker, latestVersion, value.sdkVersion]);

  return (
    <Flex direction="column" gap="4">
      <TextField
        label="Connection Name"
        placeholder="My Application"
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value })}
        required
        markRequired
      />

      <SDKLanguageSelector
        value={value.languages}
        setValue={(langs) =>
          // Only pin a version for a single language, as the full form does:
          // clearing it for a multi-language connection would drop a version
          // the connection legitimately still has.
          onChange(
            langs.length === 1
              ? {
                  languages: langs,
                  sdkVersion: getLatestSDKVersion(langs[0] as SDKLanguage),
                }
              : { languages: langs },
          )
        }
        multiple={value.languages.length > 1}
        includeOther={true}
        skipLabel={value.languages.length <= 1}
        hideShowAllLanguages={true}
        languageFilter={languageFilter}
        setLanguageFilter={setLanguageFilter}
      />
      {languageError ? (
        <HelperText status="error">{languageError}</HelperText>
      ) : null}

      <Grid
        columns={{ initial: "1", sm: showVersionPicker ? "2" : "1" }}
        gap="4"
      >
        {showVersionPicker && singleLanguage ? (
          <Box>
            {/* Stays on the legacy select: the version list must accept a
                typed-in version that isn't in the list yet. */}
            <SelectField
              label="SDK Version"
              sort={false}
              options={getSDKVersions(singleLanguage).map((ver) => ({
                label: ver,
                value: ver,
              }))}
              createable={true}
              isClearable={false}
              value={value.sdkVersion || latestVersion || ""}
              onChange={(v) => onChange({ sdkVersion: v })}
              formatOptionLabel={({ label }) => (
                <Flex align="center" justify="between" gap="2">
                  <span>{label}</span>
                  {label === latestVersion ? (
                    <Badge color="gray" variant="soft" label="LATEST" />
                  ) : null}
                </Flex>
              )}
            />
            {versionOutdated && latestVersion ? (
              <Link onClick={() => onChange({ sdkVersion: latestVersion })}>
                <Text size="sm">Use latest</Text>
              </Link>
            ) : null}
            {mapping?.packageUrl && mapping?.packageName ? (
              <Link
                href={mapping.packageUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Text size="sm">{mapping.packageName} on NPM</Text>
              </Link>
            ) : null}
          </Box>
        ) : null}
        <Select
          label="Environment"
          value={value.environment}
          setValue={(env) => onChange({ environment: env })}
          disabled={disableScope}
        >
          {environments.map((env) => (
            <SelectItem key={env.id} value={env.id}>
              {env.id}
              {!env.projects?.length ? (
                <Text size="sm" color="text-mid" ml="2">
                  Includes all projects
                </Text>
              ) : null}
            </SelectItem>
          ))}
        </Select>
      </Grid>

      <MultiSelectField
        label={
          (
            <Flex align="center" gap="1" as="span">
              Filter by Projects
              <Tooltip body="Only features and experiments in these projects are served by this connection. Leave empty to serve every project the environment allows." />
            </Flex>
          ) as unknown as string
        }
        placeholder={
          environmentHasProjects ? "All Environment Projects" : "All projects"
        }
        value={value.projects}
        onChange={(p) => onChange({ projects: p as string[] })}
        options={projects.map((p) => ({ label: p.name, value: p.id }))}
        disabled={disableScope}
        required={requireProjectSelection}
        sort={false}
        closeMenuOnSelect={true}
      />

      <PayloadSecurityField
        value={value}
        onChange={onChange}
        languages={value.languages}
        sdkVersion={value.sdkVersion}
      />
    </Flex>
  );
}
