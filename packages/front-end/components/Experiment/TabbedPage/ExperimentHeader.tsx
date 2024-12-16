import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { FaAngleRight, FaExclamationTriangle } from "react-icons/fa";
import { useRouter } from "next/router";
import {
  experimentHasLiveLinkedChanges,
  getAffectedEnvsForExperiment,
} from "shared/util";
import React, { ReactNode, useEffect, useRef, useState } from "react";
import { date, daysBetween } from "shared/dates";
import { MdRocketLaunch } from "react-icons/md";
import clsx from "clsx";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Link from "next/link";
import Collapsible from "react-collapsible";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { useAuth } from "@/services/auth";

import ConfirmButton from "@/components/Modal/ConfirmButton";
import { Tabs, TabsList, TabsTrigger } from "@/components/Radix/Tabs";
import Avatar from "@/components/Radix/Avatar";
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
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/components/Radix/DropdownMenu";
import { GBBandit } from "@/components/Icons";
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

// NB: Keep in sync with .experiment-tabs top property in global.scss
const TABS_HEADER_HEIGHT_PX = 55;

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
  const { users } = useUser();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const dataSource = getDatasourceById(experiment.datasource);
  const startCelebration = useCelebration();
  const { data: sdkConnections } = useSDKConnections();
  const { phase, analysis } = useSnapshot();
  const connections = sdkConnections?.connections || [];
  const [showSdkForm, setShowSdkForm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);

  const tabsRef = useRef<HTMLDivElement>(null);
  const [headerPinned, setHeaderPinned] = useState(false);
  const { scrollY } = useScrollPosition();
  useEffect(() => {
    if (!tabsRef.current) return;

    const isHeaderSticky =
      tabsRef.current.getBoundingClientRect().top <= TABS_HEADER_HEIGHT_PX;

    setHeaderPinned(isHeaderSticky);
  }, [scrollY]);

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
      : date(new Date());
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

  const hasResults = !!analysis?.results?.[0];
  const shouldHideTabs =
    experiment.status === "draft" && !hasResults && phases.length === 1;

  const getMemberIdFromName = (owner) => {
    let ownerId: string | null = null;
    Array.from(users.entries()).forEach((info) => {
      if (info[1].name === owner) {
        ownerId = info[1].id;
      }
    });
    return ownerId;
  };

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
      <div className={clsx("experiment-header", "px-3", "pt-3")}>
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
        {showDeleteModal ? (
          <Modal
            header="Delete Experiment"
            trackingEventModalType="delete-experiment"
            trackingEventModalSource="experiment-more-menu"
            open={true}
            close={() => setShowDeleteModal(false)}
            submit={() => console.log("submitted")} //TODO: Update this with the actual api call
          >
            <div>
              <p>Are you sure you want to delete this experiment?</p>
              {!safeToEdit ? (
                <div className="alert alert-danger">
                  This will immediately stop all linked Feature Flags and Visual
                  Changes from running
                </div>
              ) : null}
            </div>
          </Modal>
        ) : null}
        {showArchiveModal ? (
          <Modal
            header="Archive Experiment"
            trackingEventModalType="archive-experiment"
            trackingEventModalSource="experiment-more-menu"
            open={true}
            cta="Archive"
            close={() => setShowArchiveModal(false)}
            submit={async () => {
              try {
                await apiCall(`/experiment/${experiment.id}/archive`, {
                  method: "POST",
                });
                mutate();
              } catch (e) {
                console.error(e);
              }
            }}
          >
            <div>
              <p>Are you sure you want to archive this experiment?</p>
              {!safeToEdit ? (
                <div className="alert alert-danger">
                  This will immediately stop all linked Feature Flags and Visual
                  Changes from running
                </div>
              ) : null}
            </div>
          </Modal>
        ) : null}
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
              <DropdownMenu
                trigger={
                  <button className="btn btn-link text-dark">
                    <BsThreeDotsVertical />
                  </button>
                }
                menuPlacement="end"
              >
                <DropdownMenuGroup>
                  {canRunExperiment &&
                    !isBandit &&
                    experiment.status !== "draft" && (
                      <DropdownMenuItem onClick={() => setStatusModal(true)}>
                        Edit status
                      </DropdownMenuItem>
                    )}
                  {editPhases && !isBandit && (
                    <DropdownMenuItem onClick={() => editPhases()}>
                      Edit phases
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setAuditModal(true)}>
                    Audit log
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {/* TODO: Make the trigger change depending on what status */}
                  <DropdownSubMenu trigger="Watch">
                    <DropdownMenuItem>Start Watching</DropdownMenuItem>
                    <DropdownMenuItem>Stop Watching</DropdownMenuItem>
                  </DropdownSubMenu>
                  <DropdownMenuItem onClick={() => setWatchersModal(true)}>
                    <span className="badge badge-pill badge-info">
                      {usersWatching.length}
                    </span>
                    View watchers
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {canRunExperiment &&
                  growthbook.isOn("bandits") &&
                  experiment.status === "draft" && (
                    <>
                      <DropdownMenuGroup>
                        <DropdownMenuItem>
                          <ConvertBanditExperiment
                            experiment={experiment}
                            mutate={mutate}
                          />
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                    </>
                  )}
                <DropdownMenuGroup>
                  {duplicate && (
                    <DropdownMenuItem onClick={duplicate}>
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  {canRunExperiment && (
                    <DropdownMenuItem onClick={() => setShowArchiveModal(true)}>
                      Archive
                    </DropdownMenuItem>
                  )}
                  {hasUpdatePermissions && experiment.archived && (
                    <DropdownMenuItem onClick={() => console.log("nothing")}>
                      <button
                        //MKTODO: The async here is breaking the menu item
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
                    </DropdownMenuItem>
                  )}
                  {canDeleteExperiment && (
                    <DropdownMenuItem
                      color="red"
                      onClick={() => setShowDeleteModal(true)}
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
                  {/* {canDeleteExperiment && (
                    // This has the issue where the user thinks they're clicking the "delete" button, but they're only clicking the menu item
                    // they need to actually click the ConfirmButton INSIDE of the menu item div
                    <DropdownMenuItem color="red">
                      <ConfirmButton
                        modalHeader="Delete Experiment"
                        confirmationText={
                          <div>
                            <p>
                              Are you sure you want to delete this experiment?
                            </p>
                            {!safeToEdit ? (
                              <div className="alert alert-danger">
                                Deleting this experiment will also affect all
                                linked Feature Flags and Visual Changes
                              </div>
                            ) : null}
                          </div>
                        }
                        onClick={async () => {
                          try {
                            await apiCall<{ status: number; message?: string }>(
                              `/experiment/${experiment.id}`,
                              {
                                method: "DELETE",
                                body: JSON.stringify({ id: experiment.id }),
                              }
                            );
                            router.push(isBandit ? "/bandits" : "/experiments");
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        cta="Delete"
                      >
                        Delete
                      </ConfirmButton>
                    </DropdownMenuItem>
                  )} */}
                </DropdownMenuGroup>
              </DropdownMenu>
            </div>
          </div>
          <ProjectTagBar
            experiment={experiment}
            editProject={!viewingOldPhase ? editProject : undefined}
            editTags={!viewingOldPhase ? editTags : undefined}
            canEditOwner={canEditExperiment}
            updateOwner={async (owner) => {
              const ownerId = getMemberIdFromName(owner);
              if (ownerId) {
                await apiCall(`/experiment/${experiment.id}`, {
                  method: "POST",
                  body: JSON.stringify({ owner: ownerId }),
                });
              } else {
                throw new Error("Could not find this user");
              }
            }}
            mutate={mutate}
          />
        </div>
      </div>

      {shouldHideTabs ? null : (
        <div
          className={clsx("experiment-tabs px-3 d-print-none", {
            pinned: headerPinned,
          })}
        >
          <div className="container-fluid pagecontents position-relative">
            <div className="row header-tabs" ref={tabsRef}>
              <Tabs
                value={tab}
                onValueChange={setTab}
                style={{ width: "100%" }}
              >
                <TabsList size="3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="results">Results</TabsTrigger>
                  {isBandit ? (
                    <TabsTrigger value="explore">Explore</TabsTrigger>
                  ) : null}
                  {disableHealthTab ? (
                    <DisabledHealthTabTooltip reason="UNSUPPORTED_DATASOURCE">
                      <TabsTrigger disabled value="health">
                        Health
                      </TabsTrigger>
                    </DisabledHealthTabTooltip>
                  ) : (
                    <TabsTrigger
                      value="health"
                      onClick={() => {
                        track("Open health tab", { source: "tab-click" });
                      }}
                    >
                      Health
                      {healthNotificationCount > 0 ? (
                        <Avatar size="sm" ml="2" color="red">
                          {healthNotificationCount}
                        </Avatar>
                      ) : null}
                    </TabsTrigger>
                  )}
                </TabsList>
              </Tabs>

              <div className="col-auto experiment-date-range">
                {startDate && (
                  <span>
                    {startDate} — {endDate}{" "}
                    <span className="text-muted">
                      ({daysBetween(startDate, endDate)} days)
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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
        <DropdownMenuItem
          // className="dropdown-item"
          // type="button"
          disabled={experiment.status !== "draft"}
        >
          {!isBandit ? <GBBandit /> : null}
          Convert to {isBandit ? "Experiment" : "Bandit"}
          {/* </button> */}
        </DropdownMenuItem>
      </ConfirmButton>
    </Tooltip>
  );
}
