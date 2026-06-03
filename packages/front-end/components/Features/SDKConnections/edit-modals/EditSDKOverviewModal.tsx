import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { getLatestSDKVersion, getSDKVersions } from "shared/sdk-versioning";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import { LanguageFilter } from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { isCloud } from "@/services/env";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "./useSdkConnectionRevisionFlow";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="small"
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
  const [proxyEnabled, setProxyEnabled] = useState(!!connection.proxy?.enabled);
  const [proxyHost, setProxyHost] = useState(connection.proxy?.host ?? "");

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
        await save({
          name,
          languages,
          sdkVersion,
          environment,
          projects: selectedProjects,
          proxyEnabled,
          proxyHost,
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
          options={environments.map((env) => ({
            label: env.id,
            value: env.id,
          }))}
          required
          sort={false}
        />

        <MultiSelectField
          label="Projects"
          placeholder="All projects"
          value={selectedProjects}
          onChange={(p) => setSelectedProjects(p as string[])}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          helpText="Leave empty to serve every project allowed in the selected environment."
          sort={false}
          closeMenuOnSelect={true}
        />

        {isCloud() && (
          <Box>
            <GroupLabel>GrowthBook Proxy</GroupLabel>
            <Flex direction="column" gap="3">
              <Switch
                label="Use GrowthBook Proxy"
                description="Route SDK requests through a self-hosted proxy."
                value={proxyEnabled}
                onChange={setProxyEnabled}
              />
              {proxyEnabled && (
                <Field
                  label="Proxy Host URL"
                  placeholder="https://"
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                  helpText="Optional. Public URL of your proxy — lets GrowthBook push updates whenever feature definitions change."
                />
              )}
            </Flex>
          </Box>
        )}
      </Flex>
    </ModalStandard>
  );
}
