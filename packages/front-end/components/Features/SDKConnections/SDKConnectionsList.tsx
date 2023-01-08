import React, { useState } from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "back-end/types/sdk-connection";
import {
  FaAngleRight,
  FaCheckCircle,
  FaCode,
  FaExclamationTriangle,
  FaLock,
} from "react-icons/fa";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle } from "@/components/Icons";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import usePermissions from "@/hooks/usePermissions";
import Tooltip from "../../Tooltip/Tooltip";
import MoreMenu from "../../Dropdown/MoreMenu";
import CodeSnippetModal from "../CodeSnippetModal";
import SDKLanguageLogo from "./SDKLanguageLogo";
import SDKConnectionForm from "./SDKConnectionForm";
import ProxyTestButton from "./ProxyTestButton";

export default function SDKConnectionsList() {
  const { data, mutate, error } = useApi<{
    connections: SDKConnectionInterface[];
  }>(`/sdk-connections`);

  const { apiCall } = useAuth();
  const [modalState, setModalState] = useState<{
    mode: "edit" | "create" | "closed";
    initialValue?: SDKConnectionInterface;
  }>({ mode: "closed" });

  const [instructionsModal, setInstructionsModal] = useState<{
    connection: SDKConnectionInterface;
    languages: SDKLanguage[];
  } | null>(null);

  const { getProjectById, projects } = useDefinitions();

  const permissions = usePermissions();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const connections = data.connections;

  return (
    <div className="mt-4">
      {modalState.mode !== "closed" && (
        <SDKConnectionForm
          close={() => setModalState({ mode: "closed" })}
          mutate={mutate}
          initialValue={modalState.initialValue}
          edit={modalState.mode === "edit"}
        />
      )}
      {instructionsModal && (
        <CodeSnippetModal
          close={() => setInstructionsModal(null)}
          defaultLanguage={instructionsModal.languages[0]}
          limitLanguages={instructionsModal.languages}
          sdkConnection={instructionsModal.connection}
        />
      )}
      <h1>SDK Connections</h1>
      {connections.length > 0 && (
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Features</th>
              <th>Proxy</th>
              <th>Languages</th>
              <th>Setup</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((connection) => {
              const hasPermission = permissions.check(
                "manageEnvironments",
                connection.project,
                [connection.environment]
              );

              return (
                <tr key={connection.id}>
                  <td className="text-break">{connection.name}</td>
                  <td>
                    {projects.length > 0 && (
                      <>
                        {connection.project ? (
                          getProjectById(connection.project)?.name ||
                          connection.project
                        ) : (
                          <em>All Projects</em>
                        )}{" "}
                        <FaAngleRight />
                      </>
                    )}
                    {connection.environment}{" "}
                    {connection.encryptPayload && (
                      <Tooltip body="This feature payload is encrypted">
                        <FaLock className="text-purple" />
                      </Tooltip>
                    )}
                  </td>
                  <td>
                    {connection.proxy?.enabled ? (
                      <>
                        <span className="text-break">
                          {connection.proxy.host}
                        </span>
                        {connection.proxy.connected ? (
                          <FaCheckCircle className="text-success ml-1" />
                        ) : (
                          <FaExclamationTriangle className="text-danger ml-1" />
                        )}

                        {hasPermission && (
                          <div className="mt-1">
                            <ProxyTestButton
                              host={connection.proxy.host}
                              id={connection.id}
                              mutate={mutate}
                              showButton={!connection.proxy.connected}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <em className="text-muted">not enabled</em>
                    )}
                  </td>
                  <td>
                    <div className="d-flex">
                      {connection.languages.map((language) => (
                        <span className="mx-1" key={language}>
                          <SDKLanguageLogo language={language} />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <a
                      href="#"
                      className="ml-2"
                      onClick={(e) => {
                        e.preventDefault();
                        setInstructionsModal({
                          connection,
                          languages: connection.languages,
                        });
                      }}
                    >
                      <FaCode /> view instructions
                    </a>
                  </td>
                  <td>
                    <div className="d-flex align-items-center">
                      {hasPermission && (
                        <MoreMenu>
                          <button
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              setModalState({
                                mode: "edit",
                                initialValue: connection,
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="dropdown-item"
                            onClick={(e) => {
                              e.preventDefault();
                              setModalState({
                                mode: "create",
                                initialValue: connection,
                              });
                            }}
                          >
                            Duplicate
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
                  </td>
                </tr>
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
          setModalState({
            mode: "create",
          });
        }}
      >
        <GBAddCircle /> Create New SDK Connection
      </button>
    </div>
  );
}
