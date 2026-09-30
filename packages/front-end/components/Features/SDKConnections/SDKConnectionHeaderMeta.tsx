import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import { Flex } from "@radix-ui/themes";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import ProjectBadges from "@/components/ProjectBadges";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";

export default function SDKConnectionHeaderMeta({
  connection,
  canUpdate,
  onEditProjects,
}: {
  connection: SDKConnectionInterface;
  canUpdate?: boolean;
  onEditProjects?: () => void;
}) {
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const environment = environments.find((e) => e.id === connection.environment);

  // Mirrors the project display the connection diagram used: an "all env
  // projects" badge when the connection isn't scoped, and any projects the
  // environment disallows flagged inline.
  const envProjects = environment?.projects ?? [];
  const filteredProjectIds = filterProjectsByEnvironment(
    connection.projects ?? [],
    environment,
    true,
  );
  const showAllEnvironmentProjects =
    (connection.projects?.length ?? 0) === 0 && filteredProjectIds.length > 0;
  const disallowedProjects = getDisallowedProjects(
    projects,
    connection.projects ?? [],
    environment,
  );
  const disallowedProjectIds = disallowedProjects.map((p) => p.id);
  const filteredProjectIdsWithDisallowed = [
    ...filteredProjectIds,
    ...disallowedProjectIds,
  ];

  const languages = connection.languages ?? [];
  // Version only makes sense when a single language is selected.
  const sdkValue = languages.length ? (
    <Flex align="center" gap="3" wrap="wrap">
      {languages.map((language) => (
        <SDKLanguageLogo
          key={language}
          language={language}
          showLabel={true}
          size={18}
          version={languages.length === 1 ? connection.sdkVersion : undefined}
        />
      ))}
    </Flex>
  ) : (
    "None"
  );

  return (
    <Flex direction="column" gap="2" mt="2">
      <Flex align="center" gap="5" wrap="wrap">
        <Metadata label="SDK" value={sdkValue} />
        <Metadata
          label="Proxy"
          value={connection.proxy?.enabled ? "Enabled" : "Disabled"}
        />
        <Metadata label="API Host" value={getApiBaseUrl(connection)} />
      </Flex>
      <Flex align="center" gap="5" wrap="wrap">
        <Metadata label="Environment" value={connection.environment} />
        <Metadata
          label="Project"
          value={
            <Flex align="center" gap="2" wrap="wrap">
              {showAllEnvironmentProjects ? (
                <Badge
                  color="teal"
                  variant="solid"
                  label={`All env projects (${envProjects.length})`}
                />
              ) : (
                <ProjectBadges
                  projectIds={
                    filteredProjectIdsWithDisallowed.length
                      ? filteredProjectIdsWithDisallowed
                      : undefined
                  }
                  invalidProjectIds={disallowedProjectIds}
                  invalidProjectMessage="This project is not allowed in the selected environment and will not be included in the SDK payload."
                  resourceType="sdk connection"
                />
              )}
              {canUpdate && onEditProjects ? (
                <Link onClick={onEditProjects}>+ Add</Link>
              ) : null}
            </Flex>
          }
        />
      </Flex>
    </Flex>
  );
}
