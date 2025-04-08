import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { useRouter } from "next/router";
import React, { useState } from "react";
import { FaInfoCircle, FaLock } from "react-icons/fa";
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
import Badge from "@/components/Radix/Badge";
import ProjectBadges from "@/components/ProjectBadges";
import SdkWebhooks from "@/pages/sdks/SdkWebhooks";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ConnectionStatus from "@/components/Features/SDKConnections/ConnectionStatus";
import ConnectionNode from "@/components/Features/SDKConnections/ConnectionNode";

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

  const permissionsUtil = usePermissionsUtil();

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

  const hasProxy = connection?.proxy?.enabled;

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (!connection) {
    return <div className="alert alert-danger">SDK连接ID不可用</div>;
  }

  const canDuplicate = permissionsUtil.canCreateSDKConnection(connection);
  const canUpdate = permissionsUtil.canUpdateSDKConnection(connection, {});
  const canDelete = permissionsUtil.canDeleteSDKConnection(connection);

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
        {canDelete || canUpdate || canDuplicate ? (
          <>
            {canUpdate ? (
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
                  <GBEdit /> 编辑
                </a>
              </div>
            ) : null}
            <div className="col-auto">
              <MoreMenu>
                {canDuplicate ? (
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
                    复制
                  </button>
                ) : null}
                {canDelete ? (
                  <DeleteButton
                    className="dropdown-item text-danger"
                    displayName="SDK连接"
                    text="删除"
                    useIcon={false}
                    onClick={async () => {
                      await apiCall(`/sdk-connections/${connection.id}`, {
                        method: "DELETE",
                      });
                      mutate();
                      router.push(`/sdks`);
                    }}
                  />
                ) : null}
              </MoreMenu>
            </div>
          </>
        ) : null}
      </div>

      <div className="mb-4 row">
        <div className="col-auto">
          环境: <strong>{connection.environment}</strong>
        </div>

        {(projects.length > 0 || connection.projects.length > 0) && (
          <div className="col-auto d-flex">
            <div className="mr-2">项目:</div>

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
          <h2 className="mb-0">连接</h2>
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
        <ConnectionNode first title="您的应用">
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
              color="link"
              className="btn-sm"
              onClick={async () => {
                await mutate();
              }}
            >
              <BsArrowRepeat /> 重试
            </Button>
          }
        />
        {hasProxy && (
          <>
            <ConnectionNode
              title={
                <>
                  <BsLightningFill className="text-warning" /> GB代理
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
      <div className="row mb-3 align-items-center">
        <div className="flex-1"></div>
        <div className="col-auto">
          <Tooltip
            body={
              <div style={{ lineHeight: 1.5 }}>
                <p className="mb-0">
                  <BsLightningFill className="text-warning" />
                  <strong>流式更新</strong> 允许您在 GrowthBook 中进行任何功能更改时，即时更新任何已订阅的软件开发工具包（SDK）。对于前端 SDK，活跃用户无需刷新页面即可立即看到更改。
                </p>
              </div>
            }
          >
            <BsLightningFill className="text-warning" />
            流式更新:{" "}
            <strong>{isCloud() || hasProxy? "已启用" : "已禁用"}</strong>
            <div
              className="text-right text-muted"
              style={{ fontSize: "0.75rem" }}
            >
              这是什么? <FaInfoCircle />
            </div>
          </Tooltip>
        </div>
      </div>
      <SdkWebhooks connection={connection} />
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