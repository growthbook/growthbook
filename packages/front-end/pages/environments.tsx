import Link from "next/link";
import React, { useState, FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import { Environment } from "back-end/types/organization";
import DeleteButton from "../components/DeleteButton/DeleteButton";
import EnvironmentModal from "../components/Settings/EnvironmentModal";
import { useAuth } from "../services/auth";
import { GBAddCircle } from "../components/Icons";
import { useEnvironments } from "../services/features";
import { useUser } from "../services/UserContext";
import MoreMenu from "../components/Dropdown/MoreMenu";
import Button from "../components/Button";
import usePermissions from "../hooks/usePermissions";

const EnvironmentsPage: FC = () => {
  const environments = useEnvironments();
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
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Environments</h1>
      <p>Manage what environments are available for your feature flags.</p>
      {environments.length > 0 ? (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Description</th>
              <th>Default state</th>
              <th>Show toggle on feature list</th>
              {canManageEnvironments && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {environments.map((e, i) => {
              const canEdit = permissions.check("manageEnvironments", "", [
                e.id,
              ]);
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.description}</td>
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
                            className="dropdown-item"
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
      <div className="mb-5">
        {canCreate && (
          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.preventDefault();
              setModalOpen({});
            }}
          >
            <span className="h4 pr-2 m-0 d-inline-block">
              <GBAddCircle />
            </span>{" "}
            Create New Environment
          </button>
        )}
      </div>
      <div className="alert alert-info">
        Looking for SDK Endpoints? They have moved to the new{" "}
        <Link href="/sdks">SDKs</Link> tab. Also, make sure to check out the new{" "}
        <strong>SDK Connections</strong>, which makes it easier to configure and
        test your integrations.
      </div>
    </div>
  );
};
export default EnvironmentsPage;
