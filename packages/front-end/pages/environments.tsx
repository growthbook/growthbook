import { useState, FC, useMemo } from "react";
import { Environment } from "shared/types/organization";
import { isProjectListValidForProject } from "shared/util";
import { BiShow } from "react-icons/bi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { FaRegCircleCheck, FaRegCircleXmark } from "react-icons/fa6";
import { ImBlocked } from "react-icons/im";
import { Flex, IconButton } from "@radix-ui/themes";
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

const EnvironmentsPage: FC = () => {
  const { project } = useDefinitions();

  const environments = useEnvironments();
  const filteredEnvironments = project
    ? environments.filter((env) =>
        isProjectListValidForProject(env.projects, project),
      )
    : environments;

  const { data: sdkConnectionData } = useSDKConnections();
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
            header={`'${filteredEnvironments[showConnectionsModal].id}' SDK Connections`}
            trackingEventModalType="show-environment-connections"
            close={() => setShowConnectionsModal(null)}
            open={true}
            closeCta="Close"
          >
            <Text as="p" mb="3">
              The following SDK connections use this environment.
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
        <Heading as="h1" size="x-large" mb="0">
          Environments
        </Heading>
        {canCreate && (
          <Button onClick={() => setModalOpen({})}>Add Environment</Button>
        )}
      </Flex>

      <Text as="p" color="text-mid" mb="3">
        Manage which environments are available for your feature flags.
      </Text>

      {filteredEnvironments.length > 0 ? (
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Environment</TableColumnHeader>
              <TableColumnHeader>Description</TableColumnHeader>
              <TableColumnHeader>Projects</TableColumnHeader>
              <TableColumnHeader>SDK Connections</TableColumnHeader>
              <TableColumnHeader>Default state</TableColumnHeader>
              <TableColumnHeader>Show on features page</TableColumnHeader>
              <TableColumnHeader style={{ width: 30 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEnvironments.map((e, i) => {
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
                        <BiShow /> {numConnections} connection
                        {numConnections === 1 ? "" : "s"}
                      </Link>
                    ) : (
                      <Tooltip body="No SDK connections use this environment.">
                        <span
                          className="nowrap"
                          style={{
                            color: "var(--gray-10)",
                            cursor: "not-allowed",
                          }}
                        >
                          <BiShow /> 0 connections
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Tooltip
                      body={
                        e.defaultState === false
                          ? "New features default to disabled"
                          : "New features default to enabled"
                      }
                    >
                      {e.defaultState === false ? (
                        <FaRegCircleXmark
                          style={{ color: "var(--gray-8)", fontSize: 18 }}
                        />
                      ) : (
                        <FaRegCircleCheck
                          style={{ color: "var(--green-9)", fontSize: 18 }}
                        />
                      )}
                    </Tooltip>
                  </TableCell>
                  <TableCell>{e.toggleOnList ? "yes" : ""}</TableCell>
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
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canMoveUp && (
                          <DropdownMenuItem onClick={() => moveTo(i - 1)}>
                            Move up
                          </DropdownMenuItem>
                        )}
                        {canMoveDown && (
                          <DropdownMenuItem onClick={() => moveTo(i + 1)}>
                            Move down
                          </DropdownMenuItem>
                        )}
                        {canShowDelete &&
                          (deleteBlocked ? (
                            <Tooltip
                              usePortal={true}
                              body={
                                <>
                                  <ImBlocked className="text-danger" /> This
                                  environment has{" "}
                                  <strong>
                                    {numConnections} SDK Connection
                                    {numConnections !== 1 && "s"}
                                  </strong>{" "}
                                  associated. This environment cannot be deleted
                                  until{" "}
                                  {numConnections === 1
                                    ? "it has"
                                    : "they have"}{" "}
                                  been removed.
                                </>
                              }
                            >
                              <span>
                                <DropdownMenuItem disabled color="red">
                                  Delete
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
                                  confirmationTitle: `Delete ${e.id} Environment`,
                                  cta: "Delete",
                                  getConfirmationContent: async () =>
                                    "Are you sure? This action cannot be undone.",
                                }}
                              >
                                Delete
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
        <p>Click the button below to add your first environment</p>
      ) : (
        <p>You don&apos;t have any environments defined yet.</p>
      )}
    </div>
  );
};
export default EnvironmentsPage;
