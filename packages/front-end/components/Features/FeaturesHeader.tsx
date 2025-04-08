import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { Text } from "@radix-ui/themes";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { filterEnvironmentsByFeature, isFeatureStale } from "shared/util";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { FaHome, FaExclamationTriangle, FaCode } from "react-icons/fa";
import { ImBlocked } from "react-icons/im";
import { useUser } from "@/services/UserContext";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import StaleFeatureIcon from "@/components/StaleFeatureIcon";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBEdit } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import TabButtons from "@/components/Tabs/TabButtons";
import TabButton from "@/components/Tabs/TabButton";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import FeatureImplementationModal from "@/components/Features/FeatureImplementationModal";
import FeatureModal from "@/components/Features/FeatureModal";
import StaleDetectionModal from "@/components/Features/StaleDetectionModal";
import { FeatureTab } from "@/pages/features/[fid]";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import UserAvatar from "@/components/Avatar/UserAvatar";

export default function FeaturesHeader({
  feature,
  features,
  experiments,
  mutate,
  tab,
  setTab,
  setEditProjectModal,
  setEditTagsModal,
  setEditOwnerModal,
  dependents,
}: {
  feature: FeatureInterface;
  features: FeatureInterface[];
  experiments: ExperimentInterfaceStringDates[] | undefined;
  mutate: () => void;
  tab: FeatureTab;
  setTab: (tab: FeatureTab) => void;
  setEditProjectModal: (open: boolean) => void;
  setEditTagsModal: (open: boolean) => void;
  setEditOwnerModal: (open: boolean) => void;
  dependents: number;
}) {
  const router = useRouter();
  const projectId = feature?.project;
  const firstFeature = router?.query && "first" in router.query;
  const [auditModal, setAuditModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [staleFFModal, setStaleFFModal] = useState(false);
  const [showImplementation, setShowImplementation] = useState(firstFeature);

  const { organization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envs = environments.map((e) => e.id);
  const { apiCall } = useAuth();
  const {
    getProjectById,
    project: currentProject,
    projects,
  } = useDefinitions();

  const { stale, reason } = useMemo(() => {
    if (!feature) return { stale: false };
    return isFeatureStale({
      feature,
      features,
      experiments,
      environments: envs,
    });
  }, [feature, features, experiments, envs]);

  const project = getProjectById(projectId || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const canEdit = permissionsUtil.canViewFeatureModal(projectId);
  const enabledEnvs = getEnabledEnvironments(feature, environments);
  const canPublish = permissionsUtil.canPublishFeature(feature, enabledEnvs);
  const isArchived = feature.archived;

  return (
    <>
      <div className="features-header bg-white pt-3 px-4 border-bottom">
        <div className="pagecontents mx-auto px-3">
          {projectId ===
            getDemoDatasourceProjectIdForOrganization(organization.id) && (
              <div className="alert alert-info mb-3 d-flex align-items-center">
                <div className="flex-1">
                  此功能是我们示例数据集的一部分，展示了功能开关和实验如何关联在一起。你探索完后可以删除它。
                </div>
                <div style={{ width: 180 }} className="ml-2">
                  <DeleteDemoDatasourceButton
                    onDelete={() => router.push("/features")}
                    source="feature"
                  />
                </div>
              </div>
            )}

          <div className="row align-items-center mb-2">
            <div className="col-auto d-flex align-items-center">
              <h1 className="mb-0">{feature.id}</h1>
              {stale && (
                <div className="ml-2">
                  <StaleFeatureIcon
                    staleReason={reason}
                    onClick={() => setStaleFFModal(true)}
                  />
                </div>
              )}
            </div>
            <div style={{ flex: 1 }} />
            <div className="col-auto">
              <MoreMenu>
                <a
                  className="dropdown-item"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowImplementation(true);
                  }}
                >
                  显示实现方式
                </a>
                {canEdit && (
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setStaleFFModal(true);
                    }}
                  >
                    {feature.neverStale
                      ? "启用陈旧检测"
                      : "禁用陈旧检测"}
                  </a>
                )}
                {canEdit && canPublish && (
                  <a
                    className="dropdown-item"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setDuplicateModal(true);
                    }}
                  >
                    复制
                  </a>
                )}
                {canEdit && canPublish && (
                  <Tooltip
                    shouldDisplay={dependents > 0}
                    usePortal={true}
                    body={
                      <>
                        <ImBlocked className="text-danger" /> 此功能有{" "}
                        <strong>
                          {dependents} 个依赖项{dependents !== 1 && "s"}
                        </strong>
                        。在{" "}
                        {dependents === 1 ? "它被移除" : "它们被移除"} 之前，此功能无法存档。
                      </>
                    }
                  >
                    <ConfirmButton
                      onClick={async () => {
                        await apiCall(`/feature/${feature.id}/archive`, {
                          method: "POST",
                        });
                        mutate();
                      }}
                      modalHeader={
                        isArchived ? "取消存档" : "存档"
                      }
                      confirmationText={
                        isArchived ? (
                          <>
                            <p>
                              你确定要继续吗？这将使当前功能再次激活。
                            </p>
                          </>
                        ) : (
                          <>
                            <p>
                              你确定要继续吗？这将使当前功能变为非活动状态。它将不会包含在 API 响应或 Webhook 有效负载中。
                            </p>
                          </>
                        )
                      }
                      cta={isArchived ? "取消存档" : "存档"}
                      ctaColor="danger"
                      disabled={dependents > 0}
                    >
                      <button className="dropdown-item">
                        {isArchived ? "取消存档" : "存档"}
                      </button>
                    </ConfirmButton>
                  </Tooltip>
                )}
                {canEdit && canPublish && (
                  <Tooltip
                    shouldDisplay={dependents > 0}
                    usePortal={true}
                    body={
                      <>
                        <ImBlocked className="text-danger" /> 此功能有{" "}
                        <strong>
                          {dependents} 个依赖项{dependents !== 1 && "s"}
                        </strong>
                        。在{" "}
                        {dependents === 1 ? "它被移除" : "它们被移除"} 之前，此功能无法删除。
                      </>
                    }
                  >
                    <DeleteButton
                      useIcon={false}
                      displayName="Feature"
                      onClick={async () => {
                        await apiCall(`/feature/${feature.id}`, {
                          method: "DELETE",
                        });
                        router.push("/features");
                      }}
                      className="dropdown-item text-danger"
                      text="删除"
                      disabled={dependents > 0}
                    />
                  </Tooltip>
                )}
              </MoreMenu>
            </div>
          </div>
          <div className="mb-2 row">
            {(projects.length > 0 || projectIsDeReferenced) && (
              <div className="col-auto">
                <Text weight="medium">Project: </Text>
                {projectIsDeReferenced ? (
                  <Tooltip
                    body={
                      <>
                        项目 <code>{projectId}</code> 未找到
                      </>
                    }
                  >
                    <span className="text-danger">
                      <FaExclamationTriangle /> 项目不可用
                    </span>
                  </Tooltip>
                ) : currentProject && currentProject !== feature.project ? (
                  <Tooltip
                    body={<>feature不在当前项目中.</>}
                  >
                    {projectId ? <strong>{projectName}</strong> : null}{" "}
                    <FaExclamationTriangle className="text-warning" />
                  </Tooltip>
                ) : projectId ? (
                  <strong>{projectName}</strong>
                ) : null}
                {canEdit && canPublish && (
                  <Tooltip
                    shouldDisplay={dependents > 0}
                    body={
                      <>
                        <ImBlocked className="text-danger" /> 此功能有{" "}
                        <strong>
                          {dependents} 个依赖项{dependents !== 1 && "s"}
                        </strong>
                        。在{" "}
                        {dependents === 1 ? "它被移除" : "它们被移除"} 之前，无法更改项目。
                      </>
                    }
                  >
                    {projectId && (
                      <a
                        className="ml-2 cursor-pointer"
                        onClick={() => {
                          dependents === 0 && setEditProjectModal(true);
                        }}
                      >
                        <GBEdit />
                      </a>
                    )}
                    {!projectId && (
                      <a
                        role="button"
                        className="cursor-pointer button-link"
                        onClick={(e) => {
                          e.preventDefault();
                          dependents === 0 && setEditProjectModal(true);
                        }}
                      >
                        +添加
                      </a>
                    )}
                  </Tooltip>
                )}
              </div>
            )}

            <div className="col-auto">
              <Text weight="medium">类型: </Text>
              {feature.valueType || "未知"}
            </div>

            <div className="col-auto">
              <Text weight="medium">负责人: </Text>
              {feature.owner ? (
                <span>
                  <UserAvatar name={feature.owner} size="sm" variant="soft" />{" "}
                  {feature.owner}
                </span>
              ) : (
                <em className="text-muted">无</em>
              )}{" "}

              {canEdit && (
                <a
                  className="ml-1 cursor-pointer"
                  onClick={() => setEditOwnerModal(true)}
                >
                  <GBEdit />
                </a>
              )}
            </div>

            <div className="col-auto ml-auto">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setAuditModal(true);
                }}
              >
                查看审计日志
              </a>
            </div>
            <div className="col-auto">
              <WatchButton item={feature.id} itemType="feature" type="link" />
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-auto">
              <Text weight="medium">标签: </Text>
              <SortedTags
                tags={feature.tags || []}
                useFlex
                shouldShowEllipsis={false}
              />
              {canEdit && (
                <a
                  className="ml-1 cursor-pointer"
                  onClick={() => setEditTagsModal(true)}
                >
                  <GBEdit />
                </a>
              )}
            </div>
          </div>
          <div>
            {isArchived && (
              <div className="alert alert-secondary mb-2">
                <strong>此功能已存档。</strong> 它将不会包含在 SDK 端点或 Webhook 有效负载中。
              </div>
            )}
          </div>
          <div id="feature-page-tabs">
            <TabButtons className="mb-0 pb-0">
              <TabButton
                active={tab === "overview"}
                display={
                  <>
                    <FaHome /> 概览
                  </>
                }
                anchor="overview"
                onClick={() => setTab("overview")}
                newStyle={false}
                activeClassName="active-tab"
              />
              <TabButton
                active={tab === "stats"}
                display={
                  <>
                    <FaCode /> 代码引用
                  </>
                }
                anchor="stats"
                onClick={() => setTab("stats")}
                newStyle={false}
                activeClassName="active-tab"
              />
            </TabButtons>
          </div>
        </div>
      </div>
      {auditModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="审计日志"
          close={() => setAuditModal(false)}
          size="max"
          closeCta="关闭"
        >
          <HistoryTable type="feature" id={feature.id} />
        </Modal>
      )}
      {duplicateModal && (
        <FeatureModal
          cta={"复制"}
          close={() => setDuplicateModal(false)}
          onSuccess={async (feature) => {
            const url = `/features/${feature.id}`;
            router.push(url);
          }}
          featureToDuplicate={feature}
        />
      )}
      {staleFFModal && (
        <StaleDetectionModal
          close={() => setStaleFFModal(false)}
          feature={feature}
          mutate={mutate}
        />
      )}
      {showImplementation && (
        <FeatureImplementationModal
          feature={feature}
          first={firstFeature}
          close={() => {
            setShowImplementation(false);
          }}
        />
      )}
    </>
  );
}
