import React, { useState } from "react";
import { FaAngleRight, FaExclamationTriangle, FaLock } from "react-icons/fa";
import Link from "next/link";
import { useRouter } from "next/router";
import { BsLightningFill } from "react-icons/bs";
import { RxDesktop } from "react-icons/rx";
import { PiShuffle } from "react-icons/pi";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import clsx from "clsx";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle, GBHashLock, GBRemoteEvalIcon } from "@/components/Icons";
import usePermissions from "@/hooks/usePermissions";
import useSDKConnections from "@/hooks/useSDKConnections";
import StatusCircle from "@/components/Helpers/StatusCircle";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useEnvironments } from "@/services/features";
import Badge from "@/components/Badge";
import SDKLanguageLogo from "./SDKLanguageLogo";
import SDKConnectionForm from "./SDKConnectionForm";

export default function SDKConnectionsList() {
  const { data, mutate, error } = useSDKConnections();
  const connections = data?.connections ?? [];

  const [modalOpen, setModalOpen] = useState(false);

  const environments = useEnvironments();
  const { projects } = useDefinitions();

  const router = useRouter();
  const permissions = usePermissions();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

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
              {projects.length > 0 && <th>Projects</th>}
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

              const environment = environments.find(
                (e) => e.id === connection.environment,
              );
              const envProjects = environment?.projects ?? [];
              const filteredProjectIds = filterProjectsByEnvironment(
                connection.projects,
                environment,
                true,
              );
              const showAllEnvironmentProjects =
                connection.projects.length === 0 &&
                filteredProjectIds.length > 0;
              const disallowedProjects = getDisallowedProjects(
                projects,
                connection?.projects ?? [],
                environment,
              );
              const disallowedProjectIds = disallowedProjects.map((p) => p.id);
              const filteredProjectIdsWithDisallowed = [
                ...filteredProjectIds,
                ...disallowedProjectIds,
              ];

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
                      {showAllEnvironmentProjects && (
                        <Badge
                          content={`All env projects (${envProjects.length})`}
                          key="All env projects"
                          className="badge-muted-info border-info"
                          skipMargin={true}
                        />
                      )}
                      <div
                        className={clsx("d-flex align-items-center", {
                          "small mt-1": showAllEnvironmentProjects,
                        })}
                      >
                        <ProjectBadges
                          projectIds={
                            filteredProjectIdsWithDisallowed.length
                              ? filteredProjectIdsWithDisallowed
                              : undefined
                          }
                          invalidProjectIds={disallowedProjectIds}
                          invalidProjectMessage="This project is not allowed in the selected environment and will not be included in the SDK payload."
                          resourceType="sdk connection"
                        />
                      </div>
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
                    {connection.includeRedirectExperiments && (
                      <Tooltip
                        body={
                          <>
                            <strong>URL Redirects</strong> are supported
                          </>
                        }
                      >
                        <PiShuffle className="mx-1 text-blue" />
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
