import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { FaAngleRight, FaExclamationTriangle } from "react-icons/fa";
import { useRouter } from "next/router";
import { experimentHasLiveLinkedChanges } from "shared/util";
import React, { ReactNode, useEffect, useRef, useState } from "react";
import { date, daysBetween } from "shared/dates";
import { MdRocketLaunch } from "react-icons/md";
import clsx from "clsx";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import Link from "next/link";
import Collapsible from "react-collapsible";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCheck, PiLink } from "react-icons/pi";
import {
  ExperimentSnapshotReportArgs,
  ExperimentSnapshotReportInterface,
  ReportInterface,
} from "back-end/types/report";
import { useAuth } from "@/services/auth";
import WatchButton from "@/components/WatchButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { Tabs, TabsList, TabsTrigger } from "@/components/Radix/Tabs";
import Avatar from "@/components/Radix/Avatar";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import Modal from "@/components/Modal";
import { useScrollPosition } from "@/hooks/useScrollPosition";
import Tooltip from "@/components/Tooltip/Tooltip";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCelebration } from "@/hooks/useCelebration";
import useSDKConnections from "@/hooks/useSDKConnections";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { formatPercent } from "@/services/metrics";
import { AppFeatures } from "@/types/app-features";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { convertExperimentToTemplate } from "@/services/experiments";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/components/Radix/HelperText";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import TemplateForm from "../Templates/TemplateForm";
import ProjectTagBar from "./ProjectTagBar";
import ExperimentActionButtons from "./ExperimentActionButtons";
import ExperimentStatusIndicator from "./ExperimentStatusIndicator";
import { ExperimentTab } from ".";

export interface Props {
  tab: ExperimentTab;
  setTab: (tab: ExperimentTab) => void;
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
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

type ShareLevel = "public" | "organization";
const SAVE_SETTING_TIMEOUT_MS = 3000;

export default function ExperimentHeader({
  tab,
  setTab,
  experiment,
  envs,
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
  const { hasCommercialFeature } = useUser();
  const { snapshot, phase, analysis } = useSnapshot();
  const connections = sdkConnections?.connections || [];

  const [showSdkForm, setShowSdkForm] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLevel, setShareLevel] = useState<ShareLevel>(
    experiment.shareLevel || "organization"
  );
  const [saveShareLevelStatus, setSaveShareLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);
  const saveShareLevelTimeout = useRef<number | undefined>();
  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });
  const HOST = globalThis?.window?.location?.origin;
  const shareableLink = experiment.uid
    ? `${HOST}/public/e/${experiment.uid}`
    : `${HOST}/${
        experiment?.type === "multi-armed-bandit" ? "bandit" : "experiment"
      }/${experiment.id}`;
  const datasourceSettings = experiment.datasource
    ? getDatasourceById(experiment.datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  )?.userIdType;

  const reportArgs: ExperimentSnapshotReportArgs = {
    userIdType: userIdType as "user" | "anonymous" | undefined,
  };

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
  if (envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, envs)) {
      hasRunExperimentsPermission = false;
    }
  }
  const canRunExperiment = canEditExperiment && hasRunExperimentsPermission;
  const canCreateTemplate =
    permissionsUtil.canViewExperimentTemplateModal() &&
    hasCommercialFeature("templates");
  const checklistIncomplete =
    checklistItemsRemaining !== null && checklistItemsRemaining > 0;

  const isUsingHealthUnsupportDatasource =
    !dataSource || datasourcesWithoutHealthData.has(dataSource.type);
  const disableHealthTab = isUsingHealthUnsupportDatasource;

  const isBandit = experiment.type === "multi-armed-bandit";

  const hasResults = !!analysis?.results?.[0];
  const shouldHideTabs =
    experiment.status === "draft" && !hasResults && phases.length === 1;

  useEffect(() => {
    if (shouldHideTabs) {
      setTab("overview");
    }
  }, [shouldHideTabs, setTab]);

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

  useEffect(() => {
    if (experiment.shareLevel !== shareLevel) {
      setSaveShareLevelStatus("loading");
      window.clearTimeout(saveShareLevelTimeout.current);
      apiCall<{
        updatedReport: ExperimentSnapshotReportInterface;
      }>(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({ shareLevel, uid: experiment.uid }),
      })
        .then(() => {
          mutate?.();
          setSaveShareLevelStatus("success");
          saveShareLevelTimeout.current = window.setTimeout(
            () => setSaveShareLevelStatus(null),
            SAVE_SETTING_TIMEOUT_MS
          );
        })
        .catch(() => {
          setSaveShareLevelStatus("fail");
          saveShareLevelTimeout.current = window.setTimeout(
            () => setSaveShareLevelStatus(null),
            SAVE_SETTING_TIMEOUT_MS
          );
        });
      track("Experiment: Set Share Level", {
        source: "private page",
        type: shareLevel,
      });
    }
  }, [
    experiment.id,
    experiment.uid,
    experiment.shareLevel,
    shareLevel,
    mutate,
    setSaveShareLevelStatus,
    apiCall,
  ]);

  const shareLinkButton =
    experiment.shareLevel !== "public" ? null : copySuccess ? (
      <Button style={{ width: 150 }} icon={<PiCheck />}>
        Link copied
      </Button>
    ) : (
      <Button
        icon={<PiLink />}
        onClick={() => {
          if (!copySuccess) performCopy(shareableLink);
          setTimeout(() => setShareModalOpen(false), 810);
          track("Experiment: Click Copy Link", {
            source: "private page",
            type: shareLevel,
          });
        }}
        style={{ width: 150 }}
      >
        Copy Link
      </Button>
    );

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
        {showTemplateForm && (
          <TemplateForm
            onClose={() => setShowTemplateForm(false)}
            initialValue={convertExperimentToTemplate(experiment)}
            isNewTemplate
            source="experiment"
          />
        )}

        {shareModalOpen && (
          <Modal
            open={true}
            trackingEventModalType="share-experiment-settings"
            close={() => setShareModalOpen(false)}
            closeCta="Close"
            header={`Share "${experiment.name}"`}
            useRadixButton={true}
            secondaryCTA={shareLinkButton}
          >
            <div className="mb-3">
              {shareLevel === "organization" ? (
                <Callout status="info" size="sm">
                  This {isBandit ? "Bandit" : "Experiment"} is only viewable
                  within your organization.
                </Callout>
              ) : shareLevel === "public" ? (
                <>
                  <Callout status="warning" size="sm">
                    Anyone with the link can view this{" "}
                    {isBandit ? "Bandit" : "Experiment"}, even those outside
                    your organization.
                  </Callout>
                </>
              ) : null}
            </div>

            <SelectField
              label="View access"
              value={shareLevel}
              onChange={(v: ShareLevel) => setShareLevel(v)}
              containerClassName="mb-2"
              sort={false}
              disabled={!hasUpdatePermissions}
              options={[
                { value: "organization", label: "Only organization members" },
                { value: "public", label: "Anyone with the link" },
              ]}
            />
            <div className="mb-1" style={{ height: 24 }}>
              {saveShareLevelStatus === "loading" ? (
                <div className="position-relative" style={{ top: -6 }}>
                  <LoadingSpinner />
                </div>
              ) : saveShareLevelStatus === "success" ? (
                <HelperText status="success" size="sm">
                  Sharing status has been updated
                </HelperText>
              ) : saveShareLevelStatus === "fail" ? (
                <HelperText status="error" size="sm">
                  Unable to update sharing status
                </HelperText>
              ) : null}
            </div>
          </Modal>
        )}

        <div className="container-fluid pagecontents position-relative">
          <div className="d-flex align-items-center">
            <Flex direction="row" align="center">
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
              <Box ml="2">
                <ExperimentStatusIndicator experimentData={experiment} />
              </Box>
            </Flex>

            <div className="ml-auto flex-1"></div>

            {canRunExperiment ? (
              <div className="ml-2 flex-shrink-0">
                {experiment.status === "running" ? (
                  <ExperimentActionButtons
                    editResult={editResult}
                    editTargeting={editTargeting}
                    isBandit={isBandit}
                  />
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

            <div className="d-flex ml-2 align-items-center">
              {experiment.status === "stopped" && experiment.results ? (
                <>
                  {canEditExperiment ? (
                    <Button
                      ml="2"
                      mr="3"
                      onClick={() => setShareModalOpen(true)}
                    >
                      Share...
                    </Button>
                  ) : shareLevel === "public" ? (
                    <div className="ml-2 mr-3">{shareLinkButton}</div>
                  ) : null}
                </>
              ) : null}
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
                {canCreateTemplate && !isBandit && (
                  <button
                    className="dropdown-item"
                    onClick={() => setShowTemplateForm(true)}
                  >
                    Save as template...
                  </button>
                )}
                <button
                  className="dropdown-item"
                  onClick={() => setAuditModal(true)}
                >
                  Audit log
                </button>
                <hr className="mx-4 my-2" />
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
                {canEditExperiment ||
                duplicate ||
                canRunExperiment ||
                (hasUpdatePermissions &&
                  experiment.archived &&
                  permissionsUtil.canCreateReport(experiment) &&
                  snapshot) ? (
                  <hr className="mx-4 my-2" />
                ) : null}
                {canEditExperiment && (
                  <button
                    className="dropdown-item"
                    onClick={() => setShareModalOpen(true)}
                  >
                    Share {isBandit ? "Bandit" : "Experiment"}
                  </button>
                )}
                {permissionsUtil.canCreateReport(experiment) && snapshot ? (
                  <button
                    className="dropdown-item"
                    onClick={async () => {
                      const res = await apiCall<{ report: ReportInterface }>(
                        `/experiments/report/${snapshot.id}`,
                        {
                          method: "POST",
                          body: reportArgs
                            ? JSON.stringify(reportArgs)
                            : undefined,
                        }
                      );
                      if (!res.report) {
                        throw new Error("Failed to create report");
                      }
                      track("Experiment Report: Create", {
                        source: "experiment more menu",
                      });
                      await router.push(`/report/${res.report.id}`);
                    }}
                  >
                    Create shareable report
                  </button>
                ) : null}
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
