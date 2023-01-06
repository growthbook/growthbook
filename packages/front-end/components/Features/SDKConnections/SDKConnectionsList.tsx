import React, { useState } from "react";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import {
  FaAngleDown,
  FaAngleRight,
  FaCheckCircle,
  FaExclamationTriangle,
  FaQuestionCircle,
} from "react-icons/fa";
import { FiAlertTriangle } from "react-icons/fi";
import { BiRepeat } from "react-icons/bi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import Button from "@/components/Button";
import { getApiHost } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle } from "@/components/Icons";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import usePermissions from "@/hooks/usePermissions";
import Tooltip from "../../Tooltip/Tooltip";
import MoreMenu from "../../Dropdown/MoreMenu";
import Tabs from "../../Tabs/Tabs";
import Tab from "../../Tabs/Tab";
import Code from "../../SyntaxHighlighting/Code";
import SDKLanguageLogo from "./SDKLanguageLogo";
import SDKConnectionForm from "./SDKConnectionForm";

export default function SDKConnectionsList() {
  const { data, mutate, error } = useApi<{
    connections: SDKConnectionInterface[];
  }>(`/sdk-connections`);

  const { apiCall } = useAuth();
  const [rowOpen, setRowOpen] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editModal, setEditModal] = useState<SDKConnectionInterface | null>(
    null
  );

  const { getProjectById } = useDefinitions();

  const permissions = usePermissions();
  const environments = useEnvironments();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const connections = data.connections;

  return (
    <div className="mt-4">
      {createOpen && (
        <SDKConnectionForm close={() => setCreateOpen(false)} mutate={mutate} />
      )}
      {editModal && (
        <SDKConnectionForm
          close={() => setEditModal(null)}
          mutate={mutate}
          current={editModal}
        />
      )}
      <h1>SDK Connections</h1>
      {connections.length > 0 && (
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Languages</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((connection) => {
              const env = connection.environment;
              const envExists = environments?.some((e) => e.id === env);
              const open = rowOpen === connection.id;

              const hasPermission = permissions.check(
                "manageEnvironments",
                connection.project,
                [connection.environment]
              );

              return (
                <React.Fragment key={connection.id}>
                  <tr
                    onClick={(e) => {
                      e.preventDefault();
                      setRowOpen((id) =>
                        id === connection.id ? "" : connection.id
                      );
                    }}
                  >
                    <td>{connection.name}</td>
                    <td>
                      {connection.languages.map((language, i) => (
                        <SDKLanguageLogo key={i} language={language} />
                      ))}
                    </td>
                    <td>{open ? <FaAngleDown /> : <FaAngleRight />}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={3} className="bg-light">
                        <div className="p-2">
                          <div className="row">
                            <div className="col">
                              <h4>Included Features</h4>
                            </div>
                            <div className="col-auto">
                              {hasPermission && (
                                <MoreMenu>
                                  <button
                                    className="dropdown-item"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setEditModal(connection);
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <DeleteButton
                                    className="dropdown-item"
                                    displayName="SDK Connection"
                                    text="Delete"
                                    useIcon={false}
                                    onClick={async () => {
                                      await apiCall(
                                        `/sdk-connections/${connection.id}`,
                                        {
                                          method: "DELETE",
                                        }
                                      );
                                      mutate();
                                    }}
                                  />
                                </MoreMenu>
                              )}
                            </div>
                          </div>
                          <div className="row mb-3">
                            <div className="col-auto">
                              <span className="mr-1 text-muted">Project:</span>{" "}
                              {connection.project ? (
                                getProjectById(connection.project)?.name ||
                                connection.project
                              ) : (
                                <em>All Projects</em>
                              )}
                            </div>
                            <div className="col-auto">
                              <span className="mr-1 text-muted">
                                Environment:
                              </span>{" "}
                              <Tooltip
                                body={
                                  envExists
                                    ? ""
                                    : "This environment no longer exists. This SDK Connection will continue working, but will no longer be updated."
                                }
                              >
                                {connection.environment}{" "}
                                {!envExists && (
                                  <FaExclamationTriangle className="text-danger" />
                                )}
                              </Tooltip>
                            </div>
                            <div className="col-auto d-flex">
                              <span className="mr-1 text-muted">
                                Encrypted:
                              </span>{" "}
                              {connection.encryptPayload ? "yes " : "no"}
                              {connection.encryptPayload && hasPermission && (
                                <ClickToReveal
                                  getValue={async () =>
                                    connection.encryptionKey
                                  }
                                  valueWhenHidden="abcdef123456abcdef123456"
                                />
                              )}
                            </div>
                          </div>

                          {connection.proxy?.enabled && (
                            <div className="mb-3">
                              <h4>Proxy Server</h4>
                              <div className="row align-items-center">
                                <div className="col-auto">
                                  <span className="mr-1 text-muted">Host:</span>{" "}
                                  {connection.proxy.host}
                                </div>
                                <div className="col-auto">
                                  {connection.proxy.error ? (
                                    <Tooltip body={connection.proxy.error}>
                                      <span className="badge badge-danger">
                                        <FiAlertTriangle /> error
                                      </span>
                                    </Tooltip>
                                  ) : connection.proxy.connected ? (
                                    <span className="badge badge-success">
                                      <FaCheckCircle /> connected
                                    </span>
                                  ) : (
                                    <span className="badge badge-secondary">
                                      <FaQuestionCircle /> no status
                                    </span>
                                  )}
                                  {hasPermission && (
                                    <Button
                                      color="link"
                                      className="btn-sm"
                                      title="Test connection"
                                      onClick={async () => {
                                        await apiCall(
                                          `/sdk-connections/${connection.id}/test-proxy`,
                                          {
                                            method: "POST",
                                          }
                                        );
                                        await mutate();
                                      }}
                                    >
                                      <BiRepeat />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          <Tabs>
                            <Tab display="React" padding={false}>
                              <Code
                                language="tsx"
                                code={`
import { GrowthBook, GrowthBookProvider } from "@growthbook/react";

const gb = new GrowthBook({
  apiHost: "${
    // TODO: GrowthBook Cloud CDN
    connection.proxy?.enabled ? connection.proxy?.host : getApiHost()
  }",
  apiKey: "${connection.key}",
  streaming: true
});

export default function MyApp() {
  return (
    <GrowthBookProvider growthbook={gb}>
      <App/>
    </GrowthBookProvider>
  )
}
                            `.trim()}
                              />
                            </Tab>
                          </Tabs>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {permissions.check("manageEnvironments", "", [])}
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setCreateOpen(true);
        }}
      >
        <GBAddCircle /> Create New SDK Connection
      </button>
    </div>
  );
}
