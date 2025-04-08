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
import type { SDKLanguage } from "back-end/types/sdk-connection";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Box, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBAddCircle, GBHashLock, GBRemoteEvalIcon } from "@/components/Icons";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSDKConnections from "@/hooks/useSDKConnections";
import StatusCircle from "@/components/Helpers/StatusCircle";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useEnvironments } from "@/services/features";
import Badge from "@/components/Radix/Badge";
import Button from "@/components/Radix/Button";
import SDKLanguageLogo, {
  getLanguagesByFilter,
  languageMapping,
} from "./SDKLanguageLogo";
import SDKConnectionForm from "./SDKConnectionForm";
import { SDKLanguageOption } from "./SDKLanguageSelector";

function popularLanguagesFirst(a: SDKLanguage, b: SDKLanguage) {
  const isAPopular = languageMapping[a].filters.includes("popular");
  const isBPopular = languageMapping[b].filters.includes("popular");

  if (isAPopular && !isBPopular) return -1;
  if (!isAPopular && isBPopular) return 1;
  return 0;
}

export default function SDKConnectionsList() {
  const { data, mutate, error } = useSDKConnections();
  const connections = data?.connections ?? [];

  const [modalOpen, setModalOpen] = useState(false);

  const environments = useEnvironments();
  const { projects, project } = useDefinitions();

  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();

  const canCreateSDKConnections = permissionsUtil.canViewCreateSDKConnectionModal(
    project
  );

  const gb = useGrowthBook();

  let useNewEmptyStateLayout = false;
  if (data && connections.length === 0 && canCreateSDKConnections) {
    useNewEmptyStateLayout = gb.isOn("sdk-connections-new-empty-state");
  }

  const [
    initialModalSelectedLanguage,
    setInitialModalSelectedLanguage,
  ] = useState<SDKLanguage | null>(null);
  const [showAllSdkLanguages, setShowAllSdkLanguages] = useState(false);
  const sdkLanguagesToShow = getLanguagesByFilter(
    showAllSdkLanguages ? "all" : "popular"
  ).sort(popularLanguagesFirst);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const emptyStateContentControl = (
    <div className="appbox p-5 text-center">
      <p>
        <strong>SDK连接</strong> 可轻松将GrowthBook集成到您的前端、后端或移动应用程序中。
      </p>
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setModalOpen(true);
        }}
      >
        <GBAddCircle /> 创建新的SDK连接
      </button>
    </div>
  );

  const emptyStateContentExperiment = (
    <Box
      pt="9"
      pb="7"
      px="10%"
      mb="4"
      style={{ backgroundColor: "var(--color-panel-solid)" }}
    >
      <Flex direction="column" align="center">
        <Heading as="h2" size="6" align="center">
          轻松将GrowthBook集成到您的应用程序或网站中
        </Heading>
        <Text size="3" align="center">
          选择我们的一个SDK来连接您的前端、后端或移动应用。
        </Text>
      </Flex>

      <Separator size="4" mt="7" mb="6" />

      <Flex
        justify="start"
        direction={{
          initial: "column",
          xs: "row",
        }}
        wrap="wrap"
        gapX="5"
        gapY="4"
        mb="7"
      >
        {sdkLanguagesToShow.map((language) => (
          <SDKLanguageOption
            key={language}
            language={language}
            selected={false}
            onClick={() => {
              setInitialModalSelectedLanguage(language);
              setModalOpen(true);
            }}
          />
        ))}
      </Flex>

      <Flex justify="center">
        <Button
          variant="ghost"
          onClick={() => setShowAllSdkLanguages(!showAllSdkLanguages)}
          size="sm"
        >
          {showAllSdkLanguages ? "显示较少" : "显示全部"}
        </Button>
      </Flex>
    </Box>
  );

  return (
    <div>
      {modalOpen && (
        <SDKConnectionForm
          initialValue={{
            languages: initialModalSelectedLanguage
              ? [initialModalSelectedLanguage]
              : [],
          }}
          close={() => setModalOpen(false)}
          mutate={mutate}
          edit={false}
        />
      )}

      <div className="row align-items-center mb-4">
        <div className="col-auto">
          <h1 className="mb-0">SDK连接</h1>
        </div>
        {canCreateSDKConnections &&
          (useNewEmptyStateLayout || connections.length > 0) ? (
          <div className="col-auto ml-auto">
            <Button onClick={() => setModalOpen(true)}>
              添加SDK连接
            </Button>
          </div>
        ) : null}
      </div>

      {connections.length === 0 ? (
        <>
          {!canCreateSDKConnections ? (
            <div className="appbox p-5 text-center">
              <p>
                您无权创建SDK连接。请联系您的账户管理员
              </p>
            </div>
          ) : useNewEmptyStateLayout ? (
            emptyStateContentExperiment
          ) : (
            emptyStateContentControl
          )}
        </>
      ) : null}

      {connections.length > 0 && (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th style={{ width: 25 }}></th>
              <th>名称</th>
              {projects.length > 0 && <th>Projects</th>}
              <th>环境</th>
              <th className="text-center">支持Features</th>
              <th>语言</th>
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
                (e) => e.id === connection.environment
              );
              const envProjects = environment?.projects ?? [];
              const filteredProjectIds = filterProjectsByEnvironment(
                connection.projects,
                environment,
                true
              );
              const showAllEnvironmentProjects =
                connection.projects.length === 0 &&
                filteredProjectIds.length > 0;
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
                          ? "连接成功"
                          : "无法验证连接"
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
                          key="All env projects"
                          color="teal"
                          variant="solid"
                          label={`所有环境项目 (${envProjects.length})`}
                        />
                      )}
                      <div
                        className={clsx("d-flex flex-wrap align-items-center", {
                          "small mt-1": showAllEnvironmentProjects,
                        })}
                        style={{ gap: "0.5rem" }}
                      >
                        <ProjectBadges
                          projectIds={
                            filteredProjectIdsWithDisallowed.length
                              ? filteredProjectIdsWithDisallowed
                              : undefined
                          }
                          invalidProjectIds={disallowedProjectIds}
                          invalidProjectMessage="此项目在所选环境中不被允许，将不会包含在SDK负载中。"
                          resourceType="sdk connection"
                          skipMargin={true}
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
                            <strong>远程评估</strong> 已启用
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
                            <strong>安全属性哈希</strong> 已启用，用于此连接的SDK负载
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
                            <strong>加密</strong> 已启用，用于此连接的SDK负载
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
                            <strong>GB代理</strong> 已启用
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
                            支持<strong>视觉实验</strong>
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
                            支持<strong>URL重定向</strong>
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
    </div>
  );
}
