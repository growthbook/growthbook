import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { FaAngleRight, FaExclamationTriangle, FaHome } from "react-icons/fa";
import { PiChartBarHorizontalFill } from "react-icons/pi";
import { FaHeartPulse, FaMagnifyingGlassChart } from "react-icons/fa6";
import { useRouter } from "next/router";
import {
  experimentHasLiveLinkedChanges,
  getAffectedEnvsForExperiment,
} from "shared/util";
import React, { ReactNode, useState } from "react";
import { date, daysBetween } from "shared/dates";
import { MdRocketLaunch } from "react-icons/md";
import clsx from "clsx";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Link from "next/link";
import Collapsible from "react-collapsible";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useAuth } from "@/services/auth";
import WatchButton from "@/components/WatchButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import TabButtons from "@/components/Tabs/TabButtons";
import TabButton from "@/components/Tabs/TabButton";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import Modal from "@/components/Modal";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import Tooltip from "@/components/Tooltip/Tooltip";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCelebration } from "@/hooks/useCelebration";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import useSDKConnections from "@/hooks/useSDKConnections";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { formatPercent } from "@/services/metrics";
import { AppFeatures } from "@/types/app-features";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import ExperimentStatusIndicator from "./ExperimentStatusIndicator";
import ExperimentActionButtons from "./ExperimentActionButtons";
import ProjectTagBar from "./ProjectTagBar";
import { ExperimentTab } from ".";

export interface Props {
  tab: ExperimentTab;
  setTab: (tab: ExperimentTab) => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  duplicate?: (() => void) | null;
  setEditNameOpen: (open: boolean) => void;
  setStatusModal: (open: boolean) => void;
  setAuditModal: (open: boolean) => void;
  setWatchersModal: (open: boolean) => void;
  editResult?: () => void;
  safeToEdit: boolean;
  usersWatching: (string | undefined)[];
  checklistItemsRemaining: number | null;
  newPhase?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editPhases?: (() => void) | null;
  editProject?: (() => void) | null;
  editTags?: (() => void) | null;
  healthNotificationCount: number;
  verifiedConnections: SDKConnectionInterface[];
  linkedFeatures: LinkedFeatureInfo[];
}

const datasourcesWithoutHealthData = new Set(["mixpanel", "google_analytics"]);

const DisabledHealthTabTooltip = ({
  reason,
  children,
}: {
  reason: "UNSUPPORTED_DATASOURCE" | "DIMENSION_SELECTED";
  children: ReactNode;
}) => {
  return (
    <Tooltip
      body={
        reason === "UNSUPPORTED_DATASOURCE"
          ? "对于Mixpanel或（旧版）Google Analytics数据源，无法使用实验健康状况功能"
          : "将维度设置为无，以查看实验健康状况"
      }
    >
      {children}
    </Tooltip>
  );
};

export default function ExperimentHeader({
  tab,
  setTab,
  experiment,
  mutate,
  setEditNameOpen,
  duplicate,
  setAuditModal,
  setStatusModal,
  setWatchersModal,
  safeToEdit,
  usersWatching,
  editResult,
  checklistItemsRemaining,
  editTargeting,
  newPhase,
  editPhases,
  editProject,
  editTags,
  healthNotificationCount,
  verifiedConnections,
  linkedFeatures,
}: Props) {
  const growthbook = useGrowthBook<AppFeatures>();

  const { apiCall } = useAuth();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const dataSource = getDatasourceById(experiment.datasource);
  const { scrollY } = useScrollPosition();
  const headerPinned = scrollY > 45;
  const startCelebration = useCelebration();
  const { data: sdkConnections } = useSDKConnections();
  const { phase } = useSnapshot();
  const connections = sdkConnections?.connections || [];
  const [showSdkForm, setShowSdkForm] = useState(false);

  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex] as
    | undefined
    | ExperimentPhaseStringDates;
  const startDate = phases?.[0]?.dateStarted
    ? date(phases[0].dateStarted)
    : null;
  const endDate =
    phases.length > 0
      ? lastPhase?.dateEnded
        ? date(lastPhase.dateEnded ?? "")
        : "now"
      : new Date();
  const viewingOldPhase = phases.length > 0 && phase < phases.length - 1;

  const [showStartExperiment, setShowStartExperiment] = useState(false);

  const hasUpdatePermissions = permissionsUtil.canViewExperimentModal(
    experiment.project
  );
  const canDeleteExperiment = permissionsUtil.canDeleteExperiment(experiment);
  const canEditExperiment = !experiment.archived && hasUpdatePermissions;

  let hasRunExperimentsPermission = true;
  const envs = getAffectedEnvsForExperiment({ experiment });
  if (envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, envs)) {
      hasRunExperimentsPermission = false;
    }
  }
  const canRunExperiment = canEditExperiment && hasRunExperimentsPermission;
  const checklistIncomplete =
    checklistItemsRemaining !== null && checklistItemsRemaining > 0;

  const isUsingHealthUnsupportDatasource =
    !dataSource || datasourcesWithoutHealthData.has(dataSource.type);
  const disableHealthTab = isUsingHealthUnsupportDatasource;

  const isBandit = experiment.type === "multi-armed-bandit";

  async function startExperiment() {
    if (!experiment.phases?.length) {
      if (newPhase) {
        newPhase();
        return;
      } else {
        throw new Error("您没有权限启动此实验");
      }
    }

    try {
      await apiCall(`/experiment/${experiment.id}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: "running",
        }),
      });
      await mutate();
      startCelebration();

      track("Start experiment", {
        source: "experiment-start-banner",
        action: "main CTA",
      });
      setTab("results");
      setShowStartExperiment(false);
    } catch (e) {
      setShowStartExperiment(false);
      throw e;
    }
  }

  return (
    <>
      <div className="experiment-header bg-white px-3 pt-3">
        {showSdkForm && (
          <InitialSDKConnectionForm
            close={() => setShowSdkForm(false)}
            includeCheck={true}
            cta="继续"
            goToNextStep={() => {
              setShowSdkForm(false);
            }}
          />
        )}
        {showStartExperiment && experiment.status === "draft" && (
          <Modal
            trackingEventModalType="start-experiment"
            trackingEventModalSource={
              checklistIncomplete || !verifiedConnections.length
                ? "未完成清单"
                : "已完成清单"
            }
            open={true}
            size="md"
            closeCta={
              checklistIncomplete || !verifiedConnections.length
                ? "关闭"
                : "立即启动"
            }
            closeCtaClassName="btn btn-primary"
            onClickCloseCta={
              checklistIncomplete || !verifiedConnections.length
                ? () => setShowStartExperiment(false)
                : async () => startExperiment()
            }
            secondaryCTA={
              checklistIncomplete || !verifiedConnections.length ? (
                <button
                  className="btn btn-link text-decoration-none"
                  onClick={async () => startExperiment()}
                >
                  <span
                    style={{
                      color: "var(--text-color-primary)",
                    }}
                  >
                    强制启动
                  </span>
                </button>
              ) : (
                <button
                  className="btn btn-link text-decoration-none"
                  onClick={() => setShowStartExperiment(false)}
                >
                  <span
                    style={{
                      color: "var(--text-color-primary)",
                    }}
                  >
                    取消
                  </span>
                </button>
              )
            }
            close={() => setShowStartExperiment(false)}
            header="Start Experiment"
          >
            <div className="p-2">
              {checklistIncomplete ? (
                <div className="alert alert-warning">
                  您还有{" "}
                  <strong>
                    {checklistItemsRemaining} 项任务
                    {/* {checklistItemsRemaining > 1 ? "s " : " "} */}
                  </strong>
                  未完成。在启动此实验之前，请查看启动前清单。
                </div>
              ) : null}
              {!verifiedConnections.length ? (
                <div className="alert alert-warning">
                  您尚未将GrowthBook集成到您的应用程序中。{" "}
                  {connections.length > 0 ? (
                    <Link href="/sdks">管理SDK连接</Link>
                  ) : (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowStartExperiment(false);
                        setShowSdkForm(true);
                      }}
                    >
                      添加SDK连接
                    </a>
                  )}
                </div>
              ) : null}
              <div>
                一旦启动，关联的更改将被激活，用户将{" "}
                <strong>立即</strong> 看到您的实验版本。
              </div>
            </div>
          </Modal>
        )}
        <div className="container-fluid pagecontents position-relative">
          <div className="d-flex align-items-center">
            <div>
              <HeaderWithEdit
                className="h1 mb-0"
                containerClassName=""
                edit={
                  canRunExperiment ? () => setEditNameOpen(true) : undefined
                }
                editClassName="ml-1"
              >
                {experiment.name}
              </HeaderWithEdit>
            </div>

            <div className="ml-auto flex-1"></div>

            <div className="ml-3 d-md-block d-none">
              {experiment.archived ? (
                <div className="badge badge-secondary">已归档</div>
              ) : (
                <ExperimentStatusIndicator
                  status={experiment.status}
                  subStatus={
                    experiment.type === "multi-armed-bandit" &&
                      experiment.status === "running" &&
                      experiment.banditStage === "explore"
                      ? "exploratory"
                      : undefined
                  }
                />
              )}
            </div>

            {canRunExperiment ? (
              <div className="ml-2 flex-shrink-0">
                {experiment.status === "running" ? (
                  <ExperimentActionButtons
                    editResult={editResult}
                    editTargeting={editTargeting}
                    isBandit={isBandit}
                  />
                ) : experiment.status === "stopped" && experiment.results ? (
                  <div className="experiment-status-widget border d-flex">
                    <div
                      className="d-flex"
                      style={{ height: 30, lineHeight: "30px" }}
                    >
                      <ResultsIndicator results={experiment.results} />
                    </div>
                  </div>
                ) : experiment.status === "draft" ? (
                  <Tooltip
                    shouldDisplay={
                      isBandit &&
                      !experimentHasLiveLinkedChanges(
                        experiment,
                        linkedFeatures
                      )
                    }
                    body="在启动之前，请添加至少一个实时关联功能、可视化编辑器更改或URL重定向。"
                  >
                    <button
                      className="btn btn-teal"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowStartExperiment(true);
                      }}
                      disabled={
                        isBandit &&
                        !experimentHasLiveLinkedChanges(
                          experiment,
                          linkedFeatures
                        )
                      }
                    >
                      启动实验 <MdRocketLaunch />
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}

            <div className="ml-2">
              <MoreMenu>
                {experiment.status !== "running" && editTargeting && (
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      editTargeting();
                    }}
                  >
                    编辑目标定位与流量
                  </button>
                )}
                {canRunExperiment &&
                  !(isBandit && experiment.status === "running") && (
                    <button
                      className="dropdown-item"
                      onClick={() => setStatusModal(true)}
                    >
                      编辑状态
                    </button>
                  )}
                {editPhases && !isBandit && (
                  <button
                    className="dropdown-item"
                    onClick={() => editPhases()}
                  >
                    编辑阶段
                  </button>
                )}
                {canRunExperiment && growthbook.isOn("bandits") && (
                  <ConvertBanditExperiment
                    experiment={experiment}
                    mutate={mutate}
                  />
                )}
                <WatchButton
                  itemType="experiment"
                  item={experiment.id}
                  className="dropdown-item text-dark"
                />
                <button
                  className="dropdown-item"
                  onClick={() => setWatchersModal(true)}
                >
                  查看关注者{" "}
                  <span className="badge badge-pill badge-info">
                    {usersWatching.length}
                  </span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => setAuditModal(true)}
                >
                  审计日志
                </button>
                {duplicate && (
                  <button className="dropdown-item" onClick={duplicate}>
                    复制
                  </button>
                )}
                {canRunExperiment && (
                  <ConfirmButton
                    modalHeader="归档实验"
                    confirmationText={
                      <div>
                        <p>您确定要归档此实验吗？</p>
                        {!safeToEdit ? (
                          <div className="alert alert-danger">
                            这将立即停止所有关联的特性标志和可视化更改的运行。
                          </div>
                        ) : null}
                      </div>
                    }
                    onClick={async () => {
                      try {
                        await apiCall(`/experiment/${experiment.id}/archive`, {
                          method: "POST",
                        });
                        mutate();
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    cta="归档"
                  >
                    <button className="dropdown-item" type="button">
                      归档
                    </button>
                  </ConfirmButton>
                )}
                {hasUpdatePermissions && experiment.archived && (
                  <button
                    className="dropdown-item"
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        await apiCall(
                          `/experiment/${experiment.id}/unarchive`,
                          {
                            method: "POST",
                          }
                        );
                        mutate();
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                  >
                    取消归档
                  </button>
                )}
                {canDeleteExperiment && (
                  <DeleteButton
                    className="dropdown-item text-danger"
                    useIcon={false}
                    text="删除"
                    displayName="实验"
                    additionalMessage={
                      !safeToEdit ? (
                        <div className="alert alert-danger">
                          删除此实验也会影响所有关联的特性标志和可视化更改。
                        </div>
                      ) : null
                    }
                    onClick={async () => {
                      await apiCall<{ status: number; message?: string }>(
                        `/experiment/${experiment.id}`,
                        {
                          method: "DELETE",
                          body: JSON.stringify({ id: experiment.id }),
                        }
                      );
                      router.push(isBandit ? "/bandits" : "/experiments");
                    }}
                  />
                )}
              </MoreMenu>
            </div>
          </div>
          <ProjectTagBar
            experiment={experiment}
            editProject={!viewingOldPhase ? editProject : undefined}
            editTags={!viewingOldPhase ? editTags : undefined}
          />
        </div>
      </div>

      <div
        className={clsx(
          "experiment-tabs bg-white px-3 border-bottom d-print-none",
          {
            pinned: headerPinned,
          }
        )}
      >
        <div className="container-fluid pagecontents position-relative">
          <div className="row align-items-center header-tabs">
            <div
              className="col-auto pt-2 tab-wrapper"
              id="experiment-page-tabs"
            >
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
                  active={tab === "results"}
                  display={
                    <>
                      <PiChartBarHorizontalFill /> 结果
                    </>
                  }
                  anchor="results"
                  onClick={() => setTab("results")}
                  newStyle={false}
                  activeClassName="active-tab"
                  last={false}
                />
                {isBandit && (
                  <TabButton
                    active={tab === "explore"}
                    display={
                      <>
                        <FaMagnifyingGlassChart /> 探索
                      </>
                    }
                    anchor="explore"
                    onClick={() => setTab("explore")}
                    newStyle={false}
                    activeClassName="active-tab"
                    last={false}
                  />
                )}
                {disableHealthTab ? (
                  <DisabledHealthTabTooltip reason="UNSUPPORTED_DATASOURCE">
                    <span className="nav-item nav-link text-muted">
                      <FaHeartPulse /> 健康状况
                    </span>
                  </DisabledHealthTabTooltip>
                ) : (
                  <TabButton
                    active={tab === "health"}
                    display={
                      <>
                        <FaHeartPulse /> 健康状况
                      </>
                    }
                    anchor="health"
                    onClick={() => {
                      track("打开健康状况标签", { source: "tab-click" });
                      setTab("health");
                    }}
                    newStyle={false}
                    activeClassName="active-tab"
                    last={true}
                    notificationCount={healthNotificationCount}
                  />
                )}
              </TabButtons>
            </div>

            <div className="flex-1" />
            <div className="col-auto experiment-date-range">
              {startDate && (
                <>
                  {startDate} — {endDate}{" "}
                  <span className="text-muted">
                    ({daysBetween(startDate, endDate || new Date())} 天)
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function ConvertBanditExperiment({
  experiment,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const isBandit = experiment.type === "multi-armed-bandit";
  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits"
  );

  // return (
  //   <Tooltip
  //     body="仅在草稿模式下可转换"
  //     shouldDisplay={experiment.status !== "draft"}
  //     usePortal={true}
  //     tipPosition="left"
  //   >
  //     <ConfirmButton
  //       modalHeader={`转换为${isBandit ? "实验" : "多臂老虎机"}`}
  //       disabled={experiment.status !== "draft"}
  //       size="lg"
  //       confirmationText={
  //         <div>
  //           <p>
  //             您确定要将此{!isBandit ? "实验" : "多臂老虎机"}转换为{" "}
  //             <strong>{isBandit ? "实验" : "多臂老虎机"}</strong>吗？
  //           </p>
  //           {!isBandit && experiment.goalMetrics.length > 0 && (
  //             <div className="alert alert-warning">
  //               <Collapsible
  //                 trigger={
  //                   <div>
  //                     <FaExclamationTriangle className="mr-2" />
  //                     您的一些实验设置可能会被更改。更多信息{" "}
  //                     <FaAngleRight className="chevron" />
  //                   </div>
  //                 }
  //                 transitionTime={100}
  //               >
  //                 <ul className="ml-0 pl-3 mt-3">
  //                   <li>
  //                     一个< strong>单一决策指标</strong>将被自动分配。您可以在运行实验之前更改它。
  //                   </li>
  //                   <li>
  //                     实验版本将以< strong>相等权重</strong>开始 (
  //                     {experiment.variations
  //                       .map((_, i) =>
  //                         i < 3
  //                           ? formatPercent(
  //                             1 / (experiment.variations.length ?? 2)
  //                           )
  //                           : i === 3
  //                             ? "..."
  //                             : null
  //                       )
  //                       .filter(Boolean)
  //                       .join(", ")}
  //                     ).
  //                   </li>
  //                   <li>
  //                     统计引擎将被锁定为<strong>贝叶斯</strong>。
  //                   </li>
  //                   <li>
  //                     任何< strong>激活指标</strong>、< strong>细分</strong>、< strong>转化窗口覆盖</strong>、< strong>自定义SQL过滤器</strong>或< strong>指标覆盖</strong>都将被删除。
  //                   </li>
  //                 </ul>
  //               </Collapsible>
  //             </div>
  //           )}
  //         </div>
  //       }
  //       onClick={async () => {
  //         if (!isBandit && !hasMultiArmedBanditFeature) return;
  //         try {
  //           await apiCall(`/experiment/${experiment.id}`, {
  //             method: "POST",
  //             body: JSON.stringify({
  //               type: !isBandit ? "multi-armed-bandit" : "standard",
  //             }),
  //           });
  //           mutate();
  //         } catch (e) {
  //           console.error(e);
  //         }
  //       }}
  //       cta={
  //         isBandit ? (
  //           "Convert"
  //         ) : (
  //           <PremiumTooltip
  //             body={null}
  //             commercialFeature="multi-armed-bandits"
  //             usePortal={true}
  //           >
  //             转换
  //           </PremiumTooltip>
  //         )
  //       }
  //       ctaEnabled={isBandit || hasMultiArmedBanditFeature}
  //     >
  //       <button
  //         className="dropdown-item"
  //         type="button"
  //         disabled={experiment.status !== "draft"}
  //       >
  //         转换为{isBandit ? "实验" : "多臂老虎机"}
  //       </button>
  //     </ConfirmButton>
  //   </Tooltip>
  // );
}
