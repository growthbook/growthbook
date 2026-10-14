import React, { useState } from "react";
import { PiWarningFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import useSDKWebhooks from "@/hooks/useSDKWebhooks";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { capitalizeFirstLetter } from "@/services/utils";
import Callout from "@/ui/Callout";
import { Popover } from "@/ui/Popover";
import UITooltip from "@/ui/Tooltip";
import { ExperimentDot } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import SDKLanguageLogo from "./SDKLanguageLogo";
import EnvironmentProjectsBadge from "./EnvironmentProjectsBadge";
import WebhookErrorDetails from "./WebhookErrorDetails";
import SDKConnectionForm from "./SDKConnectionForm";
import { PayloadSizeRowWarning } from "./PayloadSizeNotices";

const webhookCount = (n: number) => `${n} webhook${n === 1 ? "" : "s"}`;

export default function SDKConnectionsList() {
  const { data, mutate, error } = useSDKConnections();
  const { data: webhooksData, mutate: mutateWebhooks } = useSDKWebhooks();
  const connections = data?.connections ?? [];

  const [modalOpen, setModalOpen] = useState(false);

  const environments = useEnvironments();
  const { projects, project } = useDefinitions();

  const permissionsUtil = usePermissionsUtil();

  const canCreateSDKConnections =
    permissionsUtil.canViewCreateSDKConnectionModal(project);

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      {modalOpen && (
        <SDKConnectionForm
          initialValue={{
            languages: [],
            includeRuleIds: true,
          }}
          close={() => setModalOpen(false)}
          mutate={() => {
            mutate();
            mutateWebhooks();
          }}
          edit={false}
        />
      )}

      <Flex align="center" justify="between" gap="3" mt="4" mb="2">
        <Box style={{ flex: 1 }}>
          <h1>SDK Connections</h1>
        </Box>
        {canCreateSDKConnections && connections.length > 0 ? (
          <Button onClick={() => setModalOpen(true)}>Add SDK Connection</Button>
        ) : null}
      </Flex>

      {connections.length === 0 ? (
        <EmptyState
          title="Connect your apps"
          description={
            canCreateSDKConnections
              ? "SDK Connections make it easy to integrate GrowthBook into your front-end, back-end, or mobile application."
              : "You don't have permission to create SDK Connections. Contact your account administrator."
          }
          leftButton={null}
          rightButton={
            canCreateSDKConnections ? (
              <Button onClick={() => setModalOpen(true)}>
                Add SDK Connection
              </Button>
            ) : null
          }
        />
      ) : null}

      {connections.length > 0 && (
        <Table variant="list" stickyHeader roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: 40 }} />
              <TableColumnHeader style={{ width: "30%" }}>
                Name
              </TableColumnHeader>
              {projects.length > 0 && (
                <TableColumnHeader style={{ width: "20%" }}>
                  Projects
                </TableColumnHeader>
              )}
              <TableColumnHeader>Environment</TableColumnHeader>
              <TableColumnHeader>Webhooks</TableColumnHeader>
              <TableColumnHeader>Language</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((connection) => {
              const hasProxy =
                connection.proxy.enabled && !!connection.proxy.host;
              const connected =
                connection.connected &&
                (!hasProxy || connection.proxy.connected);

              const environment = environments.find(
                (e) => e.id === connection.environment,
              );
              const envProjects = environment?.projects ?? [];
              const filteredProjectIds = filterProjectsByEnvironment(
                connection.projects,
                environment,
                true,
              );
              const showAllEnvironmentProjects =
                connection.projects.length === 0 &&
                filteredProjectIds.length > 0;
              const disallowedProjects = getDisallowedProjects(
                projects,
                connection?.projects ?? [],
                environment,
              );
              const disallowedProjectIds = disallowedProjects.map((p) => p.id);
              const filteredProjectIdsWithDisallowed = [
                ...filteredProjectIds,
                ...disallowedProjectIds,
              ];

              const webhooks = webhooksData?.connections?.[connection.id];
              const webhooksWithErrors = webhooks?.filter((w) => w.error);

              return (
                <TableRow key={connection.id}>
                  <TableCell>
                    <UITooltip
                      content={
                        connected
                          ? "Connected successfully"
                          : "Could not verify the connection"
                      }
                    >
                      <Flex align="center" justify="center">
                        <ExperimentDot color={connected ? "green" : "amber"} />
                      </Flex>
                    </UITooltip>
                  </TableCell>
                  <TableCell style={{ wordBreak: "break-word" }}>
                    <Link
                      href={`/sdks/${connection.id}`}
                      style={{ color: "var(--gray-12)" }}
                    >
                      {connection.name}
                    </Link>
                    <PayloadSizeRowWarning connection={connection} />
                    {connection.managedBy?.type ? (
                      <Box mt="1">
                        <Badge
                          label={`Managed by ${capitalizeFirstLetter(
                            connection.managedBy.type,
                          )}`}
                        />
                      </Box>
                    ) : null}
                  </TableCell>
                  {projects.length > 0 && (
                    <TableCell>
                      {showAllEnvironmentProjects ? (
                        <EnvironmentProjectsBadge
                          environment={connection.environment}
                          projectIds={envProjects}
                        />
                      ) : (
                        <Flex wrap="wrap" align="center" gap="2">
                          <ProjectBadges
                            projectIds={
                              filteredProjectIdsWithDisallowed.length
                                ? filteredProjectIdsWithDisallowed
                                : undefined
                            }
                            invalidProjectIds={disallowedProjectIds}
                            invalidProjectMessage="This project is not allowed in the selected environment and will not be included in the SDK payload."
                            resourceType="sdk connection"
                            skipMargin={true}
                          />
                        </Flex>
                      )}
                    </TableCell>
                  )}
                  <TableCell>{connection.environment}</TableCell>
                  <TableCell>
                    {webhooksWithErrors?.length ? (
                      <Popover
                        openOnHover
                        side="bottom"
                        contentStyle={{ maxWidth: 420 }}
                        trigger={
                          <Flex
                            display="inline-flex"
                            align="center"
                            gap="1"
                            style={{ whiteSpace: "nowrap", cursor: "default" }}
                          >
                            <PiWarningFill color="var(--red-11)" />
                            {webhookCount(webhooks?.length ?? 0)}
                          </Flex>
                        }
                        content={
                          <Flex direction="column" gap="3">
                            {webhooksWithErrors.map((webhook) => (
                              <WebhookErrorDetails
                                key={webhook.id}
                                name={webhook.name}
                                error={webhook.error}
                              />
                            ))}
                          </Flex>
                        }
                      />
                    ) : webhooks?.length ? (
                      webhookCount(webhooks.length)
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Flex wrap="wrap" gap="2">
                      {connection.languages.map((language) => (
                        <SDKLanguageLogo
                          key={language}
                          language={language}
                          hideExtra={true}
                          version={
                            connection.languages?.length === 1
                              ? connection.sdkVersion
                              : undefined
                          }
                        />
                      ))}
                    </Flex>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
