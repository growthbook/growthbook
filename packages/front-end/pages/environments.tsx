import { useState, FC, useMemo } from "react";
import { Environment } from "shared/types/organization";
import {
  isProductionEnvironment,
  isProjectListValidForProject,
} from "shared/util";
import { BiShow } from "react-icons/bi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { ImBlocked } from "react-icons/im";
import { PiCheckCircle, PiXCircle } from "react-icons/pi";
import { Flex, IconButton } from "@radix-ui/themes";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import useSDKConnections from "@/hooks/useSDKConnections";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import EnvironmentModal from "@/components/Settings/EnvironmentModal";
import EnvironmentConnectionsList from "@/components/Settings/EnvironmentConnectionsList";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const BooleanStatusIcon: FC<{ value: boolean; tooltip: string }> = ({
  value,
  tooltip,
}) => (
  <Tooltip body={tooltip}>
    {value ? (
      <PiCheckCircle style={{ color: "var(--green-9)", fontSize: 18 }} />
    ) : (
      <PiXCircle style={{ color: "var(--gray-8)", fontSize: 18 }} />
    )}
  </Tooltip>
);

const EnvironmentsPage: FC = () => {
  const { t } = useLingui();
  const { project } = useDefinitions();

  const environments = useEnvironments();
  const filteredEnvironments = project
    ? environments.filter((env) =>
        isProjectListValidForProject(env.projects, project),
      )
    : environments;

  const { data: sdkConnectionData } = useSDKConnections({
    includeArchived: true,
  });
  const sdkConnectionsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    sdkConnectionData?.connections?.forEach((c) => {
      map[c.environment] = map[c.environment] || [];
      map[c.environment].push(c.id);
    });
    return map;
  }, [sdkConnectionData]);

  const [showConnectionsModal, setShowConnectionsModal] = useState<
    number | null
  >(null);

  const { refreshOrganization } = useUser();
  // const permissions = usePermissions();
  const permissionsUtil = usePermissionsUtil();
  // See if the user has access to a random environment name that doesn't exist yet
  // If yes, then they can create new environments
  const canCreate = permissionsUtil.canCreateEnvironment({
    id: "",
    projects: [project],
  });

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<Environment> | null>(null);
  const connectionsEnvId =
    showConnectionsModal !== null
      ? (filteredEnvironments[showConnectionsModal]?.id ?? "")
      : "";

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <EnvironmentModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => {
            refreshOrganization();
          }}
        />
      )}
      {showConnectionsModal !== null &&
        filteredEnvironments[showConnectionsModal] && (
          <Modal
            header={t`'${connectionsEnvId}' SDK Connections`}
            trackingEventModalType="show-environment-connections"
            close={() => setShowConnectionsModal(null)}
            open={true}
            closeCta={t`Close`}
          >
            <Text as="p" mb="3">
              <Trans>The following SDK connections use this environment.</Trans>
            </Text>
            <EnvironmentConnectionsList
              connections={(sdkConnectionData?.connections ?? []).filter((c) =>
                (
                  sdkConnectionsMap?.[
                    filteredEnvironments[showConnectionsModal].id
                  ] || []
                ).includes(c.id),
              )}
            />
          </Modal>
        )}
      <Flex align="center" justify="between" mb="1">
        <Heading as="h1" size="xl" mb="2">
          <Trans>Environments</Trans>
        </Heading>
        {canCreate && (
          <Button onClick={() => setModalOpen({})}>
            <Trans>Add Environment</Trans>
          </Button>
        )}
      </Flex>

      <Text as="p" color="text-mid" mb="3">
        <Trans>
          Manage which environments are available for your feature flags.
        </Trans>
      </Text>

      {filteredEnvironments.length > 0 ? (
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>
                <Trans>Environment</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>Description</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>Projects</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>SDK Connections</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>Default state</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>Production</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>Show on features page</Trans>
              </TableColumnHeader>
              <TableColumnHeader style={{ width: 30 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEnvironments.map((e, i) => {
              const envId = e.id;
              const canEdit = permissionsUtil.canUpdateEnvironment(e, {});
              const canDelete = permissionsUtil.canDeleteEnvironment(e);
              const sdkConnectionIds = sdkConnectionsMap?.[e.id] || [];
              const numConnections = sdkConnectionIds.length;
              const canMoveUp = canEdit && i > 0;
              const canMoveDown =
                canEdit && i < filteredEnvironments.length - 1;
              const canShowDelete = environments.length > 1 && canDelete;
              const deleteBlocked = numConnections > 0;
              const moveTo = async (targetIndex: number) => {
                const targetEnv = filteredEnvironments[targetIndex];
                const newIndex = environments.findIndex(
                  (env) => targetEnv.id === env.id,
                );
                await apiCall(`/environment/order`, {
                  method: "PUT",
                  body: JSON.stringify({ envId: e.id, newIndex }),
                });
                refreshOrganization();
              };
              return (
                <TableRow key={e.id}>
                  <TableCell>{e.id}</TableCell>
                  <TableCell>{e.description}</TableCell>
                  <TableCell>
                    {(e?.projects?.length || 0) > 0 ? (
                      <ProjectBadges
                        resourceType="environment"
                        projectIds={e.projects}
                      />
                    ) : (
                      <ProjectBadges resourceType="environment" />
                    )}
                  </TableCell>
                  <TableCell>
                    {numConnections > 0 ? (
                      <Link
                        onClick={() => setShowConnectionsModal(i)}
                        className="nowrap"
                      >
                        <BiShow />{" "}
                        <Plural
                          value={numConnections}
                          one="# connection"
                          other="# connections"
                        />
                      </Link>
                    ) : (
                      <Tooltip
                        body={t`No SDK connections use this environment.`}
                      >
                        <span
                          className="nowrap"
                          style={{
                            color: "var(--gray-10)",
                            cursor: "not-allowed",
                          }}
                        >
                          <BiShow /> <Trans>0 connections</Trans>
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <BooleanStatusIcon
                      value={e.defaultState !== false}
                      tooltip={
                        e.defaultState === false
                          ? t`New features default to disabled`
                          : t`New features default to enabled`
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <BooleanStatusIcon
                      value={isProductionEnvironment(e)}
                      tooltip={
                        isProductionEnvironment(e)
                          ? t`Production environment`
                          : t`Non-production environment`
                      }
                    />
                  </TableCell>
                  <TableCell>{e.toggleOnList ? t`yes` : ""}</TableCell>
                  <TableCell>
                    <DropdownMenu
                      trigger={
                        <IconButton
                          variant="ghost"
                          color="gray"
                          radius="full"
                          size="2"
                          highContrast
                        >
                          <BsThreeDotsVertical size={18} />
                        </IconButton>
                      }
                      menuPlacement="end"
                      variant="soft"
                    >
                      <DropdownMenuGroup>
                        {canEdit && (
                          <DropdownMenuItem onClick={() => setModalOpen(e)}>
                            <Trans>Edit</Trans>
                          </DropdownMenuItem>
                        )}
                        {canMoveUp && (
                          <DropdownMenuItem onClick={() => moveTo(i - 1)}>
                            <Trans>Move up</Trans>
                          </DropdownMenuItem>
                        )}
                        {canMoveDown && (
                          <DropdownMenuItem onClick={() => moveTo(i + 1)}>
                            <Trans>Move down</Trans>
                          </DropdownMenuItem>
                        )}
                        {canShowDelete &&
                          (deleteBlocked ? (
                            <Tooltip
                              usePortal={true}
                              body={
                                <>
                                  <ImBlocked className="text-danger" />{" "}
                                  {numConnections === 1 ? (
                                    <Trans>
                                      This environment has{" "}
                                      <strong>
                                        {numConnections} SDK Connection
                                      </strong>{" "}
                                      associated. This environment cannot be
                                      deleted until it has been removed.
                                    </Trans>
                                  ) : (
                                    <Trans>
                                      This environment has{" "}
                                      <strong>
                                        {numConnections} SDK Connections
                                      </strong>{" "}
                                      associated. This environment cannot be
                                      deleted until they have been removed.
                                    </Trans>
                                  )}
                                </>
                              }
                            >
                              <span>
                                <DropdownMenuItem disabled color="red">
                                  <Trans>Delete</Trans>
                                </DropdownMenuItem>
                              </span>
                            </Tooltip>
                          ) : (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                color="red"
                                confirmation={{
                                  submit: async () => {
                                    await apiCall(`/environment/${e.id}`, {
                                      method: "DELETE",
                                      body: JSON.stringify({
                                        settings: {
                                          environments: environments.filter(
                                            (env) => env.id !== e.id,
                                          ),
                                        },
                                      }),
                                    });
                                    refreshOrganization();
                                  },
                                  confirmationTitle: t`Delete ${envId} Environment`,
                                  cta: t`Delete`,
                                  getConfirmationContent: async () =>
                                    t`Are you sure? This action cannot be undone.`,
                                }}
                              >
                                <Trans>Delete</Trans>
                              </DropdownMenuItem>
                            </>
                          ))}
                      </DropdownMenuGroup>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : canCreate ? (
        <p>
          <Trans>Click the button below to add your first environment</Trans>
        </p>
      ) : (
        <p>
          <Trans>You don&apos;t have any environments defined yet.</Trans>
        </p>
      )}
    </div>
  );
};
export default EnvironmentsPage;
