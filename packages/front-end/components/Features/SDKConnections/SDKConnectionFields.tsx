import { PiPackage, PiWarningFill } from "react-icons/pi";
import { SDKLanguage } from "shared/types/sdk-connection";
import {
  getDefaultSDKVersion,
  getLatestSDKVersion,
  getSDKVersions,
  isSDKOutdated,
} from "shared/sdk-versioning";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import { Box, Flex, Grid } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Badge from "@/ui/Badge";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import Tooltip from "@/ui/Tooltip";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import {
  getPackageRepositoryName,
  LanguageFilter,
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import PayloadSecurityField, {
  CipherOptionsField,
  PayloadSecurityValue,
  RemoteEvalOptionsField,
} from "@/components/Features/SDKConnections/PayloadSecurityField";
import {
  InfoTooltip,
  PrerequisitesLabel,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";

export type SDKConnectionFieldsValue = PayloadSecurityValue & {
  name: string;
  languages: SDKLanguage[];
  sdkVersion?: string;
  environment: string;
  projects: string[];
  includeReferencedPrerequisites: boolean;
};

type FieldsProps = {
  value: SDKConnectionFieldsValue;
  onChange: (patch: Partial<SDKConnectionFieldsValue>) => void;
  // Inline rows supply their own label.
  hideLabel?: boolean;
  disabled?: boolean;
};

// Where a single SDK is published, beside the SDK it names.
export function SDKPackageLink({ languages }: { languages: SDKLanguage[] }) {
  const language = languages.length === 1 ? languages[0] : undefined;
  const packageUrl = language ? languageMapping[language]?.packageUrl : null;
  if (!language || !packageUrl) return null;
  const packageName = languageMapping[language]?.packageName;
  const repositoryName = getPackageRepositoryName(packageUrl);
  return (
    <Text as="div" size="md" color="text-mid" mt="1">
      <PiPackage style={{ verticalAlign: "-0.15em" }} />{" "}
      <Link href={packageUrl} external>
        {packageName ?? repositoryName}
      </Link>
      {packageName ? ` on ${repositoryName}` : null}
    </Text>
  );
}

export function SDKVersionField({
  value,
  onChange,
  hideLabel,
  disabled,
}: FieldsProps) {
  const singleLanguage =
    value.languages.length === 1 ? value.languages[0] : undefined;
  if (!singleLanguage || /^(other|nocode-.*)$/.test(singleLanguage)) {
    return null;
  }
  const latestVersion = getLatestSDKVersion(singleLanguage);
  const usingLatestVersion = !isSDKOutdated(singleLanguage, value.sdkVersion);

  return (
    <Box>
      {/* Beside the select it changes, and only when there's a newer one. */}
      <Flex align="end" gap="2">
        <Box flexGrow="1" minWidth="0">
          {/* Stays on the legacy select: the version list must accept a
              typed-in version that isn't in the list yet. */}
          <SelectField
            size="md"
            label={hideLabel ? undefined : "SDK version"}
            aria-label="SDK version"
            sort={false}
            placeholder="0.0.0"
            options={getSDKVersions(singleLanguage).map((ver) => ({
              label: ver,
              value: ver,
            }))}
            createable={true}
            isClearable={false}
            disabled={disabled}
            value={value.sdkVersion || getDefaultSDKVersion(singleLanguage)}
            onChange={(v) => onChange({ sdkVersion: v })}
            formatOptionLabel={({ label }) => (
              <Flex align="center" justify="between" gap="2">
                <span>{label}</span>
                {label === latestVersion ? (
                  <Badge color="gray" variant="soft" label="LATEST" />
                ) : null}
              </Flex>
            )}
            containerStyle={{ marginBottom: 0 }}
          />
        </Box>
        {!usingLatestVersion && latestVersion && !disabled ? (
          <Button
            variant="soft"
            size="md"
            onClick={() => onChange({ sdkVersion: latestVersion })}
          >
            Use latest ({latestVersion})
          </Button>
        ) : null}
      </Flex>
    </Box>
  );
}

export function EnvironmentField({
  value,
  onChange,
  hideLabel,
  disabled,
  error,
  managedByVercel = false,
}: FieldsProps & { error?: string | null; managedByVercel?: boolean }) {
  const environments = useEnvironments();
  const filteredEnvironments = managedByVercel
    ? environments.filter(
        (e) =>
          !e.projects?.length ||
          (value.projects[0] && e.projects.includes(value.projects[0])),
      )
    : environments;

  return (
    <SelectField
      size="md"
      label={hideLabel ? undefined : "Environment"}
      aria-label="Environment"
      placeholder="Choose one..."
      error={error ?? undefined}
      disabled={disabled}
      value={value.environment}
      onChange={(env) =>
        onChange(
          managedByVercel
            ? { environment: env }
            : { environment: env, projects: [] },
        )
      }
      options={filteredEnvironments.map((env) => ({
        label: env.id,
        value: env.id,
      }))}
      sort={false}
      formatOptionLabel={({ value: id }) => {
        const numProjects =
          filteredEnvironments.find((e) => e.id === id)?.projects?.length ?? 0;
        return (
          <Flex align="baseline" justify="between" gap="3" width="100%">
            {id}
            <Text size="sm" color="text-mid">
              {numProjects > 0 ? (
                `Includes ${numProjects} project${numProjects === 1 ? "" : "s"}`
              ) : (
                <em>Includes all projects</em>
              )}
            </Text>
          </Flex>
        );
      }}
    />
  );
}

export function ProjectsField({
  value,
  onChange,
  hideLabel,
  disabled,
  edit,
  managedByVercel = false,
  requireProjectSelection = false,
}: FieldsProps & {
  edit: boolean;
  managedByVercel?: boolean;
  requireProjectSelection?: boolean;
}) {
  const { projects, getProjectById } = useDefinitions();
  const environments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();

  const selectedEnvironment = environments.find(
    (e) => e.id === value.environment,
  );
  const environmentHasProjects =
    (selectedEnvironment?.projects?.length ?? 0) > 0;
  const filteredProjectIds = filterProjectsByEnvironment(
    projects.map((p) => p.id),
    selectedEnvironment,
  );
  const filteredProjects = projects.filter((p) =>
    filteredProjectIds.includes(p.id),
  );
  const disallowedProjects = getDisallowedProjects(
    projects,
    value.projects,
    selectedEnvironment,
  );
  const permissionRequired = (project: string) =>
    edit
      ? permissionsUtil.canUpdateSDKConnection(
          { projects: [project], environment: value.environment },
          {},
        )
      : permissionsUtil.canCreateSDKConnection({
          projects: [project],
          environment: value.environment,
        });
  const permittedProjectOptions = useProjectOptions(
    permissionRequired,
    value.projects,
    [...filteredProjects, ...disallowedProjects],
  );
  const projectsOptions = [
    ...permittedProjectOptions,
    // Stale ids stay selectable so they can be removed.
    ...value.projects
      .filter((p) => !getProjectById(p))
      .map((p) => ({ label: "Invalid project", value: p })),
  ];

  return (
    <Box>
      <MultiSelectField
        size="md"
        label={
          hideLabel ? undefined : (
            <Flex align="center" gap="1" as="span">
              Filter by Projects
              <InfoTooltip
                content={`The dropdown below has been filtered to only include projects where you have permission to ${
                  edit ? "update" : "create"
                } SDK Connections.`}
              />
            </Flex>
          )
        }
        aria-label="Projects"
        placeholder={
          environmentHasProjects ? "All Environment Projects" : "All Projects"
        }
        value={value.projects}
        onChange={(p) => onChange({ projects: p })}
        options={projectsOptions}
        disabled={managedByVercel || disabled}
        required={requireProjectSelection}
        sort={false}
        closeMenuOnSelect={true}
        formatOptionLabel={({ value: id, label }) =>
          disallowedProjects.some((p) => p.id === id) ? (
            <Tooltip content="This project is not allowed in the selected environment and will not be included in the SDK payload.">
              <del style={{ color: "var(--red-11)" }}>
                <PiWarningFill /> {label}
              </del>
            </Tooltip>
          ) : (
            label
          )
        }
      />
      {requireProjectSelection && (
        <HelperText status="info" size="sm" mt="2">
          Your organization requires SDK Connections to belong to at least one
          project.
        </HelperText>
      )}
      {disallowedProjects.length > 0 && (
        <HelperText status="error" size="sm" mt="2">
          This SDK Connection references {disallowedProjects.length} project
          {disallowedProjects.length !== 1 && "s"} that{" "}
          {disallowedProjects.length === 1 ? "is" : "are"} not allowed in the
          selected environment. This may have occurred as a result of a project
          being removed from the selected environment.
        </HelperText>
      )}
    </Box>
  );
}

export function PrerequisitesField({ value, onChange, disabled }: FieldsProps) {
  return (
    <Checkbox
      weight="regular"
      disabled={disabled}
      value={value.includeReferencedPrerequisites}
      setValue={(val) => onChange({ includeReferencedPrerequisites: val })}
      label={<PrerequisitesLabel />}
    />
  );
}

export default function SDKConnectionFields({
  value,
  onChange,
  languageFilter,
  setLanguageFilter,
  languageError,
  environmentError,
  edit,
  managedByVercel = false,
  requireProjectSelection = false,
}: {
  value: SDKConnectionFieldsValue;
  onChange: (patch: Partial<SDKConnectionFieldsValue>) => void;
  languageFilter: LanguageFilter;
  setLanguageFilter: (f: LanguageFilter) => void;
  languageError?: string | null;
  environmentError?: string | null;
  edit: boolean;
  managedByVercel?: boolean;
  requireProjectSelection?: boolean;
}) {
  const singleLanguage =
    value.languages.length === 1 ? value.languages[0] : undefined;
  const showVersionPicker =
    !!singleLanguage && !/^(other|nocode-.*)$/.test(singleLanguage);

  return (
    <Flex direction="column" gap="4">
      <Field
        label="Name"
        placeholder="My Application"
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value })}
        required
        markRequired
        containerStyle={{ marginBottom: 0 }}
      />

      <Box>
        <Text as="div" weight="semibold" mb="2">
          SDK language
        </Text>
        {languageError ? (
          <HelperText status="error" mb="2">
            {languageError}
          </HelperText>
        ) : null}
        <SDKLanguageSelector
          value={value.languages}
          setValue={(langs) =>
            onChange(
              langs.length === 1
                ? {
                    languages: langs,
                    sdkVersion: getLatestSDKVersion(langs[0]),
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
        <SDKPackageLink languages={value.languages} />
      </Box>

      <Grid
        columns={{ initial: "1", sm: showVersionPicker ? "2" : "1" }}
        gap="4"
      >
        <SDKVersionField value={value} onChange={onChange} />
        <EnvironmentField
          value={value}
          onChange={onChange}
          error={environmentError}
          managedByVercel={managedByVercel}
        />
      </Grid>

      <Box>
        <ProjectsField
          value={value}
          onChange={onChange}
          edit={edit}
          managedByVercel={managedByVercel}
          requireProjectSelection={requireProjectSelection}
        />
        <Box mt="3">
          <PrerequisitesField value={value} onChange={onChange} />
        </Box>
      </Box>

      <PayloadSecurityField
        value={value}
        onChange={onChange}
        languages={value.languages}
        sdkVersion={value.sdkVersion}
      />
      <CipherOptionsField
        value={value}
        onChange={onChange}
        languages={value.languages}
        sdkVersion={value.sdkVersion}
      />
      <RemoteEvalOptionsField
        value={value}
        onChange={onChange}
        languages={value.languages}
        sdkVersion={value.sdkVersion}
      />
    </Flex>
  );
}
