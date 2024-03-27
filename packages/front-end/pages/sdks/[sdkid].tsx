import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { useRouter } from "next/router";
import React, { ReactElement, ReactNode, useState } from "react";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaInfoCircle,
  FaLock,
  FaQuestionCircle,
} from "react-icons/fa";
import { BsArrowRepeat, BsLightningFill } from "react-icons/bs";
import {
  filterProjectsByEnvironment,
  getDisallowedProjects,
} from "shared/util";
import clsx from "clsx";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBEdit, GBHashLock, GBRemoteEvalIcon } from "@/components/Icons";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import SDKConnectionForm from "@/components/Features/SDKConnections/SDKConnectionForm";
import CodeSnippetModal, {
  getApiBaseUrl,
} from "@/components/Features/CodeSnippetModal";
import SDKLanguageLogo from "@/components/Features/SDKConnections/SDKLanguageLogo";
import ProxyTestButton from "@/components/Features/SDKConnections/ProxyTestButton";
import Button from "@/components/Button";
import useSDKConnections from "@/hooks/useSDKConnections";
import { isCloud } from "@/services/env";
import Tooltip from "@/components/Tooltip/Tooltip";
import PageHead from "@/components/Layout/PageHead";
import { useEnvironments } from "@/services/features";
import Badge from "@/components/Badge";
import ProjectBadges from "@/components/ProjectBadges";
import Webhooks from "./webhooks";

function ConnectionDot({ left }: { left: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        [left ? "right" : "left"]: "100%",
        top: "50%",
        marginTop: -7,
        [left ? "marginRight" : "marginLeft"]: -8,
        width: 16,
        height: 16,
        borderRadius: 20,
        border: "3px solid var(--text-color-primary)",
        background: "#fff",
      }}
    />
  );
}
function ConnectionNode({
  children,
  title,
  first,
  last,
}: {
  children: ReactElement;
  title: ReactNode;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`appbox p-3 ${
        first ? "mr" : last ? "ml" : "mx"
      }-3 text-center position-relative`}
      style={{
        zIndex: 10,
        overflow: "visible",
      }}
    >
      {!first && <ConnectionDot left={true} />}
      {!last && <ConnectionDot left={false} />}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function ConnectionStatus({
  connected,
  error,
  errorTxt,
  refresh,
  canRefresh,
}: {
  connected: boolean;
  error?: boolean;
  errorTxt?: string;
  refresh?: ReactElement;
  canRefresh: boolean;
}) {
  return (
    <div
      className="mx-3 text-center"
      style={{ zIndex: 10, marginTop: -8, whiteSpace: "nowrap" }}
    >
      {connected ? (
        <>
          <span className="text-success">
            <FaCheckCircle /> connected
          </span>
        </>
      ) : (
        <>
          {error ? (
            <>
              <span className="text-danger">
                <FaExclamationTriangle /> error
              </span>
              {errorTxt !== undefined && (
                <Tooltip
                  className="ml-2"
                  usePortal={true}
                  body={
                    <>
                      <div className="mb-2">
                        Encountered an error while trying to connect:
                      </div>
                      {errorTxt ? (
                        <div className="alert alert-danger mt-2">
                          {errorTxt}
                        </div>
                      ) : (
                        <div className="alert alert-danger">
                          <em>Unknown error</em>
                        </div>
                      )}
                    </>
                  }
                />
              )}
            </>
          ) : (
            <span className="text-secondary">
              <FaQuestionCircle /> not connected
            </span>
          )}
        </>
      )}
      <div style={{ marginTop: 10, textAlign: "center" }}>
        {canRefresh && refresh ? refresh : <>&nbsp;</>}
      </div>
    </div>
  );
}

export default function SDKConnectionPage() {
  const router = useRouter();
  const { sdkid } = router.query;

  const { data, mutate, error } = useSDKConnections();

  const { apiCall } = useAuth();
  const [modalState, setModalState] = useState<{
    mode: "edit" | "create" | "closed";
    initialValue?: SDKConnectionInterface;
  }>({ mode: "closed" });

  const environments = useEnvironments();
  const { projects } = useDefinitions();

  const permissions = usePermissions();

  const connection:
    | SDKConnectionInterface
    | undefined = data?.connections?.find((conn) => conn.id === sdkid);
  const environment = environments.find(
    (e) => e.id === connection?.environment
  );
  const envProjects = environment?.projects ?? [];
  const filteredProjectIds = filterProjectsByEnvironment(
    connection?.projects ?? [],
    environment,
    true
  );
  const showAllEnvironmentProjects =
    (connection?.projects?.length ?? 0) === 0 && filteredProjectIds.length > 0;
  const disallowedProjects = getDisallowedProjects(
    projects,
    connection?.projects ?? [],
    environment
  );
  const disallowedProjectIds = disallowedProjects.map((p) => p.id);
  const filteredProjectIdsWithDisallowed = [
    ...filteredProjectIds,
    ...disallowedProjectIds,
  ];

  const hasPermission = connection
    ? permissions.check("manageEnvironments", connection.projects, [
        connection.environment,
      ])
    : false;

  const hasProxy = connection?.proxy?.enabled && !!connection?.proxy?.host;

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (!connection) {
    return <div className="alert alert-danger">Invalid SDK Connection id</div>;
  }

  return (
    <div className="contents container pagecontents">
      {modalState.mode !== "closed" && (
        <SDKConnectionForm
          close={() => setModalState({ mode: "closed" })}
          mutate={mutate}
          initialValue={modalState.initialValue}
          edit={modalState.mode === "edit"}
        />
      )}

      <PageHead
        breadcrumb={[
          { display: "SDK Connections", href: "/sdks" },
          { display: connection.name },
        ]}
      />

      <div className="row align-items-center mb-2">
        <h1 className="col-auto mb-0">{connection.name}</h1>
        {hasPermission && (
          <>
            <div className="col-auto ml-auto">
              <a
                role="button"
                className="btn btn-outline-primary"
                onClick={(e) => {
                  e.preventDefault();
                  setModalState({
                    mode: "edit",
                    initialValue: connection,
                  });
                }}
              >
                <GBEdit /> Edit
              </a>
            </div>
            <div className="col-auto">
              <MoreMenu>
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
                  className="dropdown-item text-danger"
                  displayName="SDK Connection"
                  text="Delete"
                  useIcon={false}
                  onClick={async () => {
                    await apiCall(`/sdk-connections/${connection.id}`, {
                      method: "DELETE",
                    });
                    mutate();
                    router.push(`/sdks`);
                  }}
                />
              </MoreMenu>
            </div>
          </>
        )}
      </div>

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
                  resourceType="sdk connection"
                />
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

      <div className="row mb-2 align-items-center">
        <div className="col-auto">
          <h2 className="mb-0">Connection</h2>
        </div>
      </div>
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
            height: 6,
            marginTop: -9,
            backgroundColor: "var(--text-color-primary)",
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
          canRefresh={hasPermission && !connection.connected}
          refresh={
            <Button
              color="link"
              className="btn-sm"
              onClick={async () => {
                await mutate();
              }}
            >
              <BsArrowRepeat /> re-check
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
                {connection.proxy.host || connection.proxy.hostExternal}
              </code>
            </ConnectionNode>

            <ConnectionStatus
              connected={connection.proxy.connected}
              canRefresh={hasPermission}
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

      <div className="row mb-3 align-items-center">
        <div className="flex-1"></div>
        <div className="col-auto">
          <Tooltip
            body={
              <div style={{ lineHeight: 1.5 }}>
                <p className="mb-0">
                  <BsLightningFill className="text-warning" />
                  <strong>Streaming Updates</strong> allow you to instantly
                  update any subscribed SDKs when you make any feature changes
                  in GrowthBook. For front-end SDKs, active users will see the
                  changes immediately without having to refresh the page.
                </p>
              </div>
            }
          >
            <BsLightningFill className="text-warning" />
            Streaming Updates:{" "}
            <strong>{isCloud() || hasProxy ? "Enabled" : "Disabled"}</strong>
            <div
              className="text-right text-muted"
              style={{ fontSize: "0.75rem" }}
            >
              What is this? <FaInfoCircle />
            </div>
          </Tooltip>
        </div>
      </div>
      <Webhooks sdkid={sdkid} />
      <div className="mt-4">
        <CodeSnippetModal
          connections={data.connections}
          mutateConnections={mutate}
          sdkConnection={connection}
          inline={true}
        />
      </div>
    </div>
  );
}
