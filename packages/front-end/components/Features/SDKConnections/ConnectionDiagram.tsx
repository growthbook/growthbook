import { SDKConnectionInterface } from "shared/types/sdk-connection";
import clsx from "clsx";
import { BsLightningFill } from "react-icons/bs";
import { FaLock } from "react-icons/fa";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import { teal, slate } from "@radix-ui/colors";
import { PiArrowClockwise } from "react-icons/pi";
import Button from "@/ui/Button";
import { getApiBaseUrl } from "@/components/Features/CodeSnippetModal";
import ConnectionNode from "@/components/Features/SDKConnections/ConnectionNode";
import ConnectionStatus from "@/components/Features/SDKConnections/ConnectionStatus";
import ProxyTestButton from "@/components/Features/SDKConnections/ProxyTestButton";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { GBHashLock, GBRemoteEvalIcon } from "@/components/Icons";
import ProjectBadges from "@/components/ProjectBadges";
import Badge from "@/ui/Badge";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";

export default function ConnectionDiagram({
  connection,
  mutate,
  canUpdate,
  showConnectionTitle = false,
}: {
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown>;
  canUpdate: boolean;
  showConnectionTitle?: boolean;
}) {
  const { projects } = useDefinitions();
  const hasProxy = connection?.proxy?.enabled;

  const environments = useEnvironments();

  const environment = environments.find(
    (e) => e.id === connection?.environment,
  );

  const envProjects = environment?.projects ?? [];
  const filteredProjectIds = filterProjectsByEnvironment(
    connection?.projects ?? [],
    environment,
    true,
  );
  const showAllEnvironmentProjects =
    (connection?.projects?.length ?? 0) === 0 && filteredProjectIds.length > 0;
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
    <>
      <div className="mb-4 row">
        <div className="col-auto">
          Environment: <strong>{connection.environment}</strong>
        </div>

        {(projects.length > 0 || connection.projects.length > 0) && (
          <div className="col-auto d-flex">
            <div className="mr-2">Projects:</div>

            <div>
              {showAllEnvironmentProjects && (
                <Badge
                  key="All env projects"
                  color="teal"
                  variant="solid"
                  label={`All env projects (${envProjects.length})`}
                />
              )}
              <div
                className={clsx("d-flex align-items-center", {
                  "small mt-1": showAllEnvironmentProjects,
                })}
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
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {connection.remoteEvalEnabled && (
          <div className="col-auto">
            Remote Evaluation:{" "}
            <strong>
              <GBRemoteEvalIcon className="text-purple" /> yes
            </strong>
          </div>
        )}

        {connection.hashSecureAttributes && (
          <div className="col-auto">
            Secure Attribute Hashing:{" "}
            <strong>
              <GBHashLock className="text-blue" /> yes
            </strong>
          </div>
        )}

        {connection.encryptPayload && (
          <div className="col-auto">
            Encrypted:{" "}
            <strong>
              <FaLock className="text-purple" /> yes
            </strong>
          </div>
        )}
      </div>

      {showConnectionTitle && (
        <div className="row mb-2 align-items-center">
          <div className="col-auto">
            <h2 className="mb-0">Connection</h2>
          </div>
        </div>
      )}

      <div
        className="d-flex align-items-center position-relative"
        style={{
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 10,
            right: 10,
            height: 0,
            marginTop: -9,
            borderTop: `1px ${connection.connected ? "solid" : "dashed"} ${
              connection.connected ? teal.teal11 : slate.slate7
            }`,
          }}
        />
        <ConnectionNode first title="Your App">
          <div
            className="d-flex flex-wrap justify-content-center"
            style={{ maxWidth: 325 }}
          >
            {connection.languages.map((language) => (
              <div className="mx-1" key={language}>
                <SDKLanguageLogo
                  showLabel={true}
                  language={language}
                  version={
                    connection.languages?.length === 1
                      ? connection.sdkVersion
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
        </ConnectionNode>

        <ConnectionStatus
          connected={connection.connected}
          canRefresh={canUpdate && !connection.connected}
          refresh={
            <Button
              variant="ghost"
              onClick={async () => {
                await mutate();
              }}
            >
              <PiArrowClockwise /> Retry
            </Button>
          }
        />
        {hasProxy && (
          <>
            <ConnectionNode
              title={
                <>
                  <BsLightningFill className="text-warning" /> GB Proxy
                </>
              }
            >
              <code className="text-muted">
                {connection.proxy.host ||
                  connection.proxy.hostExternal ||
                  "https://proxy.yoursite.io"}
              </code>
            </ConnectionNode>

            <ConnectionStatus
              connected={connection.proxy.connected}
              canRefresh={canUpdate && !!connection.proxy.host}
              error={!connection.proxy.connected}
              errorTxt={connection.proxy.error}
              refresh={
                <ProxyTestButton
                  host={connection.proxy.host}
                  id={connection.id}
                  mutate={mutate}
                  showButton={true}
                />
              }
            />
          </>
        )}
        <ConnectionNode
          title={
            <>
              <img
                src="/logo/growthbook-logo.png"
                style={{ width: 130 }}
                alt="GrowthBook"
              />
              <span style={{ verticalAlign: "sub", marginLeft: 3 }}>API</span>
            </>
          }
          last
        >
          <code className="text-muted">{getApiBaseUrl()}</code>
        </ConnectionNode>
      </div>
    </>
  );
}
