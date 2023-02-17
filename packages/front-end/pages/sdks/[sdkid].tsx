import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { useRouter } from "next/router";
import Link from "next/link";
import { ReactElement, ReactNode, useState } from "react";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaLock,
  FaQuestionCircle,
} from "react-icons/fa";
import { BsArrowRepeat, BsLightningFill } from "react-icons/bs";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBCircleArrowLeft, GBEdit } from "@/components/Icons";
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
  refresh,
  canRefresh,
}: {
  connected: boolean;
  error?: boolean;
  refresh: ReactElement;
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
            <span className="text-danger">
              <FaExclamationTriangle /> error
            </span>
          ) : (
            <span className="text-secondary">
              <FaQuestionCircle /> not connected
            </span>
          )}
        </>
      )}
      <div style={{ marginTop: 10, textAlign: "center" }}>
        {canRefresh ? refresh : <>&nbsp;</>}
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

  const { getProjectById, projects } = useDefinitions();

  const permissions = usePermissions();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const connection: SDKConnectionInterface | undefined = data.connections.find(
    (conn) => conn.id === sdkid
  );

  if (!connection) {
    return <div className="alert alert-danger">Invalid SDK Connection id.</div>;
  }

  const hasPermission = permissions.check(
    "manageEnvironments",
    connection.project,
    [connection.environment]
  );

  const hasProxy = connection.proxy.enabled && connection.proxy.host;

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
      <div className="row align-items-center mb-2">
        <div className="col-auto">
          <Link href="/sdks">
            <a>
              <GBCircleArrowLeft /> Back to all SDK connections
            </a>
          </Link>
        </div>
      </div>

      <div className="row align-items-center mb-2">
        <h1 className="col-auto mb-0">{connection.name}</h1>
        {hasPermission && (
          <>
            <div className="col-auto ml-auto">
              <a
                href="#"
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
                  className="dropdown-item"
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

      <div className="mb-4 row" style={{ fontSize: "0.8em" }}>
        <div className="col-auto">
          Environment: <strong>{connection.environment}</strong>
        </div>

        {projects.length > 0 && (
          <div className="col-auto">
            Project:{" "}
            {connection.project ? (
              <strong>
                {getProjectById(connection.project)?.name || "unknown"}
              </strong>
            ) : (
              <em className="text-muted">All Projects</em>
            )}
          </div>
        )}

        {connection.encryptPayload && (
          <div className="col-auto">
            Encrypted:{" "}
            <strong>
              <FaLock /> yes
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
        className="d-flex align-items-center mb-4 position-relative"
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
          <div className="d-flex flex-wrap justify-content-center">
            {connection.languages.map((language) => (
              <div className="mx-1" key={language}>
                <SDKLanguageLogo showLabel={true} language={language} />
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
                {connection.proxy.hostExternal || connection.proxy.host}
              </code>
            </ConnectionNode>

            <ConnectionStatus
              connected={connection.proxy.connected}
              canRefresh={hasPermission}
              error={!connection.proxy.connected}
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

      <CodeSnippetModal
        connections={data.connections}
        mutateConnections={mutate}
        sdkConnection={connection}
        inline={true}
      />
    </div>
  );
}
