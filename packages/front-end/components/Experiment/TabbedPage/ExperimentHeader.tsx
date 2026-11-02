import { getLatestPhaseVariations } from "shared/experiments";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { FaAngleRight } from "react-icons/fa";
import { useRouter } from "next/router";
import {
  resolveAnalysisIdentifierType,
  getHoldoutStage,
  canMaterializeLinkedChanges,
  getExperimentLinkageBlocker,
  type LinkedChangesResolution,
} from "shared/util";
import {
  CSSProperties,
  Fragment,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import Collapsible from "react-collapsible";
import {
  PiCheck,
  PiClockFill,
  PiEye,
  PiLink,
  PiPencilSimple,
  PiRocketLaunch,
} from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  ExperimentSnapshotReportArgs,
  ExperimentSnapshotReportInterface,
  ReportInterface,
} from "shared/types/report";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { format } from "date-fns-tz";
import Tooltip from "@/ui/Tooltip";
import { Popover } from "@/ui/Popover";
import { useAuth } from "@/services/auth";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Avatar from "@/ui/Avatar";
import Modal from "@/components/Modal";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { formatPercent } from "@/services/metrics";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import { useWatching } from "@/services/WatchProvider";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { convertExperimentToTemplate } from "@/services/experiments";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/ui/HelperText";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import StartHoldoutModal from "@/components/Experiment/TabbedPage/StartHoldoutModal";
import PhaseSelector from "@/components/Experiment/PhaseSelector";
import TemplateForm from "@/components/Experiment/Templates/TemplateForm";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import usePinnedHeader from "@/hooks/usePinnedHeader";
import { useIsOverflowingX } from "@/hooks/useIsOverflowing";
import { DetailsPanelToggle } from "@/components/CollapsiblePanelLayout";
import { hasHealthData } from "@/components/HealthTab/constants";
import ExperimentActionButtons from "./ExperimentActionButtons";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";
import EditExperimentInfoModal from "./EditExperimentInfoModal";
import { useEditsBlockedReason } from "./ExperimentEdits";
import ExperimentStatusIndicator from "./ExperimentStatusIndicator";
import { RUN_PERMISSION_REASON, StartExperiment } from "./useStartExperiment";
import StartExperimentPopover from "./StartExperimentPopover";
import useStartGate from "./useStartGate";
import { StartBlockers } from "./StartSections";
import {
  armedStartDate,
  hasStatusSchedule,
  allDates,
  headerDates,
  headerDetails,
  LabeledDate,
  scheduledTime,
} from "./statusSchedule";
import { getStartTitle } from "./startActions";
import { ExperimentTab } from ".";

export interface Props {
  datasourceMissing?: boolean;
  tab: ExperimentTab;
  setTab: (tab: ExperimentTab, scrollToId?: string) => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  duplicate?: (() => void) | null;
  setStatusModal: (open: boolean) => void;
  setCompareModal: (open: boolean) => void;
  setWatchersModal: (open: boolean) => void;
  editResult?: () => void;
  mutateWatchers: () => void;
  usersWatching: (string | undefined)[];
  start: StartExperiment;
  // The start popover; holdouts start from a modal.
  startOpen: boolean;
  setStartOpen: (open: boolean) => void;
  editTargeting?: (() => void) | null;
  editPhases?: (() => void) | null;
  healthNotificationCount: number;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  holdout?: HoldoutInterfaceStringDates;
  showDashboardView: boolean;
  editSchedule?: (() => void) | null;
}

const HOLDOUT_SCHEDULED_UPDATE_TYPE_MAP = {
  start: "Holdout starts ",
  startAnalysisPeriod: "Analysis starts ",
  stop: "Analysis ends ",
};

// Beside the title, centred on its line.
const titleInline: CSSProperties = {
  verticalAlign: "top",
  height: "var(--heading-line-height-7)",
  lineHeight: 0,
};

const HEALTH_TAB_DISABLED_REASONS = {
  NO_DATASOURCE:
    "Choose a Data Source on the Setup tab to see Experiment Health.",
  UNSUPPORTED_DATASOURCE:
    "Experiment Health isn't available for Mixpanel or legacy Google Analytics Data Sources.",
  RESTRICTED_DATASOURCE:
    "This experiment's Data Source is in a Project you don't have access to.",
  DELETED_DATASOURCE:
    "This experiment's Data Source was deleted. Choose another on the Setup tab.",
};

const DisabledHealthTabTooltip = ({
  reason,
  children,
}: {
  reason: keyof typeof HEALTH_TAB_DISABLED_REASONS;
  children: ReactNode;
}) => {
  return (
    <Tooltip content={HEALTH_TAB_DISABLED_REASONS[reason]}>{children}</Tooltip>
  );
};

// Acts on the stored experiment or leaves the page, so it waits on staged edits.
function StoredActionItem({
  onClick,
  color,
  children,
}: {
  onClick: () => void | Promise<void>;
  color?: "red";
  children: ReactNode;
}) {
  const blockedReason = useEditsBlockedReason();
  return (
    <DropdownMenuItem
      onClick={onClick}
      color={color}
      disabled={!!blockedReason}
    >
      <Tooltip content={blockedReason} side="left" enabled={!!blockedReason}>
        <span>{children}</span>
      </Tooltip>
    </DropdownMenuItem>
  );
}

type ShareLevel = "public" | "organization";
const SAVE_SETTING_TIMEOUT_MS = 3000;

export default function ExperimentHeader({
  datasourceMissing = false,
  tab,
  setTab,
  detailsOpen,
  setDetailsOpen,
  experiment,
  mutate,
  duplicate,
  setCompareModal,
  setStatusModal,
  setWatchersModal,
  usersWatching,
  mutateWatchers,
  editResult,
  editTargeting,
  start,
  startOpen,
  setStartOpen,
  editPhases,
  healthNotificationCount,
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  holdout,
  showDashboardView,
  editSchedule,
}: Props) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { watchedExperiments, refreshWatching } = useWatching();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const dataSource = getDatasourceById(experiment.datasource);
  const { snapshot, phase, analysis } = useSnapshot();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [linkedChanges, setLinkedChanges] = useState<
    LinkedChangesResolution | ""
  >("");
  // Archiving or deleting takes the experiment out of the payload, so anything
  // still serving through it has to be dealt with first.
  const linkageBlocker = getExperimentLinkageBlocker(
    experiment,
    linkedFeatures,
  );
  const canMaterialize = canMaterializeLinkedChanges(
    experiment,
    linkageBlocker,
  );
  const materializing = linkedChanges === "materialize";
  // With nothing to keep, the only answer is "remove", so an acknowledgement
  // stands in for a one-option radio.
  const linkedChangesResolution: LinkedChangesResolution | undefined =
    linkageBlocker === "temporary-rollout" && canMaterialize
      ? linkedChanges || undefined
      : linkageBlocker && deleteAcknowledged
        ? "remove"
        : undefined;
  const linkageResolved =
    !linkageBlocker || linkedChangesResolution !== undefined;
  const resetLinkageChoices = () => {
    setDeleteAcknowledged(false);
    setLinkedChanges("");
  };
  const linkageChoice = canMaterialize ? (
    <RadioGroup
      gap="1"
      value={linkedChanges}
      setValue={(v) => setLinkedChanges(v as LinkedChangesResolution)}
      options={[
        {
          value: "materialize",
          label: "Keep serving the released variation",
          description:
            "Each linked Feature Flag gets a permanent rule with this experiment's targeting.",
        },
        {
          value: "remove",
          label: "Stop serving it",
          description:
            "Users go back to the Feature Flags' other rules and defaults.",
        },
      ]}
    />
  ) : (
    <Checkbox
      label="I understand the temporary rollout ends and users go back to the Feature Flags' other rules and defaults"
      weight="regular"
      value={deleteAcknowledged}
      setValue={(v) => setDeleteAcknowledged(!!v)}
    />
  );
  // Visual changes and redirects also count by the experiment's own markers, as
  // the linkage blocker does, so the acknowledgement shows whenever it's needed.
  const linkedFlagIds = linkedFeatures
    .filter((f) => f.state === "live" || f.state === "draft")
    .map((f) => f.feature.id);
  const visualCount = visualChangesets.length;
  const redirectCount = urlRedirects.length;
  const deleteConsequences = [
    ...linkedFlagIds.map((id) => (
      <li key={id}>
        {materializing
          ? "A permanent rule replaces the experiment rule on Feature Flag "
          : "The experiment rule will be removed from Feature Flag "}
        <strong>{id}</strong>.
      </li>
    )),
    ...(visualCount || experiment.hasVisualChangesets
      ? [
          <li key="visual">
            {visualCount || "Its"} AI Visual Editor change
            {visualCount === 1 ? "" : "s"} will be deleted.
          </li>,
        ]
      : []),
    ...(redirectCount || experiment.hasURLRedirects
      ? [
          <li key="redirects">
            {redirectCount || "Its"} URL Redirect
            {redirectCount === 1 ? "" : "s"} will stop serving.
          </li>,
        ]
      : []),
  ];
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showBanditModal, setShowBanditModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isWatching = watchedExperiments.includes(experiment.id);
  const [showTemplateForm, setShowTemplateForm] = useState(false);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLevel, setShareLevel] = useState<ShareLevel>(
    experiment.shareLevel || "organization",
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
  const exposureQuery = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );
  const userIdType = resolveAnalysisIdentifierType(
    exposureQuery,
    experiment.exposureQueryIdentifierType,
  );

  const reportArgs: ExperimentSnapshotReportArgs = {
    userIdType: userIdType as "user" | "anonymous" | undefined,
  };
  const [tabsPinSentinelRef, headerPinned] =
    usePinnedHeader(!showDashboardView);

  const phases = experiment.phases || [];
  const hasMultiplePhases = phases.length > 1;

  const [showStartExperiment, setShowStartExperiment] = useState(false);

  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits",
  );

  const { hasUpdatePermissions, canRunExperiment } = start;
  const canDeleteExperiment = !holdout
    ? permissionsUtil.canDeleteExperiment(experiment)
    : permissionsUtil.canDeleteHoldout(holdout);
  const canEditExperiment = !experiment.archived && hasUpdatePermissions;
  const [editingName, setEditingName] = useState(false);
  const editsBlocked = useEditsBlockedReason();
  const canCreateTemplate =
    permissionsUtil.canViewExperimentTemplateModal(experiment.project) &&
    hasCommercialFeature("templates");

  const disableHealthTab = !hasHealthData(dataSource);

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const holdoutStage = holdout
    ? getHoldoutStage(holdout, experiment)
    : undefined;

  const hasResults = !!analysis?.results?.[0];

  const { getRunningExperimentResultStatus } = useRunningExperimentStatus();

  const runningExperimentStatus = getRunningExperimentResultStatus(experiment);

  // When the tab strip is hidden, the only reachable view is the overview, so
  // force the active tab there. Once `tab` is already "overview" this is a
  // no-op, so Back exits cleanly.
  useEffect(() => {
    if (showDashboardView && tab !== "overview") {
      setTab("overview");
    }
  }, [showDashboardView, tab, setTab]);

  async function handleWatchUpdates(watch: boolean) {
    await apiCall(
      `/user/${watch ? "watch" : "unwatch"}/experiment/${experiment.id}`,
      {
        method: "POST",
      },
    );
    refreshWatching();
    mutateWatchers();
    setDropdownOpen(false);
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
            SAVE_SETTING_TIMEOUT_MS,
          );
        })
        .catch(() => {
          setSaveShareLevelStatus("fail");
          saveShareLevelTimeout.current = window.setTimeout(
            () => setSaveShareLevelStatus(null),
            SAVE_SETTING_TIMEOUT_MS,
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
    canRunExperiment && experiment.status === "draft" && !isHoldout;

  const showShareableReportButton =
    permissionsUtil.canCreateReport(experiment) && snapshot;

  const showShareButton = canEditExperiment;

  const showSaveAsTemplateButton = canCreateTemplate && !isBandit;

  const showEditStatus =
    canRunExperiment &&
    !isBandit &&
    !isHoldout &&
    (experiment.status !== "draft" || hasResults);
  const showEditPhase = !!editPhases && !isBandit && !isHoldout;
  // Bandits schedule nothing; a holdout's schedule is its own.
  const showScheduleItem =
    canEditExperiment &&
    !!editSchedule &&
    !isBandit &&
    experiment.status !== "stopped" &&
    !experiment.archived;
  const hasEditItems = showEditStatus || showEditPhase || showScheduleItem;
  const showHoldoutOverride =
    !!holdout?.nextScheduledStatusUpdate &&
    ((experiment.status === "running" && !!editResult) ||
      experiment.status === "draft");
  const showForceStatus = experiment.status !== "draft" || hasResults;
  const showHoldoutActions =
    isHoldout && canRunExperiment && (showHoldoutOverride || showForceStatus);
  const hasAnySchedule = isHoldout
    ? !!holdout && hasStatusSchedule(holdout)
    : hasStatusSchedule(experiment);
  const nextScheduledStartDate = armedStartDate(experiment);
  const now = new Date();
  const shownDates = headerDates(experiment, now);
  const everyDate = allDates(experiment, now);
  const details = headerDetails(experiment, now);
  const dateList = (dates: LabeledDate[], lead?: string | null) => (
    <Flex direction="column" gap="1">
      {lead ? <span>{lead}</span> : null}
      {dates.map(({ label, value }) => (
        <span key={label}>
          <Text size="inherit" weight="semibold">
            {label}:
          </Text>{" "}
          {value}
        </span>
      ))}
    </Flex>
  );
  const everyDateList = dateList(everyDate);
  // What the line doesn't already say; nothing, when it says it all.
  const detailsList =
    details.runtime || details.dates.length
      ? dateList(details.dates, details.runtime)
      : null;
  // A phase's tooltip reads as it would were that phase the only one.
  const phaseDetails = (index: number) => {
    const phase = experiment.phases[index];
    if (!phase) return null;
    const { runtime, dates } = headerDetails(
      {
        ...experiment,
        phases: [phase],
        // An earlier phase ended, though the experiment runs on.
        status:
          index < experiment.phases.length - 1 ? "stopped" : experiment.status,
      },
      now,
    );
    return runtime || dates.length ? dateList(dates, runtime) : null;
  };
  const datesBox = useRef<HTMLDivElement>(null);
  // Off with the dashboard, so it measures the box anew once the tabs show it.
  const datesCut = useIsOverflowingX(
    datesBox,
    !hasMultiplePhases && !showDashboardView,
    shownDates.map(({ value }) => value).join(),
  );
  // Breaks only between dates, never inside one, or keeps to one line. Its
  // tooltip adds what the line leaves out, or, cut short, has every date.
  const datesLine = (oneLine: boolean) => {
    const tip = oneLine && datesCut ? everyDateList : detailsList;
    return (
      <Tooltip enabled={!!tip} content={tip}>
        <span
          tabIndex={tip ? 0 : undefined}
          // Inset, so the box clipping it to one line keeps its focus ring.
          style={{ textAlign: "right", outlineOffset: -2 }}
        >
          <Text color="text-mid" whiteSpace={oneLine ? "nowrap" : "normal"}>
            {shownDates.map(({ label, value }, i) => (
              <Fragment key={label}>
                {i > 0 ? " · " : null}
                <Text size="inherit" whiteSpace="nowrap">
                  <Text
                    size="inherit"
                    weight="semibold"
                    color="text-high"
                    whiteSpace="nowrap"
                  >
                    {label}:
                  </Text>{" "}
                  {value}
                </Text>
              </Fragment>
            ))}
          </Text>
        </span>
      </Tooltip>
    );
  };
  const startGate = useStartGate({
    experiment,
    linkedFeatures,
    start,
    bypassed: false,
  });
  // Nothing this viewer can do from the popover would start it, so the button
  // says what's left instead of opening.
  const startBlocked =
    !isHoldout && !startGate.checklistLoading && startGate.actions.hardBlocked;
  // A future start reads as its date, as the popover's button does.
  const futureStart = startGate.schedule === "future";
  // A holdout starts from its modal; anything else, from the start popover.
  const startButton = (
    <Button
      variant={isHoldout || startGate.actions.ready ? "solid" : "soft"}
      onClick={isHoldout ? () => setShowStartExperiment(true) : undefined}
      disabled={!canRunExperiment || !!editsBlocked || startBlocked}
      // Disabled buttons take no hover, so it reaches the summary around it.
      style={
        canRunExperiment && startBlocked ? { pointerEvents: "none" } : undefined
      }
      icon={futureStart ? <PiClockFill /> : <PiRocketLaunch />}
    >
      {futureStart
        ? startGate.actions.label
        : isHoldout
          ? "Start holdout"
          : getStartTitle(experiment, new Date())}
    </Button>
  );

  const startPopover = (
    <StartExperimentPopover
      experiment={experiment}
      linkedFeatures={linkedFeatures}
      start={start}
      editSchedule={editSchedule ?? null}
      open={startOpen}
      setOpen={setStartOpen}
      trigger={startButton}
    />
  );

  return (
    <>
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
              <Callout status="warning">
                <Collapsible
                  trigger={
                    <Flex justify="between" gap="1">
                      Some of your experiment settings may be altered.{" "}
                      <Box>
                        <FaAngleRight className="chevron" />
                      </Box>
                    </Flex>
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
                      {(() => {
                        const variations = getLatestPhaseVariations(experiment);
                        return variations
                          .map((_, i) =>
                            i < 3
                              ? formatPercent(1 / variations.length)
                              : i === 3
                                ? "..."
                                : null,
                          )
                          .filter(Boolean)
                          .join(", ");
                      })()}
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
              </Callout>
            )}
          </div>
        </Modal>
      ) : null}
      {showDeleteModal ? (
        <ModalStandard
          header={`Delete ${isHoldout ? "Holdout" : "Experiment"}`}
          trackingEventModalType="delete-experiment"
          trackingEventModalSource="experiment-more-menu"
          open={true}
          close={() => {
            setShowDeleteModal(false);
            resetLinkageChoices();
          }}
          cta="Delete"
          ctaColor="red"
          ctaEnabled={
            linkageResolved &&
            (!deleteConsequences.length ||
              deleteAcknowledged ||
              linkageBlocker === "temporary-rollout")
          }
          submit={async () => {
            await apiCall<{ status: number; message?: string }>(
              `/${isHoldout ? "holdout" : "experiment"}/${
                isHoldout ? holdout?.id : experiment.id
              }`,
              {
                method: "DELETE",
                body: JSON.stringify({
                  id: isHoldout ? holdout?.id : experiment.id,
                  linkedChanges: linkedChangesResolution,
                }),
              },
            );
            router.push(
              isBandit ? "/bandits" : isHoldout ? "/holdouts" : "/experiments",
            );
          }}
        >
          <Box>
            <Text as="p">
              Are you sure you want to delete this{" "}
              {isHoldout ? "holdout" : "experiment"}?
            </Text>
            {linkageBlocker === "temporary-rollout" && (
              <Callout status="warning" mb="3">
                <Text as="p" mb="2" weight="semibold">
                  Its temporary rollout is still serving the released variation.
                </Text>
                {linkageChoice}
              </Callout>
            )}
            {deleteConsequences.length > 0 && (
              <Callout status={materializing ? "info" : "warning"}>
                <Text as="p" mb="2" weight="semibold">
                  {linkageBlocker === "running"
                    ? `This ${isHoldout ? "holdout" : "experiment"} is running. Deleting it takes effect immediately:`
                    : "Linked implementations:"}
                </Text>
                <ul
                  style={{
                    paddingLeft: "var(--space-4)",
                    marginBottom:
                      linkageBlocker === "temporary-rollout"
                        ? 0
                        : "var(--space-3)",
                  }}
                >
                  {deleteConsequences}
                </ul>
                {linkageBlocker !== "temporary-rollout" && (
                  <Checkbox
                    label="I understand the linked implementations will be changed"
                    weight="regular"
                    value={deleteAcknowledged}
                    setValue={(v) => setDeleteAcknowledged(!!v)}
                  />
                )}
              </Callout>
            )}
          </Box>
        </ModalStandard>
      ) : null}
      {showArchiveModal ? (
        <ModalStandard
          header={`${experiment.archived ? "Unarchive" : "Archive"} ${
            isHoldout ? "Holdout" : "Experiment"
          }`}
          trackingEventModalType="archive-experiment"
          trackingEventModalSource="experiment-more-menu"
          open={true}
          cta={experiment.archived ? "Unarchive" : "Archive"}
          ctaColor={experiment.archived ? "violet" : "red"}
          ctaEnabled={experiment.archived || linkageResolved}
          close={() => {
            setShowArchiveModal(false);
            resetLinkageChoices();
          }}
          submit={async () => {
            await apiCall(
              `/experiment/${experiment.id}/${
                experiment.archived ? "unarchive" : "archive"
              }`,
              {
                method: "POST",
                body: JSON.stringify(
                  experiment.archived
                    ? {}
                    : { linkedChanges: linkedChangesResolution },
                ),
              },
            );
            mutate();
          }}
        >
          <Box>
            <Text as="p">{`Are you sure you want to ${
              experiment.archived ? "unarchive" : "archive"
            } this ${isHoldout ? "holdout" : "experiment"}?`}</Text>
            {!experiment.archived && linkageBlocker === "temporary-rollout" && (
              <Callout status="warning">
                <Text as="p" mb="2" weight="semibold">
                  Its temporary rollout is still serving the released variation.
                  Archived experiments leave the SDK payload.
                </Text>
                {linkageChoice}
              </Callout>
            )}
            {!experiment.archived && linkageBlocker === "running" && (
              <Callout status="warning">
                <Text as="p" mb="2">
                  This {isHoldout ? "holdout" : "experiment"} is running.
                  Archiving takes it out of the SDK payload immediately, so its
                  linked Feature Flags, AI Visual Editor changes and URL
                  Redirects stop serving.
                </Text>
                <Checkbox
                  label="I understand the linked changes stop serving"
                  weight="regular"
                  value={deleteAcknowledged}
                  setValue={(v) => setDeleteAcknowledged(!!v)}
                />
              </Callout>
            )}
          </Box>
        </ModalStandard>
      ) : null}
      {showStartExperiment && isHoldout && experiment.status === "draft" && (
        <StartHoldoutModal
          experiment={experiment}
          close={() => setShowStartExperiment(false)}
          startExperiment={start.startExperiment}
        />
      )}
      {showTemplateForm && (
        <TemplateForm
          onClose={() => setShowTemplateForm(false)}
          initialValue={convertExperimentToTemplate(experiment, exposureQuery)}
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
            size="legacy"
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

      {editingName ? (
        <EditExperimentInfoModal
          experiment={experiment}
          holdout={holdout}
          setShowEditInfoModal={setEditingName}
          mutate={mutate}
          section="name"
        />
      ) : null}

      <div className="container-fluid pagecontents position-relative px-4 pt-3 pb-2">
        <Flex direction="row" align="start" justify="between" gap="5">
          {/* Raised so the name's x-height centres on the buttons' text. */}
          <Box className={revealsQuickEdit} mt="-3px">
            <Heading
              as="h1"
              size="2xl"
              color="text-high"
              overflowWrap="anywhere"
              weight="medium"
            >
              {experiment.name}
              {/* Inline and centred on the name's last line. The word joiner
                  keeps the pencil on that line; the status wraps on its own. */}
              {canEditExperiment && !isHoldout ? (
                <>
                  {"\u2060"}
                  <Flex
                    as="span"
                    display="inline-flex"
                    align="center"
                    style={titleInline}
                  >
                    <QuickEditButton
                      label="Edit name"
                      onClick={() => setEditingName(true)}
                      blockedReason={editsBlocked}
                    />
                  </Flex>
                </>
              ) : null}
              <Flex
                as="span"
                display="inline-flex"
                align="center"
                style={titleInline}
              >
                {/* Lowered so its text shares the buttons' baseline. */}
                <Box
                  as="span"
                  ml="2"
                  position="relative"
                  top="2px"
                  style={{ userSelect: "none" }}
                >
                  <ExperimentStatusIndicator experimentData={experiment} />
                </Box>
              </Flex>
            </Heading>
          </Box>

          {/* Takes what the title leaves; short of room, the dates wrap below
              the buttons, ending where they do. The buttons and the menu share
              one row height, so they stay centred on each other either way. */}
          <Flex align="start" gap="2" flexGrow="1" flexBasis="0">
            <Flex
              direction="row-reverse"
              wrap="wrap"
              align="center"
              gapX="4"
              gapY="2"
              flexGrow="1"
            >
              {/* Unwrapped, so the column never narrows past the buttons. */}
              <Flex
                align="center"
                minHeight="var(--space-6)"
                style={{ whiteSpace: "nowrap" }}
              >
                {isHoldout && holdout?.nextScheduledStatusUpdate ? (
                  <Button
                    variant="ghost"
                    onClick={() => setTab("overview", "holdout-schedule")}
                  >
                    {
                      HOLDOUT_SCHEDULED_UPDATE_TYPE_MAP[
                        holdout.nextScheduledStatusUpdate.type
                      ]
                    }
                    {format(
                      new Date(holdout.nextScheduledStatusUpdate.date),
                      "MMM d, yyyy 'at' h:mm a",
                    )}
                  </Button>
                ) : (
                  <div>
                    {experiment.status === "running" ? (
                      <ExperimentActionButtons
                        editResult={canRunExperiment ? editResult : undefined}
                        editTargeting={
                          canRunExperiment ? editTargeting : undefined
                        }
                        blockedReason={editsBlocked}
                        isBandit={isBandit}
                        runningExperimentStatus={runningExperimentStatus}
                        holdoutStage={holdoutStage}
                      />
                    ) : experiment.status === "draft" &&
                      nextScheduledStartDate ? (
                      <Tooltip
                        content={
                          editsBlocked ??
                          (canRunExperiment
                            ? scheduledTime(nextScheduledStartDate)
                            : `${scheduledTime(nextScheduledStartDate)}. ${RUN_PERMISSION_REASON}`)
                        }
                      >
                        <Button
                          variant="ghost"
                          disabled={!canRunExperiment || !!editsBlocked}
                          onClick={() => editSchedule?.()}
                        >
                          Starts {format(nextScheduledStartDate, "MMM d")}{" "}
                          {editSchedule && <PiPencilSimple className="ml-1" />}
                        </Button>
                      </Tooltip>
                    ) : experiment.status === "draft" &&
                      !experiment.archived &&
                      !canRunExperiment ? (
                      <Tooltip content={RUN_PERMISSION_REASON}>
                        {startButton}
                      </Tooltip>
                    ) : experiment.status === "draft" && canRunExperiment ? (
                      <Tooltip
                        enabled={!!editsBlocked}
                        content={editsBlocked}
                        side="bottom"
                      >
                        <span style={{ display: "inline-flex" }}>
                          {/* One reason at a time: unsaved edits come first,
                            and saving them can change what blocks a start. */}
                          {isHoldout ? (
                            startButton
                          ) : startBlocked && !editsBlocked ? (
                            <Popover
                              openOnHover
                              side="bottom"
                              align="end"
                              contentStyle={{ maxWidth: 360 }}
                              content={
                                <StartBlockers
                                  items={startGate.blockers}
                                  upgrade={startGate.upgrade}
                                />
                              }
                              trigger={
                                // Still opens on request, as the status modal does.
                                <span style={{ display: "inline-flex" }}>
                                  {startPopover}
                                </span>
                              }
                            />
                          ) : (
                            startPopover
                          )}
                        </span>
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
                )}
              </Flex>
              {/* Without the tab row, the dates sit under the actions. */}
              {showDashboardView ? datesLine(false) : null}
            </Flex>
            <Flex align="center" height="var(--space-6)">
              <DropdownMenu
                trigger={
                  <MoreMenuTrigger label="More actions" size="lg" ml="2" />
                }
                open={dropdownOpen}
                onOpenChange={(o) => {
                  setDropdownOpen(!!o);
                }}
                menuPlacement="end"
              >
                {hasEditItems ? (
                  <DropdownMenuGroup>
                    {showEditStatus && (
                      <StoredActionItem
                        onClick={() => {
                          setStatusModal(true);
                          setDropdownOpen(false);
                        }}
                      >
                        Edit status
                      </StoredActionItem>
                    )}
                    {showEditPhase && (
                      <StoredActionItem
                        onClick={() => {
                          editPhases?.();
                          setDropdownOpen(false);
                        }}
                      >
                        Edit phase
                      </StoredActionItem>
                    )}
                    {showScheduleItem && (
                      <StoredActionItem
                        onClick={() => {
                          editSchedule?.();
                          setDropdownOpen(false);
                        }}
                      >
                        {hasAnySchedule ? "Edit schedule" : "Add schedule"}
                      </StoredActionItem>
                    )}
                  </DropdownMenuGroup>
                ) : null}
                {showHoldoutActions ? (
                  <>
                    {hasEditItems ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuGroup>
                      {showHoldoutOverride &&
                        (experiment.status === "running" && editResult ? (
                          <DropdownMenuItem
                            onClick={() => {
                              editResult();
                              setDropdownOpen(false);
                            }}
                            disabled={!!editsBlocked}
                          >
                            <Tooltip
                              content={`Override Holdout schedule and manually ${holdoutStage === "running" ? "start next phase" : "stop Holdout"} now`}
                              side="left"
                            >
                              <span>
                                {holdoutStage === "running"
                                  ? "Start Analysis Phase"
                                  : "Stop Holdout"}
                              </span>
                            </Tooltip>
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => {
                              setShowStartExperiment(true);
                              setDropdownOpen(false);
                            }}
                            disabled={!!editsBlocked}
                          >
                            <Tooltip
                              content="Override Holdout schedule and manually start Holdout now"
                              side="left"
                            >
                              <span>Start holdout</span>
                            </Tooltip>
                          </DropdownMenuItem>
                        ))}
                      {showForceStatus && (
                        <StoredActionItem
                          onClick={() => {
                            setStatusModal(true);
                            setDropdownOpen(false);
                          }}
                        >
                          Force Status Change
                        </StoredActionItem>
                      )}
                    </DropdownMenuGroup>
                  </>
                ) : null}
                {hasEditItems || showHoldoutActions ? (
                  <DropdownMenuSeparator />
                ) : null}
                <DropdownMenuGroup>
                  {!isHoldout ? (
                    <>
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
                          {usersWatching.length > 0
                            ? "View watchers"
                            : "No watchers"}
                        </Flex>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() => {
                      setCompareModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Audit history
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                {/* Only show the separator if one of the following cases is true to avoid double separators */}
                {(showConvertButton ||
                  showShareableReportButton ||
                  showShareButton ||
                  showSaveAsTemplateButton) &&
                !isHoldout ? (
                  <DropdownMenuSeparator />
                ) : null}
                {showSaveAsTemplateButton && !isHoldout && (
                  <StoredActionItem
                    onClick={() => {
                      setShowTemplateForm(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Save as template...
                  </StoredActionItem>
                )}
                {showShareButton && !isHoldout && (
                  <StoredActionItem
                    onClick={() => {
                      setShareModalOpen(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Share {isBandit ? "Bandit" : "Experiment"}
                  </StoredActionItem>
                )}
                {showShareableReportButton && !isHoldout && (
                  <StoredActionItem
                    onClick={async () => {
                      const res = await apiCall<{ report: ReportInterface }>(
                        `/experiments/report/${snapshot.id}`,
                        {
                          method: "POST",
                          body: reportArgs
                            ? JSON.stringify(reportArgs)
                            : undefined,
                        },
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
                  </StoredActionItem>
                )}
                {showConvertButton && !isHoldout && (
                  <>
                    <DropdownMenuGroup>
                      <StoredActionItem
                        onClick={() => {
                          setShowBanditModal(true);
                          setDropdownOpen(false);
                        }}
                      >
                        Convert to {isBandit ? "Experiment" : "Bandit"}
                      </StoredActionItem>
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
                    <StoredActionItem
                      onClick={() => {
                        setDropdownOpen(false);
                        duplicate();
                      }}
                    >
                      Duplicate
                    </StoredActionItem>
                  )}
                  {canRunExperiment && (
                    <StoredActionItem
                      onClick={() => {
                        setShowArchiveModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Archive
                    </StoredActionItem>
                  )}
                  {hasUpdatePermissions && experiment.archived && (
                    <StoredActionItem
                      onClick={() => {
                        setShowArchiveModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Unarchive
                    </StoredActionItem>
                  )}
                  {canDeleteExperiment && (
                    <StoredActionItem
                      color="red"
                      onClick={() => {
                        setShowDeleteModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Delete
                    </StoredActionItem>
                  )}
                </DropdownMenuGroup>
              </DropdownMenu>
            </Flex>
          </Flex>
        </Flex>
      </div>

      {showDashboardView ? null : (
        <>
          <div
            ref={tabsPinSentinelRef}
            aria-hidden
            className="d-print-none"
            style={{
              height: 1,
              width: "100%",
              pointerEvents: "none",
            }}
          />
          <div
            className={clsx("experiment-tabs d-print-none", {
              pinned: headerPinned,
            })}
          >
            <div className="position-relative container-fluid pagecontents px-4">
              <div className="d-flex align-items-center header-tabs">
                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <TabsList size="lg">
                    <Flex align="center" className="flex-1" minWidth="0">
                      <TabsTrigger value="overview">Setup</TabsTrigger>
                      <TabsTrigger value="results">Results</TabsTrigger>
                      {isBandit ? (
                        <TabsTrigger value="explore">Explore</TabsTrigger>
                      ) : null}
                      {!isBandit && !isHoldout && (
                        <TabsTrigger value="dashboards">Dashboard</TabsTrigger>
                      )}
                      {disableHealthTab ? (
                        <DisabledHealthTabTooltip
                          reason={
                            !experiment.datasource
                              ? "NO_DATASOURCE"
                              : dataSource
                                ? "UNSUPPORTED_DATASOURCE"
                                : datasourceMissing
                                  ? "DELETED_DATASOURCE"
                                  : "RESTRICTED_DATASOURCE"
                          }
                        >
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
                      <div className="flex-1" />
                      {/* One date item at a time: the phases, or the dates. */}
                      {hasMultiplePhases ? (
                        <Text size="md">
                          <PhaseSelector
                            phase={phase}
                            phases={experiment.phases}
                            isBandit={experiment.type === "multi-armed-bandit"}
                            isHoldout={experiment.type === "holdout"}
                            holdout={holdout}
                            details={phaseDetails}
                          />
                        </Text>
                      ) : (
                        // Short of room, it ends in an ellipsis; its tooltip
                        // has every date.
                        <Box
                          ref={datesBox}
                          minWidth="0"
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {datesLine(true)}
                        </Box>
                      )}
                    </Flex>
                  </TabsList>
                </Tabs>
                <DetailsPanelToggle
                  open={detailsOpen}
                  setOpen={setDetailsOpen}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
