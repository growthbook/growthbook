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
          ? "Experiment Health is not available for Mixpanel or (legacy) Google Analytics data sources"
          : "Set the Dimension to None to see Experiment Health"
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
        throw new Error("You do not have permission to start this experiment");
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
            cta="Continue"
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
                ? "incomplete-checklist"
                : "complete-checklist"
            }
            open={true}
            size="md"
            closeCta={
              checklistIncomplete || !verifiedConnections.length
                ? "Close"
                : "Start Immediately"
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
                    Start Anyway
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
                    Cancel
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
                  You have{" "}
                  <strong>
                    {checklistItemsRemaining} task
                    {checklistItemsRemaining > 1 ? "s " : " "}
                  </strong>
                  left to complete. Review the Pre-Launch Checklist before
                  starting this experiment.
                </div>
              ) : null}
              {!verifiedConnections.length ? (
                <div className="alert alert-warning">
                  You haven&apos;t integrated GrowthBook into your app.{" "}
                  {connections.length > 0 ? (
                    <Link href="/sdks">Manage SDK Connections</Link>
                  ) : (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowStartExperiment(false);
                        setShowSdkForm(true);
                      }}
                    >
                      Add SDK Connection
                    </a>
                  )}
                </div>
              ) : null}
              <div>
                Once started, linked changes will be activated and users will
                begin to see your experiment variations{" "}
                <strong>immediately</strong>.
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
                <div className="badge badge-secondary">archived</div>
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
                    body="Add at least one live Linked Feature, Visual Editor change, or URL Redirect before starting."
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
                      Start Experiment <MdRocketLaunch />
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
                    Edit targeting & traffic
                  </button>
                )}
                {canRunExperiment &&
                  !(isBandit && experiment.status === "running") && (
                    <button
                      className="dropdown-item"
                      onClick={() => setStatusModal(true)}
                    >
                      Edit status
                    </button>
                  )}
                {editPhases && !isBandit && (
                  <button
                    className="dropdown-item"
                    onClick={() => editPhases()}
                  >
                    Edit phases
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
                  View watchers{" "}
                  <span className="badge badge-pill badge-info">
                    {usersWatching.length}
                  </span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => setAuditModal(true)}
                >
                  Audit log
                </button>
                {duplicate && (
                  <button className="dropdown-item" onClick={duplicate}>
                    Duplicate
                  </button>
                )}
                {canRunExperiment && (
                  <ConfirmButton
                    modalHeader="Archive Experiment"
                    confirmationText={
                      <div>
                        <p>Are you sure you want to archive this experiment?</p>
                        {!safeToEdit ? (
                          <div className="alert alert-danger">
                            This will immediately stop all linked Feature Flags
                            and Visual Changes from running
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
                    cta="Archive"
                  >
                    <button className="dropdown-item" type="button">
                      Archive
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
                    Unarchive
                  </button>
                )}
                {canDeleteExperiment && (
                  <DeleteButton
                    className="dropdown-item text-danger"
                    useIcon={false}
                    text="Delete"
                    displayName="Experiment"
                    additionalMessage={
                      !safeToEdit ? (
                        <div className="alert alert-danger">
                          Deleting this experiment will also affect all linked
                          Feature Flags and Visual Changes
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
                      <FaHome /> Overview
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
                      <PiChartBarHorizontalFill /> Results
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
                        <FaMagnifyingGlassChart /> Explore
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
                      <FaHeartPulse /> Health
                    </span>
                  </DisabledHealthTabTooltip>
                ) : (
                  <TabButton
                    active={tab === "health"}
                    display={
                      <>
                        <FaHeartPulse /> Health
                      </>
                    }
                    anchor="health"
                    onClick={() => {
                      track("Open health tab", { source: "tab-click" });
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
                    ({daysBetween(startDate, endDate || new Date())} days)
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

  return (
    <Tooltip
      body="Can be converted only while in draft mode"
      shouldDisplay={experiment.status !== "draft"}
      usePortal={true}
      tipPosition="left"
    >
      <ConfirmButton
        modalHeader={`Convert to ${isBandit ? "Experiment" : "Bandit"}`}
        disabled={experiment.status !== "draft"}
        size="lg"
        confirmationText={
          <div>
            <p>
              Are you sure you want to convert this{" "}
              {!isBandit ? "Experiment" : "Bandit"} to a{" "}
              <strong>{isBandit ? "Experiment" : "Bandit"}</strong>?
            </p>
            {!isBandit && experiment.goalMetrics.length > 0 && (
              <div className="alert alert-warning">
                <Collapsible
                  trigger={
                    <div>
                      <FaExclamationTriangle className="mr-2" />
                      Some of your experiment settings may be altered. More info{" "}
                      <FaAngleRight className="chevron" />
                    </div>
                  }
                  transitionTime={100}
                >
                  <ul className="ml-0 pl-3 mt-3">
                    <li>
                      A <strong>single decision metric</strong> will be
                      automatically assigned. You may change this before running
                      the experiment.
                    </li>
                    <li>
                      Experiment variations will begin with{" "}
                      <strong>equal weights</strong> (
                      {experiment.variations
                        .map((_, i) =>
                          i < 3
                            ? formatPercent(
                                1 / (experiment.variations.length ?? 2)
                              )
                            : i === 3
                            ? "..."
                            : null
                        )
                        .filter(Boolean)
                        .join(", ")}
                      ).
                    </li>
                    <li>
                      The stats engine will be locked to{" "}
                      <strong>Bayesian</strong>.
                    </li>
                    <li>
                      Any <strong>Activation Metric</strong>,{" "}
                      <strong>Segments</strong>,{" "}
                      <strong>Conversion Window overrides</strong>,{" "}
                      <strong>Custom SQL Filters</strong>, or{" "}
                      <strong>Metric Overrides</strong> will be removed.
                    </li>
                  </ul>
                </Collapsible>
              </div>
            )}
          </div>
        }
        onClick={async () => {
          if (!isBandit && !hasMultiArmedBanditFeature) return;
          try {
            await apiCall(`/experiment/${experiment.id}`, {
              method: "POST",
              body: JSON.stringify({
                type: !isBandit ? "multi-armed-bandit" : "standard",
              }),
            });
            mutate();
          } catch (e) {
            console.error(e);
          }
        }}
        cta={
          isBandit ? (
            "Convert"
          ) : (
            <PremiumTooltip
              body={null}
              commercialFeature="multi-armed-bandits"
              usePortal={true}
            >
              Convert
            </PremiumTooltip>
          )
        }
        ctaEnabled={isBandit || hasMultiArmedBanditFeature}
      >
        <button
          className="dropdown-item"
          type="button"
          disabled={experiment.status !== "draft"}
        >
          Convert to {isBandit ? "Experiment" : "Bandit"}
        </button>
      </ConfirmButton>
    </Tooltip>
  );
}
