import { useState, FC, useMemo } from "react";
import { Environment } from "shared/types/organization";
import { isProjectListValidForProject } from "shared/util";
import { BiShow } from "react-icons/bi";
import { ImBlocked } from "react-icons/im";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import useSDKConnections from "@/hooks/useSDKConnections";
import OldButton from "@/components/Button";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import EnvironmentModal from "@/components/Settings/EnvironmentModal";
import EnvironmentConnectionsList from "@/components/Settings/EnvironmentConnectionsList";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Link from "@/ui/Link";

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
            useRadixButton={true}
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
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h1 className="mb-0">Environments</h1>
        </div>
        {canCreate && (
          <div className="col-auto ml-auto">
            <Button onClick={() => setModalOpen({})}>Add Environment</Button>
          </div>
        )}
      </div>

      <p className="text-gray mb-3">
        Manage which environments are available for your feature flags.
      </p>

      {filteredEnvironments.length > 0 ? (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Description</th>
              <th className="col-2">Projects</th>
              <th>SDK Connections</th>
              <th>Default state</th>
              <th>Show toggle on feature list</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredEnvironments.map((e, i) => {
              const canEdit = permissionsUtil.canUpdateEnvironment(e, {});
              const canDelete = permissionsUtil.canDeleteEnvironment(e);
              const sdkConnectionIds = sdkConnectionsMap?.[e.id] || [];
              const numConnections = sdkConnectionIds.length;
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.description}</td>
                  <td>
                    {(e?.projects?.length || 0) > 0 ? (
                      <ProjectBadges
                        resourceType="environment"
                        projectIds={e.projects}
                      />
                    ) : (
                      <ProjectBadges resourceType="environment" />
                    )}
                  </td>
                  <td>
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
                  </td>
                  <td>{e.defaultState === false ? "off" : "on"}</td>
                  <td>{e.toggleOnList ? "yes" : "no"}</td>
                  <td style={{ width: 30 }}>
                    <MoreMenu>
                      {canEdit && (
                        <button
                          className="dropdown-item"
                          onClick={(ev) => {
                            ev.preventDefault();
                            setModalOpen(e);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {canEdit ? (
                        <>
                          {i > 0 && (
                            <OldButton
                              color=""
                              className="dropdown-item"
                              onClick={async () => {
                                const targetEnv = filteredEnvironments[i - 1];
                                const newIndex = environments.findIndex(
                                  (env) => targetEnv.id === env.id,
                                );
                                await apiCall(`/environment/order`, {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    envId: e.id,
                                    newIndex, // this is the filteredEnvironments index  we are moving it on
                                  }),
                                });
                                refreshOrganization();
                              }}
                            >
                              Move up
                            </OldButton>
                          )}
                          {i < filteredEnvironments.length - 1 && (
                            <OldButton
                              color=""
                              className="dropdown-item"
                              onClick={async () => {
                                const targetEnv = filteredEnvironments[i + 1];
                                const newIndex = environments.findIndex(
                                  (env) => targetEnv.id === env.id,
                                );
                                await apiCall(`/environment/order`, {
                                  method: "PUT",
                                  body: JSON.stringify({
                                    envId: e.id,
                                    newIndex, // this is the filteredEnvironments index  we are moving it on
                                  }),
                                });
                                refreshOrganization();
                              }}
                            >
                              Move down
                            </OldButton>
                          )}
                        </>
                      ) : null}
                      {environments.length > 1 && canDelete && (
                        <Tooltip
                          shouldDisplay={numConnections > 0}
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
                              {numConnections === 1 ? "it has" : "they have"}{" "}
                              been removed.
                            </>
                          }
                        >
                          <DeleteButton
                            deleteMessage="Are you you want to delete this environment?"
                            displayName={e.id}
                            className="dropdown-item text-danger"
                            text="Delete"
                            useIcon={false}
                            onClick={async () => {
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
                            }}
                            disabled={numConnections > 0}
                          />
                        </Tooltip>
                      )}
                    </MoreMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : canCreate ? (
        <p>Click the button below to add your first environment</p>
      ) : (
        <p>You don&apos;t have any environments defined yet.</p>
      )}
    </div>
  );
};
export default EnvironmentsPage;
