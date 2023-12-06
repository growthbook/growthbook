import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { FaHome } from "react-icons/fa";
import { PiChartBarHorizontalFill } from "react-icons/pi";
import { FaHeartPulse } from "react-icons/fa6";
import { useRouter } from "next/router";
import { getAffectedEnvsForExperiment } from "shared/util";
import React, { ReactNode, useState } from "react";
import { date, daysBetween } from "shared/dates";
import { MdRocketLaunch } from "react-icons/md";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import clsx from "clsx";
import { useAuth } from "@/services/auth";
import WatchButton from "@/components/WatchButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import TabButtons from "@/components/Tabs/TabButtons";
import TabButton from "@/components/Tabs/TabButton";
import usePermissions from "@/hooks/usePermissions";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import Modal from "@/components/Modal";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import Tooltip from "@/components/Tooltip/Tooltip";
import track from "@/services/track";
import ResultsIndicator from "../ResultsIndicator";
import { StartExperimentBanner } from "../StartExperimentBanner";
import { useSnapshot } from "../SnapshotProvider";
import ExperimentStatusIndicator from "./ExperimentStatusIndicator";
import StopExperimentButton from "./StopExperimentButton";
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
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  connections: SDKConnectionInterface[];
  newPhase?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editPhases?: (() => void) | null;
  healthNotificationCount: number;
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
  connections,
  linkedFeatures,
  visualChangesets,
  editTargeting,
  newPhase,
  editPhases,
  healthNotificationCount,
}: Props) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const permissions = usePermissions();
  const { scrollY } = useScrollPosition();
  const { dimension } = useSnapshot();
  const headerPinned = scrollY > 45;

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

  const [startExperiment, setStartExperiment] = useState(false);

  const canCreateAnalyses = permissions.check(
    "createAnalyses",
    experiment.project
  );
  const canEditExperiment = !experiment.archived && canCreateAnalyses;

  let hasRunExperimentsPermission = true;
  const envs = getAffectedEnvsForExperiment({ experiment });
  if (envs.length > 0) {
    if (!permissions.check("runExperiments", experiment.project, envs)) {
      hasRunExperimentsPermission = false;
    }
  }
  const canRunExperiment = canEditExperiment && hasRunExperimentsPermission;

  const hasLinkedChanges =
    linkedFeatures.length > 0 || visualChangesets.length > 0;

  const isUsingHealthUnsupportDatasource = datasourcesWithoutHealthData.has(
    experiment.datasource
  );
  const disableHealthTab = isUsingHealthUnsupportDatasource || !!dimension;

  return (
    <>
      <div className="experiment-header bg-white px-3 pt-3">
        {startExperiment && experiment.status === "draft" && (
          <Modal
            open={true}
            size="lg"
            close={() => setStartExperiment(false)}
            header="Start Experiment"
          >
            <div className="alert alert-info">
              When you start this experiment, all linked Feature Flags rules and
              Visual Editor changes will be activated and users will begin to
              see your variations. Double check the list below to make sure
              you&apos;re ready.
            </div>
            <StartExperimentBanner
              connections={connections}
              experiment={experiment}
              linkedFeatures={linkedFeatures}
              mutateExperiment={mutate}
              visualChangesets={visualChangesets}
              editTargeting={editTargeting}
              newPhase={newPhase}
              openSetupTab={
                tab !== "overview" ? () => setTab("overview") : undefined
              }
              onStart={() => {
                setTab("results");
                setStartExperiment(false);
              }}
              className=""
              noConfirm={true}
            />
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
                <ExperimentStatusIndicator status={experiment.status} />
              )}
            </div>

            <div className="ml-2">
              {experiment.status === "running" ? (
                <StopExperimentButton
                  editResult={editResult}
                  editTargeting={editTargeting}
                  coverage={lastPhase?.coverage}
                  hasLinkedChanges={hasLinkedChanges}
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
                <button
                  className="btn btn-teal"
                  onClick={(e) => {
                    e.preventDefault();
                    setStartExperiment(true);
                  }}
                >
                  Start Experiment <MdRocketLaunch />
                </button>
              ) : null}
            </div>

            <div className="ml-2">
              <MoreMenu>
                {editTargeting && (
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      editTargeting();
                    }}
                  >
                    Edit targeting / rollout
                  </button>
                )}
                {canRunExperiment && (
                  <button
                    className="dropdown-item"
                    onClick={() => setStatusModal(true)}
                  >
                    Edit status
                  </button>
                )}
                <button
                  className="dropdown-item"
                  onClick={() => setAuditModal(true)}
                >
                  Audit log
                </button>
                {editPhases && (
                  <button
                    className="dropdown-item"
                    onClick={() => editPhases()}
                  >
                    Edit phases
                  </button>
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
                {canCreateAnalyses && experiment.archived && (
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
                {canCreateAnalyses && (
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
                      router.push("/experiments");
                    }}
                  />
                )}
              </MoreMenu>
            </div>
          </div>
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
                {disableHealthTab ? (
                  <DisabledHealthTabTooltip
                    reason={
                      isUsingHealthUnsupportDatasource
                        ? "UNSUPPORTED_DATASOURCE"
                        : "DIMENSION_SELECTED"
                    }
                  >
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
                      track("Open health tab");
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
