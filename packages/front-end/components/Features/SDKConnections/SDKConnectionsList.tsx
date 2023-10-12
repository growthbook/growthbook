import React, { useState } from "react";
import { FaAngleRight, FaExclamationTriangle, FaLock } from "react-icons/fa";
import Link from "next/link";
import { useRouter } from "next/router";
import { BsLightningFill } from "react-icons/bs";
import { RxDesktop } from "react-icons/rx";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle, GBHashLock, GBRemoteEvalIcon } from "@/components/Icons";
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

      <div className="row align-items-center mb-4">
        <div className="col-auto">
          <h1 className="mb-0">SDK Connections</h1>
        </div>
        {connections.length > 0 ? (
          <div className="col-auto ml-auto">
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(true);
              }}
            >
              <GBAddCircle /> Add SDK Connection
            </button>
          </div>
        ) : null}
      </div>

      {connections.length > 0 && (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th style={{ width: 25 }}></th>
              <th>Name</th>
              {projects.length > 0 && <th>Project</th>}
              <th>Environment</th>
              <th className="text-center">Features</th>
              <th>Language</th>
              <th style={{ width: 25 }}></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((connection) => {
              const hasProxy =
                connection.proxy.enabled && !!connection.proxy.host;
              const connected =
                connection.connected &&
                (!hasProxy || connection.proxy.connected);

              const projectId = connection.project;
              const projectName = getProjectById(projectId)?.name || null;
              const projectIsDeReferenced = projectId && !projectName;

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
                    {projectIsDeReferenced ? (
                      <Tooltip body='This SDK connection is scoped to a project that no longer exists. This connection will no longer work until either a valid project or "All Projects" is selected.'>
                        <FaExclamationTriangle className="text-danger" />
                      </Tooltip>
                    ) : (
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
                    )}
                  </td>
                  <td className="text-break">
                    <Link href={`/sdks/${connection.id}`}>
                      {connection.name}
                    </Link>
                  </td>
                  {projects.length > 0 && (
                    <td>
                      {projectIsDeReferenced ? (
                        <Tooltip
                          body={
                            <>
                              Project <code>{connection.project}</code> not
                              found
                            </>
                          }
                        >
                          <span className="text-danger">Invalid project</span>
                        </Tooltip>
                      ) : (
                        projectName ?? <em>All Projects</em>
                      )}
                    </td>
                  )}
                  <td>{connection.environment}</td>
                  <td className="text-center">
                    {connection.remoteEvalEnabled && (
                      <Tooltip
                        body={
                          <>
                            <strong>Remote Evaluation</strong> is enabled
                          </>
                        }
                      >
                        <GBRemoteEvalIcon className="mx-1 text-purple" />
                      </Tooltip>
                    )}
                    {connection.hashSecureAttributes && (
                      <Tooltip
                        body={
                          <>
                            <strong>Secure Attribute Hashing</strong> is enabled
                            for this connection&apos;s SDK payload
                          </>
                        }
                      >
                        <GBHashLock className="mx-1 text-blue" />
                      </Tooltip>
                    )}
                    {connection.encryptPayload && (
                      <Tooltip
                        body={
                          <>
                            <strong>Encryption</strong> is enabled for this
                            connection&apos;s SDK payload
                          </>
                        }
                      >
                        <FaLock className="mx-1 text-purple" />
                      </Tooltip>
                    )}
                    {hasProxy && (
                      <Tooltip
                        body={
                          <>
                            <BsLightningFill className="text-warning" />
                            <strong>GB Proxy</strong> is enabled
                          </>
                        }
                      >
                        <BsLightningFill className="mx-1 text-warning" />
                      </Tooltip>
                    )}
                    {connection.includeVisualExperiments && (
                      <Tooltip
                        body={
                          <>
                            <strong>Visual Experiments</strong> are supported
                          </>
                        }
                      >
                        <RxDesktop className="mx-1 text-blue" />
                      </Tooltip>
                    )}
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    <div className="d-flex flex-wrap">
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
          ) : null}
        </>
      )}
    </div>
  );
}
