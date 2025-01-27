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
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiCheck, PiEye, PiLink } from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  ExperimentSnapshotReportArgs,
  ExperimentSnapshotReportInterface,
  ReportInterface,
} from "back-end/types/report";
import { useAuth } from "@/services/auth";
import { Tabs, TabsList, TabsTrigger } from "@/components/Radix/Tabs";
import Avatar from "@/components/Radix/Avatar";
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
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/components/Radix/DropdownMenu";
import { useWatching } from "@/services/WatchProvider";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { convertExperimentToTemplate } from "@/services/experiments";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/components/Radix/HelperText";
import TemplateForm from "../Templates/TemplateForm";
import ProjectTagBar from "./ProjectTagBar";
import EditExperimentInfoModal, {
  FocusSelector,
} from "./EditExperimentInfoModal";
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
  setStatusModal: (open: boolean) => void;
  setAuditModal: (open: boolean) => void;
  setWatchersModal: (open: boolean) => void;
  editResult?: () => void;
  safeToEdit: boolean;
  mutateWatchers: () => void;
  usersWatching: (string | undefined)[];
  checklistItemsRemaining: number | null;
  newPhase?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editPhases?: (() => void) | null;
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
  duplicate,
  setAuditModal,
  setStatusModal,
  setWatchersModal,
  safeToEdit,
  usersWatching,
  mutateWatchers,
  editResult,
  checklistItemsRemaining,
  editTargeting,
  newPhase,
  editPhases,
  editTags,
  healthNotificationCount,
  verifiedConnections,
  linkedFeatures,
}: Props) {
  const growthbook = useGrowthBook<AppFeatures>();

  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { watchedExperiments, refreshWatching } = useWatching();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const dataSource = getDatasourceById(experiment.datasource);
  const startCelebration = useCelebration();
  const { data: sdkConnections } = useSDKConnections();
  const { snapshot, phase, analysis } = useSnapshot();
  const connections = sdkConnections?.connections || [];

  const [showSdkForm, setShowSdkForm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showBanditModal, setShowBanditModal] = useState(false);
  const [showEditInfoModal, setShowEditInfoModal] = useState(false);
  const [
    editInfoFocusSelector,
    setEditInfoFocusSelector,
  ] = useState<FocusSelector>("name");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isWatching = watchedExperiments.includes(experiment.id);
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

  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits"
  );

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

  async function handleWatchUpdates(watch: boolean) {
    await apiCall(
      `/user/${watch ? "watch" : "unwatch"}/experiment/${experiment.id}`,
      {
        method: "POST",
      }
    );
    refreshWatching();
    mutateWatchers();
    setDropdownOpen(false);
  }

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
      <Button style={{ width: 130 }} icon={<PiCheck />}>
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
        style={{ width: 130 }}
      >
        Copy Link
      </Button>
    );

  const showConvertButton =
    canRunExperiment &&
    growthbook.isOn("bandits") &&
    experiment.status === "draft";

  const showShareableReportButton =
    permissionsUtil.canCreateReport(experiment) && snapshot;

  const showShareButton = canEditExperiment;

  const showSaveAsTemplateButton = canCreateTemplate && !isBandit;

  return (
    <>
      {showEditInfoModal ? (
        <EditExperimentInfoModal
          experiment={experiment}
          setShowEditInfoModal={setShowEditInfoModal}
          mutate={mutate}
          focusSelector={editInfoFocusSelector}
        />
      ) : null}
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
      {showBanditModal ? (
        <Modal
          open={true}
          close={() => setShowBanditModal(false)}
          trackingEventModalType=""
          size="lg"
          trackingEventModalSource="experiment-more-menu"
          header={`Convert to ${isBandit ? "Experiment" : "Bandit"}`}
          submit={async () => {
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
        </Modal>
      ) : null}
      {showDeleteModal ? (
        <Modal
          header="Delete Experiment"
          trackingEventModalType="delete-experiment"
          trackingEventModalSource="experiment-more-menu"
          open={true}
          close={() => setShowDeleteModal(false)}
          cta="Delete"
          submit={async () => {
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
          header={`${experiment.archived ? "Unarchive" : "Archive"} Experiment`}
          trackingEventModalType="archive-experiment"
          trackingEventModalSource="experiment-more-menu"
          open={true}
          cta={experiment.archived ? "Unarchive" : "Archive"}
          close={() => setShowArchiveModal(false)}
          submit={async () => {
            try {
              await apiCall(
                `/experiment/${experiment.id}/${
                  experiment.archived ? "unarchive" : "archive"
                }`,
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
          <div>
            <p>{`Are you sure you want to ${
              experiment.archived ? "unarchive" : "archive"
            } this experiment?`}</p>
            {!safeToEdit && !experiment.archived ? (
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
                  {isBandit ? "Bandit" : "Experiment"}, even those outside your
                  organization.
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

      <div className="container-fluid pagecontents position-relative experiment-header px-3 pt-3">
        <div className="d-flex align-items-center">
          <Flex direction="row" align="center">
            <h1 className="mb-0">{experiment.name}</h1>
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
                    !experimentHasLiveLinkedChanges(experiment, linkedFeatures)
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
              {experiment.status === "stopped" && experiment.results ? (
                <>
                  {canEditExperiment ? (
                    <Button onClick={() => setShareModalOpen(true)}>
                      Share...
                    </Button>
                  ) : shareLevel === "public" ? (
                    shareLinkButton
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <div className="ml-2">
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="3"
                  highContrast
                >
                  <BsThreeDotsVertical size={18} />
                </IconButton>
              }
              open={dropdownOpen}
              onOpenChange={(o) => {
                setDropdownOpen(!!o);
              }}
              menuPlacement="end"
            >
              <DropdownMenuGroup>
                {canRunExperiment &&
                  !isBandit &&
                  experiment.status !== "draft" && (
                    <DropdownMenuItem
                      onClick={() => {
                        setStatusModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Edit status
                    </DropdownMenuItem>
                  )}
                {canEditExperiment ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setEditInfoFocusSelector("name");
                      setShowEditInfoModal(true);
                    }}
                  >
                    Edit info
                  </DropdownMenuItem>
                ) : null}
                {editPhases && !isBandit && (
                  <DropdownMenuItem
                    onClick={() => {
                      editPhases();
                      setDropdownOpen(false);
                    }}
                  >
                    Edit phases
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setAuditModal(true);
                    setDropdownOpen(false);
                  }}
                >
                  Audit log
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownSubMenu
                  trigger={
                    <Flex
                      align="center"
                      className={isWatching ? "font-weight-bold" : ""}
                    >
                      <PiEye style={{ marginRight: "5px" }} size={18} />
                      <span className="pr-5">
                        {isWatching ? "Watching" : "Not watching"}
                      </span>
                    </Flex>
                  }
                >
                  <DropdownMenuItem
                    onClick={async () => {
                      await handleWatchUpdates(!isWatching);
                    }}
                  >
                    {isWatching ? "Stop watching" : "Start watching"}
                  </DropdownMenuItem>
                </DropdownSubMenu>
                <DropdownMenuItem
                  onClick={() => {
                    setWatchersModal(true);
                    setDropdownOpen(false);
                  }}
                  disabled={!usersWatching.length}
                >
                  <Flex as="div" align="center">
                    <IconButton
                      style={{
                        marginRight: "5px",
                        backgroundColor:
                          usersWatching.length > 0
                            ? "var(--violet-9)"
                            : "var(--slate-9)",
                      }}
                      radius="full"
                      size="1"
                    >
                      {usersWatching.length || 0}
                    </IconButton>
                    {usersWatching.length > 0 ? "View watchers" : "No watchers"}
                  </Flex>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {/* Only show the separator if one of the following cases is true to avoid double separators */}
              {showConvertButton ||
              showShareableReportButton ||
              showShareButton ||
              showSaveAsTemplateButton ? (
                <DropdownMenuSeparator />
              ) : null}
              {showSaveAsTemplateButton && (
                <DropdownMenuItem
                  onClick={() => {
                    setShowTemplateForm(true);
                    setDropdownOpen(false);
                  }}
                >
                  Save as template...
                </DropdownMenuItem>
              )}
              {showShareButton && (
                <DropdownMenuItem
                  onClick={() => {
                    setShareModalOpen(true);
                    setDropdownOpen(false);
                  }}
                >
                  Share {isBandit ? "Bandit" : "Experiment"}
                </DropdownMenuItem>
              )}
              {showShareableReportButton ? (
                <DropdownMenuItem
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
                </DropdownMenuItem>
              ) : null}
              {showConvertButton && (
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setShowBanditModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Convert to {isBandit ? "Experiment" : "Bandit"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
              {/* Only show the separator if one of the following cases is true to avoid double separators */}
              {duplicate ||
              canRunExperiment ||
              canDeleteExperiment ||
              (hasUpdatePermissions && experiment.archived) ? (
                <DropdownMenuSeparator />
              ) : null}
              <DropdownMenuGroup>
                {duplicate && (
                  <DropdownMenuItem
                    onClick={() => {
                      setDropdownOpen(false);
                      duplicate();
                    }}
                  >
                    Duplicate
                  </DropdownMenuItem>
                )}
                {canRunExperiment && (
                  <DropdownMenuItem
                    onClick={() => {
                      setShowArchiveModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Archive
                  </DropdownMenuItem>
                )}
                {hasUpdatePermissions && experiment.archived && (
                  <DropdownMenuItem
                    onClick={() => {
                      setShowArchiveModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Unarchive
                  </DropdownMenuItem>
                )}
                {canDeleteExperiment && (
                  <DropdownMenuItem
                    color="red"
                    onClick={() => {
                      setShowDeleteModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenu>
          </div>
        </div>
        <ProjectTagBar
          experiment={experiment}
          setShowEditInfoModal={setShowEditInfoModal}
          setEditInfoFocusSelector={setEditInfoFocusSelector}
          editTags={!viewingOldPhase ? editTags : undefined}
        />
      </div>
      {shouldHideTabs ? null : (
        <div
          className={clsx("experiment-tabs d-print-none", {
            pinned: headerPinned,
          })}
        >
          <div className="position-relative container-fluid pagecontents px-3">
            <div className="d-flex header-tabs" ref={tabsRef}>
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

              <div className="col-auto experiment-date-range mr-2">
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
