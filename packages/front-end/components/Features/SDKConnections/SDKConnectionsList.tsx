import React, { useState } from "react";
import { FaAngleRight, FaLock } from "react-icons/fa";
import Link from "next/link";
import { useRouter } from "next/router";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle } from "@/components/Icons";
import usePermissions from "@/hooks/usePermissions";
import useSDKConnections from "@/hooks/useSDKConnections";
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
              <th>Name</th>
              <th>Features</th>
              <th>Languages</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((connection) => {
              return (
                <tr
                  key={connection.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/sdks/${connection.id}`);
                  }}
                >
                  <td className="text-break">
                    <Link href={`/sdks/${connection.id}`}>
                      {connection.name}
                    </Link>
                  </td>
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
                    <div className="d-flex">
                      {connection.languages.map((language) => (
                        <span className="mx-1" key={language}>
                          <SDKLanguageLogo language={language} />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
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
            <div className="appbox p-5 text-align-center">
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
