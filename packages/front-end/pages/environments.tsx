import Link from "next/link";
import React, { useState, FC } from "react";
import { FaAngleLeft } from "react-icons/fa";
import DeleteButton from "../components/DeleteButton";
import EnvironmentModal from "../components/Settings/EnvironmentModal";
import { useAuth } from "../services/auth";
import { Environment } from "back-end/types/organization";
import { GBAddCircle } from "../components/Icons";
import { useEnvironments } from "../services/features";
import useUser from "../hooks/useUser";
import MoreMenu from "../components/Dropdown/MoreMenu";
import Button from "../components/Button";
import useApi from "../hooks/useApi";
import { ApiKeyInterface } from "back-end/types/apikey";
import SDKEndpoints from "../components/Features/SDKEndpoints";
import usePermissions from "../hooks/usePermissions";

const EnvironmentsPage: FC = () => {
  const environments = useEnvironments();
  const { data, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const { update } = useUser();
  const permissions = usePermissions();
  const canEdit = permissions.manageEnvironments;

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<Environment> | null>(null);

  const apiKeysPerEnv = new Map();
  data?.keys.forEach((k) => {
    if (k.environment) {
      apiKeysPerEnv.set(
        k.environment.toLowerCase(),
        apiKeysPerEnv.has(k.environment.toLowerCase())
          ? apiKeysPerEnv.get(k.environment.toLowerCase()) + 1
          : 1
      );
    }
  });
  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <EnvironmentModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => {
            update();
            mutate();
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
              <th>API keys</th>
              {canEdit && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {environments.map((e, i) => {
              const numApiKeys = apiKeysPerEnv.get(e.id) ?? 0;
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.description}</td>
                  <td>{e.defaultState === false ? "off" : "on"}</td>
                  <td>{e.toggleOnList ? "yes" : "no"}</td>
                  <td>
                    {numApiKeys} {numApiKeys === 1 ? "key" : "keys"}
                  </td>
                  {canEdit && (
                    <td style={{ width: 30 }}>
                      <MoreMenu id={e.id + "_moremenu"}>
                        <button
                          className="dropdown-item"
                          onClick={(ev) => {
                            ev.preventDefault();
                            setModalOpen(e);
                          }}
                        >
                          Edit
                        </button>
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
                              update();
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
                              update();
                            }}
                          >
                            Move down
                          </Button>
                        )}
                        {environments.length > 1 && (
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
                              update();
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
      ) : canEdit ? (
        <p>Click the button below to add your first environment</p>
      ) : (
        <p>You don&apos;t have any environments defined yet.</p>
      )}
      <div className="mb-5">
        {canEdit && (
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
      {data?.keys && <SDKEndpoints keys={data.keys} mutate={mutate} />}
    </div>
  );
};
export default EnvironmentsPage;
