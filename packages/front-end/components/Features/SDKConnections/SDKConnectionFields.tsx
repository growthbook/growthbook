import { PiPackage } from "react-icons/pi";
import { FaExclamationTriangle } from "react-icons/fa";
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
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import { Select, SelectItem } from "@/ui/Select";
import Tooltip from "@/components/Tooltip/Tooltip";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import {
  getPackageRepositoryName,
  LanguageFilter,
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import PayloadSecurityField, {
  PayloadSecurityValue,
} from "@/components/Features/SDKConnections/PayloadSecurityField";
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
};

/**
 * The connection fields shared by the create and edit modals, so the two can't
 * drift. Purely controlled: the modals own submission, the revision flow and
 * any capability sanitisation applied on save. Behaviour follows the full form:
 * the version picker, environment list and project list are gated and filtered
 * exactly as it gates and filters them.
 */
export default function SDKConnectionFields({
  value,
  onChange,
  languageFilter,
  setLanguageFilter,
  languageError,
  edit,
  managedByVercel = false,
  requireProjectSelection = false,
}: {
  value: SDKConnectionFieldsValue;
  onChange: (patch: Partial<SDKConnectionFieldsValue>) => void;
  languageFilter: LanguageFilter;
  setLanguageFilter: (f: LanguageFilter) => void;
  languageError?: string | null;
  /** Picks the permission that filters the project list, as the full form does. */
  edit: boolean;
  /**
   * Vercel owns the connection's scope: only environments that can serve its
   * project are offered, and the projects can't be changed.
   */
  managedByVercel?: boolean;
  requireProjectSelection?: boolean;
}) {
  const { projects, getProjectById } = useDefinitions();
  const environments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();

  const singleLanguage =
    value.languages.length === 1 ? value.languages[0] : undefined;
  // The full form's rule: no version picker for "other" or the no-code SDKs.
  const showVersionPicker =
    !!singleLanguage && !/^(other|nocode-.*)$/.test(singleLanguage);
  const latestVersion = singleLanguage
    ? getLatestSDKVersion(singleLanguage)
    : undefined;
  const usingLatestVersion =
    !singleLanguage || !isSDKOutdated(singleLanguage, value.sdkVersion);
  const packageUrl = singleLanguage
    ? languageMapping[singleLanguage]?.packageUrl
    : undefined;
  const packageName = singleLanguage
    ? languageMapping[singleLanguage]?.packageName
    : undefined;

  const selectedEnvironment = environments.find(
    (e) => e.id === value.environment,
  );
  const environmentHasProjects =
    (selectedEnvironment?.projects?.length ?? 0) > 0;
  const filteredEnvironments = managedByVercel
    ? environments.filter(
        (e) =>
          !e.projects?.length ||
          (value.projects[0] && e.projects.includes(value.projects[0])),
      )
    : environments;

  // Only projects the environment serves and the user may act on, plus any
  // already selected so they can be removed.
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
          // A single language pins its latest version, as the full form does.
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
              placeholder="0.0.0"
              options={getSDKVersions(singleLanguage).map((ver) => ({
                label: ver,
                value: ver,
              }))}
              createable={true}
              isClearable={false}
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
            />
            <Flex align="start" gap="4" wrap="wrap">
              {!usingLatestVersion && latestVersion ? (
                <Link onClick={() => onChange({ sdkVersion: latestVersion })}>
                  <Text size="sm">Use latest</Text>
                </Link>
              ) : null}
              {packageUrl ? (
                <Box>
                  <Link href={packageUrl} target="_blank" rel="noreferrer">
                    <Text size="sm">
                      <PiPackage style={{ verticalAlign: "-0.15em" }} />{" "}
                      {getPackageRepositoryName(packageUrl)}
                    </Text>
                  </Link>
                  {packageName ? (
                    <Text as="div" size="sm" color="text-mid">
                      <code>{packageName}</code>
                    </Text>
                  ) : null}
                </Box>
              ) : null}
            </Flex>
          </Box>
        ) : null}
        <Select
          label="Environment"
          placeholder="Choose one..."
          value={value.environment}
          setValue={(env) =>
            // Changing environment resets the project filter, unless Vercel
            // owns the scope.
            onChange(
              managedByVercel
                ? { environment: env }
                : { environment: env, projects: [] },
            )
          }
        >
          {filteredEnvironments.map((env) => {
            const numProjects = env.projects?.length ?? 0;
            return (
              <SelectItem key={env.id} value={env.id}>
                {env.id}
                <Text size="sm" color="text-mid" ml="2">
                  {numProjects > 0 ? (
                    `Includes ${numProjects} project${
                      numProjects === 1 ? "" : "s"
                    }`
                  ) : (
                    <em>Includes all projects</em>
                  )}
                </Text>
              </SelectItem>
            );
          })}
        </Select>
      </Grid>

      <Box>
        <MultiSelectField
          label={
            (
              <Flex align="center" gap="1" as="span">
                Filter by Projects
                <Tooltip
                  body={`The dropdown below has been filtered to only include projects where you have permission to ${
                    edit ? "update" : "create"
                  } SDK Connections.`}
                />
              </Flex>
            ) as unknown as string
          }
          placeholder={
            environmentHasProjects ? "All Environment Projects" : "All Projects"
          }
          value={value.projects}
          onChange={(p) => onChange({ projects: p as string[] })}
          options={projectsOptions}
          disabled={managedByVercel}
          required={requireProjectSelection}
          sort={false}
          closeMenuOnSelect={true}
          formatOptionLabel={({ value: id, label }) =>
            disallowedProjects.some((p) => p.id === id) ? (
              <Tooltip body="This project is not allowed in the selected environment and will not be included in the SDK payload.">
                <del style={{ color: "var(--red-11)" }}>
                  <FaExclamationTriangle /> {label}
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
            selected environment. This may have occurred as a result of a
            project being removed from the selected environment.
          </HelperText>
        )}
      </Box>

      <PayloadSecurityField
        value={value}
        onChange={onChange}
        languages={value.languages}
        sdkVersion={value.sdkVersion}
      />
    </Flex>
  );
}
