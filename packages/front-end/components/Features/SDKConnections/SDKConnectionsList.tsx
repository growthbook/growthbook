import React, { useState } from "react";
import { FaAngleRight, FaExclamationTriangle, FaLock } from "react-icons/fa";
import { useRouter } from "next/router";
import { BsLightningFill } from "react-icons/bs";
import { RxDesktop } from "react-icons/rx";
import { PiShuffle } from "react-icons/pi";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import clsx from "clsx";
import Link from "@/ui/Link";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle, GBHashLock, GBRemoteEvalIcon } from "@/components/Icons";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import useSDKWebhooks from "@/hooks/useSDKWebhooks";
import StatusCircle from "@/components/Helpers/StatusCircle";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useEnvironments } from "@/services/features";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { capitalizeFirstLetter } from "@/services/utils";
import Callout from "@/ui/Callout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import SDKLanguageLogo from "./SDKLanguageLogo";
import SDKConnectionForm from "./SDKConnectionForm";

export default function SDKConnectionsList() {
  const { data, mutate, error } = useSDKConnections();
  const { data: webhooksData, mutate: mutateWebhooks } = useSDKWebhooks();
  const connections = data?.connections ?? [];

  const [modalOpen, setModalOpen] = useState(false);

  const environments = useEnvironments();
  const { projects, project } = useDefinitions();

  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();

  const canCreateSDKConnections =
    permissionsUtil.canViewCreateSDKConnectionModal(project);

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {modalOpen && (
        <SDKConnectionForm
          initialValue={{
            languages: [],
            includeRuleIds: true,
          }}
          close={() => setModalOpen(false)}
          mutate={() => {
            mutate();
            mutateWebhooks();
          }}
          edit={false}
        />
      )}

      <div className="row align-items-center mb-4">
        <div className="col-auto">
          <h1 className="mb-0">SDK Connections</h1>
        </div>
        {canCreateSDKConnections && connections.length > 0 ? (
          <div className="col-auto ml-auto">
            <Button onClick={() => setModalOpen(true)}>
              Add SDK Connection
            </Button>
          </div>
        ) : null}
      </div>

      {connections.length === 0 ? (
        <>
          {!canCreateSDKConnections ? (
            <div className="appbox p-5 text-center">
              <p>
                You do not have permission to create SDK connections. Please
                contact your account administrator
              </p>
            </div>
          ) : (
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
          )}
        </>
      ) : null}

      {connections.length > 0 && (
        <Table variant="list" mb="3">
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: 25 }} />
              <TableColumnHeader>Name</TableColumnHeader>
              {projects.length > 0 && (
                <TableColumnHeader>Projects</TableColumnHeader>
              )}
              <TableColumnHeader>Environment</TableColumnHeader>
              <TableColumnHeader>Webhooks</TableColumnHeader>
              <TableColumnHeader style={{ textAlign: "center" }}>
                Supported Features
              </TableColumnHeader>
              <TableColumnHeader>Language</TableColumnHeader>
              <TableColumnHeader style={{ width: 25 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
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

              const webhooks = webhooksData?.connections?.[connection.id];
              const webhooksWithErrors = webhooks?.filter((w) => w.error);

              return (
                <TableRow
                  key={connection.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/sdks/${connection.id}`);
                  }}
                >
                  <TableCell style={{ verticalAlign: "middle", width: 20 }}>
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
                  </TableCell>
                  <TableRowHeaderCell className="text-break">
                    <Link href={`/sdks/${connection.id}`}>
                      {connection.name}
                    </Link>
                    {connection.managedBy?.type ? (
                      <div>
                        <Badge
                          label={`Managed by ${capitalizeFirstLetter(
                            connection.managedBy.type,
                          )}`}
                        />
                      </div>
                    ) : null}
                  </TableRowHeaderCell>
                  {projects.length > 0 && (
                    <TableCell>
                      {showAllEnvironmentProjects && (
                        <Badge
                          key="All env projects"
                          color="teal"
                          variant="solid"
                          label={`All env projects (${envProjects.length})`}
                        />
                      )}
                      <div
                        className={clsx("d-flex flex-wrap align-items-center", {
                          "small mt-1": showAllEnvironmentProjects,
                        })}
                        style={{ gap: "0.5rem" }}
                      >
                        {!showAllEnvironmentProjects && (
                          <ProjectBadges
                            projectIds={
                              filteredProjectIdsWithDisallowed.length
                                ? filteredProjectIdsWithDisallowed
                                : undefined
                            }
                            invalidProjectIds={disallowedProjectIds}
                            invalidProjectMessage="This project is not allowed in the selected environment and will not be included in the SDK payload."
                            resourceType="sdk connection"
                            skipMargin={true}
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                  <TableCell>{connection.environment}</TableCell>
                  <TableCell>
                    {webhooks?.length ? (
                      <div className="nowrap">
                        {webhooks.length} webhook{webhooks.length !== 1 && "s"}
                        {webhooksWithErrors?.length ? (
                          <Tooltip
                            className="ml-1"
                            innerClassName="pb-3"
                            usePortal={true}
                            body={
                              <>
                                {webhooksWithErrors.map((webhook) => (
                                  <Callout
                                    key={webhook.id}
                                    status="error"
                                    my="4"
                                  >
                                    <div>
                                      <strong>{webhook.name}:</strong>
                                    </div>
                                    <div style={{ wordBreak: "break-all" }}>
                                      {webhook.error}
                                    </div>
                                  </Callout>
                                ))}
                              </>
                            }
                          >
                            <FaExclamationTriangle className="text-danger ml-1" />
                          </Tooltip>
                        ) : null}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell style={{ textAlign: "center" }}>
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
                  </TableCell>
                  <TableCell style={{ maxWidth: 200 }}>
                    <div className="d-flex flex-wrap">
                      {connection.languages.map((language) => (
                        <span className="mx-1" key={language}>
                          <SDKLanguageLogo
                            language={language}
                            hideExtra={true}
                            version={
                              connection.languages?.length === 1
                                ? connection.sdkVersion
                                : undefined
                            }
                          />
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell style={{ width: 25 }}>
                    <FaAngleRight />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
