import React, { useState, FC, useMemo } from "react";
import { Environment } from "back-end/types/organization";
import { isProjectListValidForProject } from "shared/util";
import { BsXCircle } from "react-icons/bs";
import { useAuth } from "@/services/auth";
import { GBAddCircle } from "@/components/Icons";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissions from "../hooks/usePermissions";
import Button from "../components/Button";
import MoreMenu from "../components/Dropdown/MoreMenu";
import EnvironmentModal from "../components/Settings/EnvironmentModal";
import DeleteButton from "../components/DeleteButton/DeleteButton";

const EnvironmentsPage: FC = () => {
  const { project } = useDefinitions();

  const environments = useEnvironments();
  const filteredEnvironments = project
    ? environments.filter((ds) =>
        isProjectListValidForProject(ds.projects, project)
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

  const [showConnections, setShowConnections] = useState<number | null>(null);

  const { refreshOrganization } = useUser();
  const permissions = usePermissions();
  // See if the user has access to a random environment name that doesn't exist yet
  // If yes, then they can create new environments
  const canCreate = permissions.check("manageEnvironments", "", ["$$$NEW$$$"]);

  const canManageEnvironments = permissions.check("manageEnvironments", "", []);

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
      <div className="row align-items-center mb-1">
        <div className="col-auto">
          <h1 className="mb-0">Environments</h1>
        </div>
        {canCreate && (
          <div className="col-auto ml-auto">
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen({});
              }}
            >
              <GBAddCircle /> Add Environment
            </button>
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
              {canManageEnvironments && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {filteredEnvironments.map((e, i) => {
              const canEdit = permissions.check("manageEnvironments", "", [
                e.id,
              ]);
              const numConnections = sdkConnectionsMap?.[e.id]?.length || 0;
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.description}</td>
                  <td>
                    {(e?.projects?.length || 0) > 0 ? (
                      <ProjectBadges
                        resourceType="environment"
                        projectIds={e.projects}
                        className="badge-ellipsis short align-middle"
                      />
                    ) : (
                      <ProjectBadges
                        resourceType="environment"
                        className="badge-ellipsis short align-middle"
                      />
                    )}
                  </td>
                  <td>
                    <Tooltip
                      tipPosition="bottom"
                      state={showConnections === i}
                      popperStyle={{ marginLeft: 8, marginTop: -2 }}
                      body={
                        <div
                          className="px-3 py-2"
                          style={{ minWidth: 250, maxWidth: 350 }}
                        >
                          <a
                            role="button"
                            style={{ top: 3, right: 5 }}
                            className="position-absolute text-gray cursor-pointer"
                            onClick={(e) => {
                              e.preventDefault();
                              setShowConnections(null);
                            }}
                          >
                            <BsXCircle size={16} />
                          </a>
                          <div className="mt-1 text-muted font-weight-bold">
                            SDK Connections using this environment
                          </div>
                          <div
                            className="mt-2"
                            style={{ maxHeight: 300, overflowY: "auto" }}
                          >
                            {sdkConnectionData?.connections?.map((c, i) => (
                              <div
                                key={i}
                                className="my-1 text-ellipsis"
                                style={{ maxWidth: 320 }}
                              >
                                <a href={`/sdks/${c.id}`}>{c.name}</a>
                              </div>
                            ))}
                          </div>
                        </div>
                      }
                    >
                      <></>
                    </Tooltip>
                    {numConnections > 0 ? (
                      <>
                        <a
                          role="button"
                          className="link-purple"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowConnections(
                              showConnections !== i ? i : null
                            );
                          }}
                        >
                          {numConnections} connection
                          {numConnections !== 1 && "s"}
                        </a>
                      </>
                    ) : (
                      <span className="font-italic text-muted">None</span>
                    )}
                  </td>
                  <td>{e.defaultState === false ? "off" : "on"}</td>
                  <td>{e.toggleOnList ? "yes" : "no"}</td>
                  {canManageEnvironments && (
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
                        {i > 0 && (
                          <Button
                            color=""
                            className="dropdown-item"
                            onClick={async () => {
                              const newEnvs = [...environments];
                              newEnvs.splice(i, 1);
                              newEnvs.splice(i - 1, 0, e);
                              await apiCall(`/organization`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  settings: {
                                    environments: newEnvs,
                                  },
                                }),
                              });
                              refreshOrganization();
                            }}
                          >
                            Move up
                          </Button>
                        )}
                        {i < environments.length - 1 && (
                          <Button
                            color=""
                            className="dropdown-item"
                            onClick={async () => {
                              const newEnvs = [...environments];
                              newEnvs.splice(i, 1);
                              newEnvs.splice(i + 1, 0, e);
                              await apiCall(`/organization`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  settings: {
                                    environments: newEnvs,
                                  },
                                }),
                              });
                              refreshOrganization();
                            }}
                          >
                            Move down
                          </Button>
                        )}
                        {environments.length > 1 && canEdit && (
                          <DeleteButton
                            deleteMessage="Are you you want to delete this environment?"
                            displayName={e.id}
                            className="dropdown-item text-danger"
                            text="Delete"
                            useIcon={false}
                            onClick={async () => {
                              await apiCall(`/organization`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  settings: {
                                    environments: environments.filter(
                                      (env) => env.id !== e.id
                                    ),
                                  },
                                }),
                              });
                              refreshOrganization();
                            }}
                          />
                        )}
                      </MoreMenu>
                    </td>
                  )}
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
