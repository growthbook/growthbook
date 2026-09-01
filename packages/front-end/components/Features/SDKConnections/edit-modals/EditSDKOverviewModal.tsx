import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { getLatestSDKVersion, getSDKVersions } from "shared/sdk-versioning";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { filterProjectsByEnvironment } from "shared/util";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import { LanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "./useSdkConnectionRevisionFlow";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="sm"
      weight="semibold"
      color="text-mid"
      textTransform="uppercase"
      as="div"
      mb="2"
    >
      {children}
    </Text>
  );
}

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
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const { draftSelector, save } = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    ...revisionProps,
  });

  const [name, setName] = useState(connection.name);
  const [languages, setLanguages] = useState<SDKLanguage[]>(
    connection.languages as SDKLanguage[],
  );
  const [sdkVersion, setSdkVersion] = useState<string | undefined>(
    connection.sdkVersion,
  );
  const [languageFilter, setLanguageFilter] =
    useState<LanguageFilter>("popular");
  const [environment, setEnvironment] = useState(connection.environment);
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    connection.projects ?? [],
  );

  const settings = useOrgSettings();
  // Vercel-managed connections own their scope, so those fields are read-only.
  const isExternallyManaged = connection.managedBy?.type === "vercel";
  const selectedEnvironment = environments.find((e) => e.id === environment);
  const environmentHasProjects = !!selectedEnvironment?.projects?.length;
  // Externally managed connections may only sit in environments that allow
  // their projects, matching the full form.
  const filteredEnvironments = isExternallyManaged
    ? environments.filter(
        (e) =>
          !e.projects?.length ||
          (connection.projects ?? []).some((p) => e.projects?.includes(p)),
      )
    : environments;
  const allowedProjectIds = filterProjectsByEnvironment(
    projects.map((p) => p.id),
    selectedEnvironment,
    true,
  );
  // An org can mandate a project; on edit only when one was already set, so
  // existing unscoped connections aren't blocked from unrelated edits.
  const requireProjectSelection =
    !!settings.requireProjectForSdkConnections &&
    (connection.projects?.length ?? 0) > 0;
  const singleLanguage = languages.length === 1 ? languages[0] : undefined;
  const showVersionPicker =
    !!singleLanguage && !/^(other|nocode-.*)$/.test(singleLanguage);

  return (
    <ModalStandard
      trackingEventModalType="edit-sdk-overview"
      open={true}
      close={close}
      header="Edit Connection"
      size="lg"
      submit={async () => {
        // Every capability lookup reads languages[0], so a connection without
        // one breaks downstream. The full form blocks this too.
        if (!languages.length) {
          throw new Error("Please select an SDK language");
        }
        await save({
          name,
          languages,
          sdkVersion,
          environment,
          projects: selectedProjects,
        });
      }}
      cta="Save"
    >
      <Flex direction="column" gap="4" style={{ minWidth: 0, width: "100%" }}>
        {draftSelector}
        <Field
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <Box>
          <GroupLabel>SDK Languages</GroupLabel>
          <SDKLanguageSelector
            value={languages}
            setValue={(langs) => {
              setLanguages(langs);
              setSdkVersion(
                langs.length === 1
                  ? getLatestSDKVersion(langs[0] as SDKLanguage)
                  : undefined,
              );
            }}
            multiple={languages.length > 1}
            includeOther={true}
            skipLabel={languages.length <= 1}
            hideShowAllLanguages={true}
            languageFilter={languageFilter}
            setLanguageFilter={setLanguageFilter}
          />
        </Box>

        {showVersionPicker && singleLanguage && (
          <Box>
            <GroupLabel>SDK Version</GroupLabel>
            <SelectField
              style={{ width: 220 }}
              placeholder="0.0.0"
              sort={false}
              options={getSDKVersions(singleLanguage).map((ver) => ({
                label: ver,
                value: ver,
              }))}
              createable={true}
              isClearable={false}
              value={sdkVersion || getLatestSDKVersion(singleLanguage)}
              onChange={(v) => setSdkVersion(v)}
            />
          </Box>
        )}

        <SelectField
          label="Environment"
          value={environment}
          onChange={setEnvironment}
          options={filteredEnvironments.map((env) => ({
            label: env.id,
            value: env.id,
          }))}
          disabled={isExternallyManaged}
          required
          sort={false}
        />

        <MultiSelectField
          label="Projects"
          placeholder={
            environmentHasProjects ? "All Environment Projects" : "All Projects"
          }
          value={selectedProjects}
          onChange={(p) => setSelectedProjects(p as string[])}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          disabled={isExternallyManaged}
          required={requireProjectSelection}
          // Flag projects the chosen environment excludes, as the full form does:
          // they'd be silently dropped from the SDK payload otherwise.
          formatOptionLabel={({ value, label }) =>
            !allowedProjectIds.includes(value) ? (
              <Tooltip body="This project is not allowed in the selected environment and will not be included in the SDK payload.">
                <span className="text-danger">{label}</span>
              </Tooltip>
            ) : (
              label
            )
          }
          helpText="Leave empty to serve every project allowed in the selected environment."
          sort={false}
          closeMenuOnSelect={true}
        />
      </Flex>
    </ModalStandard>
  );
}
