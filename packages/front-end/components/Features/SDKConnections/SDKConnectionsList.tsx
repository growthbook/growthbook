import React, { useState } from "react";
import { FaAngleRight, FaExclamationTriangle, FaLock } from "react-icons/fa";
import Link from "next/link";
import { useRouter } from "next/router";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle } from "@/components/Icons";
import usePermissions from "@/hooks/usePermissions";
import useSDKConnections from "@/hooks/useSDKConnections";
import StatusCircle from "@/components/Helpers/StatusCircle";
import Tooltip from "../../Tooltip/Tooltip";
import SDKLanguageLogo from "./SDKLanguageLogo";
import SDKConnectionForm from "./SDKConnectionForm";

export default function SDKConnectionsList() {
  const { data, mutate, error } = useSDKConnections();

  const [modalOpen, setModalOpen] = useState(false);

  const { getProjectById, projects } = useDefinitions();

  const router = useRouter();
  const permissions = usePermissions();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const connections = data.connections;

  return (
    <div>
      {modalOpen && (
        <SDKConnectionForm
          close={() => setModalOpen(false)}
          mutate={mutate}
          edit={false}
        />
      )}
      <h1>SDK Connections</h1>
      {connections.length > 0 && (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th style={{ width: 25 }}></th>
              <th>Name</th>
              {projects.length > 0 && <th>Project</th>}
              <th>Environment</th>
              <th>Languages</th>
              <th style={{ width: 25 }}></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((connection) => {
              const hasProxy =
                connection.proxy.enabled && connection.proxy.host;
              const connected =
                connection.connected &&
                (!hasProxy || connection.proxy.connected);

              return (
                <tr
                  key={connection.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/sdks/${connection.id}`);
                  }}
                >
                  <td style={{ verticalAlign: "middle", width: 20 }}>
                    <Tooltip
                      body={
                        connected
                          ? "Connected successfully"
                          : "Could not verify the connection"
                      }
                    >
                      {connected ? (
                        <StatusCircle className="bg-success" />
                      ) : (
                        <FaExclamationTriangle className="text-warning" />
                      )}
                    </Tooltip>
                  </td>
                  <td className="text-break">
                    <Link href={`/sdks/${connection.id}`}>
                      {connection.name}
                    </Link>
                  </td>
                  {projects.length > 0 && (
                    <td>
                      {connection.project ? (
                        getProjectById(connection.project)?.name ||
                        connection.project
                      ) : (
                        <em>All Projects</em>
                      )}{" "}
                    </td>
                  )}
                  <td>
                    {connection.environment}{" "}
                    {connection.encryptPayload && (
                      <Tooltip body="This feature payload is encrypted">
                        <FaLock className="text-purple" />
                      </Tooltip>
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
                  <td style={{ width: 25 }}>
                    <FaAngleRight />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {permissions.check("manageEnvironments", "", []) && (
        <>
          {connections.length === 0 ? (
            <div className="appbox p-5 text-center">
              <p>
                <strong>SDK Connections</strong> make it easy to integrate
                GrowthBook into your front-end, back-end, or mobile application.
              </p>
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  e.preventDefault();
                  setModalOpen(true);
                }}
              >
                <GBAddCircle /> Create New SDK Connection
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(true);
              }}
            >
              <GBAddCircle /> Create New SDK Connection
            </button>
          )}
        </>
      )}
    </div>
  );
}
