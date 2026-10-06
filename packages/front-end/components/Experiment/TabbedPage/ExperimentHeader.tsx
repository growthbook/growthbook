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
  experimentHasLiveLinkedChanges,
  getHoldoutStage,
} from "shared/util";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { MdRocketLaunch } from "react-icons/md";
import clsx from "clsx";
import Collapsible from "react-collapsible";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  PiCalendarDotsFill,
  PiClockFill,
  PiCaretDown,
  PiCheck,
  PiEye,
  PiLink,
  PiPencilSimpleFill,
} from "react-icons/pi";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  ExperimentSnapshotReportArgs,
  ExperimentSnapshotReportInterface,
  ReportInterface,
} from "shared/types/report";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { format } from "date-fns-tz";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Avatar from "@/ui/Avatar";
import Modal from "@/components/Modal";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCelebration } from "@/hooks/useCelebration";
import InitialSDKConnectionForm from "@/components/Features/SDKConnections/InitialSDKConnectionForm";
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
} from "@/ui/DropdownMenu";
import { useWatching } from "@/services/WatchProvider";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { convertExperimentToTemplate } from "@/services/experiments";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";
import UiTooltip from "@/ui/Tooltip";
import Callout from "@/ui/Callout";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import HelperText from "@/ui/HelperText";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import RunningExperimentDecisionBanner from "@/components/Experiment/TabbedPage/RunningExperimentDecisionBanner";
import ScheduledEndPassedBanner from "@/components/Experiment/TabbedPage/ScheduledEndPassedBanner";
import StartExperimentModal, {
  PendingDraftFailure,
} from "@/components/Experiment/TabbedPage/StartExperimentModal";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import { useHoldouts } from "@/hooks/useHoldouts";
import PhaseSelector from "@/components/Experiment/PhaseSelector";
import TemplateForm from "@/components/Experiment/Templates/TemplateForm";
import AddToHoldoutModal from "@/components/Experiment/holdout/AddToHoldoutModal";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RemoveFromHoldoutModal from "@/components/Experiment/holdout/RemoveFromHoldoutModal";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import ProjectTagBar from "./ProjectTagBar";
import EditExperimentInfoModal, {
  FocusSelector,
} from "./EditExperimentInfoModal";
import ExperimentActionButtons from "./ExperimentActionButtons";
import EditNameModal from "./SetupPage/EditNameModal";
import { getSetupToDos, ToDoGroup } from "./SetupPage/ToDoPanel";
import {
  useExperimentTypeOptional,
  useManagedValuesConfigOptional,
} from "./ManagedValuesContext";
import ExperimentStatusIndicator from "./ExperimentStatusIndicator";
import EditHoldoutInfoModal from "./EditHoldoutInfoModal";
import headerStyles from "./ExperimentHeader.module.scss";
import setupFunnelStyles from "./SetupPage/SetupFunnel.module.scss";
import { ExperimentTab } from ".";

export interface Props {
  tab: ExperimentTab;
  setTab: (tab: ExperimentTab, scrollToId?: string) => void;
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  mutate: () => void;
  duplicate?: (() => void) | null;
  setStatusModal: (open: boolean) => void;
  setCompareModal: (open: boolean) => void;
  setWatchersModal: (open: boolean) => void;
  editResult?: () => void;
  safeToEdit: boolean;
  mutateWatchers: () => void;
  usersWatching: (string | undefined)[];
  newPhase?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editPhases?: (() => void) | null;
  editTags?: (() => void) | null;
  healthNotificationCount: number;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  holdout?: HoldoutInterfaceStringDates;
  showDashboardView: boolean;
  // The redesigned Setup tab's right rail. The toggle only shows on that
  // tab.
  setupRailCollapsed?: boolean;
  setSetupRailCollapsed?: (collapsed: boolean) => void;
  editSchedule?: (() => void) | null;
}

const datasourcesWithoutHealthData = new Set(["mixpanel", "google_analytics"]);

const HOLDOUT_SCHEDULED_UPDATE_TYPE_MAP = {
  start: "Holdout starts ",
  startAnalysisPeriod: "Analysis starts ",
  stop: "Analysis ends ",
};

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

// The right-rail toggle's icon, from the design: a panel outline with a
// divider near its right edge. While the rail is open, the right-hand section
// is filled (the panel is showing); collapsed, it's just the outline (set in
// review). A local SVG: Phosphor has no right-side panel icon.
function RailToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.6" y="2.4" width="12.8" height="11.2" rx="1.6" />
      <path d="M10.2 2.4v11.2" />
      {collapsed ? null : (
        <path
          d="M10.2 2.4h2.6a1.6 1.6 0 0 1 1.6 1.6v8a1.6 1.6 0 0 1-1.6 1.6h-2.6z"
          fill="currentColor"
          stroke="none"
        />
      )}
    </svg>
  );
}

// NB: Keep in sync with .experiment-tabs top property in global.scss (its
// fallback when --experiment-tabs-top isn't set)
const TABS_HEADER_HEIGHT_PX = 55;

// The redesigned page's title row is sticky (set in review), at one fixed
// height: 24px under the top nav and the 40px row, with no space below it.
// The tab bar tucks 2px up under it, so the tab labels sit about 12px below
// the header's buttons. A compact state was tried in review and dropped:
// nothing in it ended up different. The row sets --experiment-tabs-top (the
// top nav's 56px plus this height, less the tuck), which the tab bar's
// sticky top, the page's scroll-padding-top and the Setup rail read.
const TITLE_HEIGHT_PX = 64;
// Where the title row pins: right under the 56px top nav, which is exactly
// where it sits before any scroll (the page starts 56px down), so sticking
// doesn't move it. (The tab bar elsewhere pins at 55px, 1px under the nav,
// which made the row jump up 1px as scrolling began; fixed in review.)
const TOP_NAV_PX = 56;
// The tab bar tucks this far up under the title row (which is layered above
// it, and covers only the bar's empty top edge).
const TABS_TUCK_PX = 2;

const SETUP_LAYOUT_STYLE = {
  paddingLeft: "var(--space-6)",
  paddingRight: "var(--space-6)",
  maxWidth: "none",
} as const;

type ShareLevel = "public" | "organization";
const SAVE_SETTING_TIMEOUT_MS = 3000;

export default function ExperimentHeader({
  tab,
  setTab,
  experiment,
  envs,
  mutate,
  duplicate,
  setCompareModal,
  setStatusModal,
  setWatchersModal,
  safeToEdit,
  usersWatching,
  mutateWatchers,
  editResult,
  editTargeting,
  newPhase,
  editPhases,
  editTags,
  healthNotificationCount,
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  holdout,
  showDashboardView,
  setupRailCollapsed = false,
  setSetupRailCollapsed,
  editSchedule,
}: Props) {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { watchedExperiments, refreshWatching } = useWatching();
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const dataSource = getDatasourceById(experiment.datasource);
  const startCelebration = useCelebration();
  const { snapshot, phase, analysis } = useSnapshot();
  const {
    checklistItemsRemaining,
    checklistHardBlockerCount,
    incompleteChecklistItems,
  } = usePreLaunchChecklist();

  const [showSdkForm, setShowSdkForm] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showBanditModal, setShowBanditModal] = useState(false);
  const [showEditInfoModal, setShowEditInfoModal] = useState(false);
  const [editInfoFocusSelector, setEditInfoFocusSelector] =
    useState<FocusSelector>("name");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAddToHoldoutModal, setShowAddToHoldoutModal] = useState(false);
  const [showRemoveFromHoldoutModal, setShowRemoveFromHoldoutModal] =
    useState(false);

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
  const tabsPinSentinelRef = useRef<HTMLDivElement>(null);
  const [headerPinned, setHeaderPinned] = useState(false);

  const phases = experiment.phases || [];
  const hasMultiplePhases = phases.length > 1;

  const [showStartExperiment, setShowStartExperiment] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  // Structured per-feature failures from the last failed start attempt
  // (pending_draft_publish_failed) — lets the start modal link each blocked
  // feature draft instead of only showing the error string.
  const [pendingDraftFailures, setPendingDraftFailures] = useState<
    PendingDraftFailure[]
  >([]);

  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits",
  );
  const holdoutsEnabled = hasCommercialFeature("holdouts");
  const { holdouts } = useHoldouts(experiment.project);

  const hasUpdatePermissions = !holdout
    ? permissionsUtil.canUpdateExperiment(experiment, {})
    : permissionsUtil.canUpdateHoldout(holdout, { projects: holdout.projects });
  const canDeleteExperiment = !holdout
    ? permissionsUtil.canDeleteExperiment(experiment)
    : permissionsUtil.canDeleteHoldout(holdout);
  const canEditExperiment = !experiment.archived && hasUpdatePermissions;

  let hasRunExperimentsPermission = true;
  if (envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, envs)) {
      hasRunExperimentsPermission = false;
    }
  }
  const canRunExperiment = canEditExperiment && hasRunExperimentsPermission;
  const canCreateTemplate =
    permissionsUtil.canViewExperimentTemplateModal(experiment.project) &&
    hasCommercialFeature("templates");

  const isUsingHealthUnsupportedDatasource =
    !dataSource || datasourcesWithoutHealthData.has(dataSource.type);
  const disableHealthTab = isUsingHealthUnsupportedDatasource;

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const holdoutStage = holdout
    ? getHoldoutStage(holdout, experiment)
    : undefined;
  // The redesigned page's layout: 32px sides and no max width, so the header
  // lines up with the page content below it, plus the sticky title row and
  // the restyled tabs. On EVERY tab of a redesigned experiment, not just
  // Setup, so the page doesn't change around you as you switch tabs (set in
  // review). See the matching container style in index.tsx. Only the parts
  // about the Setup tab's right rail check onSetupTab.
  const setupLayout = !isBandit && !isHoldout && !showDashboardView;
  const onSetupTab = setupLayout && tab === "overview";

  // --- Sticky title row (redesigned page) ---------------------------------
  //
  // Where the tab bar pins: under the top nav, plus the sticky title row
  // when there is one.
  const tabsTop = setupLayout
    ? TOP_NAV_PX + TITLE_HEIGHT_PX - TABS_TUCK_PX
    : TABS_HEADER_HEIGHT_PX;
  useEffect(() => {
    const root = document.documentElement;
    if (!setupLayout) return;
    root.style.setProperty("--experiment-tabs-top", `${tabsTop}px`);
    // Scrolling to something (a To Do jump, a hash) stops below the title
    // row and the 40px tab bar rather than under them.
    root.style.scrollPaddingTop = "calc(var(--experiment-tabs-top) + 40px)";
    return () => {
      root.style.removeProperty("--experiment-tabs-top");
      root.style.scrollPaddingTop = "";
    };
  }, [setupLayout, tabsTop]);

  // --- Start gate for the redesigned page (prototype) ----------------------
  //
  // For standard experiments, the ONLY thing that blocks Start is having no
  // saved delivery for the experiment's type: no saved variation values for
  // Values, or no linked changes of the current type for the other three.
  // The pre-launch checklist still sets the button's styling (soft until
  // complete) but doesn't disable it (set in review).
  //
  // Optional hooks: this header also renders on bandit and holdout pages,
  // which mount no delivery-type provider.
  const deliveryType = useExperimentTypeOptional();
  const managedValues = useManagedValuesConfigOptional();
  const useDeliveryStartGate =
    !isBandit && !isHoldout && deliveryType !== undefined;
  // The rail's To Do list, built by the same function the rail uses so the
  // two can't disagree. Its open count sets the Start button's styling on
  // the redesigned page.
  const setupToDos =
    useDeliveryStartGate && deliveryType !== undefined
      ? getSetupToDos({
          experiment,
          deliveryType,
          hasSavedValues: Object.values(
            managedValues?.valuesByVariationId ?? {},
          ).some((v) => v !== ""),
          linkedFeatures,
          visualChangesetCount: visualChangesets.length,
          urlRedirectCount: urlRedirects.length,
          hasDataSource: !!dataSource?.settings?.queries?.exposure?.some(
            (e) => e.id === experiment.exposureQueryId,
          ),
        })
      : null;
  const setupToDosDone = !!setupToDos && setupToDos.openCount === 0;

  // What's missing, in the design's popover shape: a title for the item and
  // where on the page it's fixed.
  const hasSavedValues = Object.values(
    managedValues?.valuesByVariationId ?? {},
  ).some((v) => v !== "");
  const linkedCountForType =
    deliveryType === "feature-flag"
      ? linkedFeatures.length
      : deliveryType === "visual-editor"
        ? visualChangesets.length
        : urlRedirects.length;
  const deliveryStartBlocker: { title: string; location: string } | null =
    !useDeliveryStartGate
      ? null
      : deliveryType === "values"
        ? hasSavedValues
          ? null
          : {
              title: "Set Variation Values",
              location: "Implementation · Values",
            }
        : linkedCountForType > 0
          ? null
          : deliveryType === "feature-flag"
            ? {
                title: "Link a Feature Flag",
                location: "Implementation · Feature Flags",
              }
            : deliveryType === "visual-editor"
              ? {
                  title: "Add Visual Editor Changes",
                  location: "Implementation · Visual Editor Changes",
                }
              : {
                  title: "Add a URL Redirect",
                  location: "Implementation · URL Redirects",
                };
  // Unselected tabs at regular weight (400) on the Setup tab, set in review.
  // The app's override makes every tab medium; the selected tab's label sets
  // its own medium weight, so only unselected ones change.
  const tabWeight = (value: ExperimentTab): CSSProperties | undefined =>
    setupLayout && tab !== value
      ? // "normal" is 400, the same as --font-weight-regular; React's style
        // type doesn't accept a var() for fontWeight.
        { fontWeight: "normal" }
      : undefined;

  const hasResults = !!analysis?.results?.[0];

  const { getDecisionCriteria, getRunningExperimentResultStatus } =
    useRunningExperimentStatus();

  const decisionCriteria = getDecisionCriteria(
    experiment.decisionFrameworkSettings?.decisionCriteriaId,
  );

  const runningExperimentStatus = getRunningExperimentResultStatus(experiment);
  // An unstarted draft has nothing to show outside Setup.
  const lockedToSetup =
    experiment.status === "draft" && !hasResults && phases.length === 1;
  // The redesigned page keeps the tab row for such a draft, with every tab
  // but Setup disabled, so the page's structure is visible before launch.
  // Bandits and holdouts keep the previous behaviour of hiding the row.
  const disableNonSetupTabs = lockedToSetup && !isBandit && !isHoldout;
  const shouldHideTabs =
    (lockedToSetup && !disableNonSetupTabs) || showDashboardView;

  useEffect(() => {
    if (shouldHideTabs) return;
    const el = tabsPinSentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setHeaderPinned(!entry.isIntersecting);
      },
      {
        root: null,
        rootMargin: `-${tabsTop}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldHideTabs, tabsTop]);

  // When the tab strip is hidden (e.g. an unstarted draft), the only
  // reachable view is the overview, so force the active tab there. Once `tab`
  // is already "overview" this is a no-op, so Back exits cleanly.
  useEffect(() => {
    if ((shouldHideTabs || disableNonSetupTabs) && tab !== "overview") {
      setTab("overview");
    }
  }, [shouldHideTabs, disableNonSetupTabs, tab, setTab]);

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

  async function startExperiment() {
    if (!experiment.phases?.length) {
      if (newPhase) {
        newPhase();
        return;
      } else {
        throw new Error("You do not have permission to start this experiment");
      }
    }

    setPendingDraftFailures([]);
    if (isHoldout) {
      await apiCall(`/holdout/${holdout?.id}/edit-status`, {
        method: "POST",
        body: JSON.stringify({
          status: "running",
          holdoutRunningStatus: "running",
        }),
      });
    } else {
      await apiCall(
        `/experiment/${experiment.id}/status`,
        {
          method: "POST",
          body: JSON.stringify({
            status: "running",
          }),
        },
        (responseData) => {
          if (
            responseData?.code === "pending_draft_publish_failed" &&
            Array.isArray(responseData?.details?.failedFeatureDrafts)
          ) {
            setPendingDraftFailures(responseData.details.failedFeatureDrafts);
          }
        },
      );
    }
    await mutate();
    startCelebration();

    track("Start experiment", {
      source: "experiment-start-banner",
      action: "main CTA",
      hasDatasource: !!dataSource,
      hasExperimentAssignmentQuery: !!experiment.exposureQueryId,
    });
    // No jump to Results after starting (set in review): the page stays on
    // the tab it's on and re-renders into its running state. The status
    // based default (Results once running) only applies on a fresh load.
  }

  async function approveScheduledExperimentStart() {
    await apiCall(`/experiment/${experiment.id}/approve-scheduled-start`, {
      method: "POST",
    });
    await mutate();

    track("Approve Scheduled Experiment Start", {
      source: "experiment-start-banner",
      action: "main CTA",
    });
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

  const showEditHoldoutScheduleButton =
    isHoldout &&
    canEditExperiment &&
    editSchedule &&
    experiment.status !== "stopped" &&
    !experiment.archived;

  const holdoutHasSchedule =
    isHoldout &&
    Object.values(holdout?.statusUpdateSchedule ?? {}).some(
      (value) => value !== null,
    );
  const hasExperimentSchedule = !!experiment.statusUpdateSchedule?.startAt;
  const nextScheduledStartDate =
    experiment.nextScheduledStatusUpdate?.type === "start" &&
    experiment.nextScheduledStatusUpdate?.date
      ? new Date(experiment.nextScheduledStatusUpdate.date)
      : null;
  const checklistReady = checklistItemsRemaining === 0;

  const scheduledEndPassedBanner =
    experiment.status === "running" && !isHoldout && !isBandit ? (
      <ScheduledEndPassedBanner
        experiment={experiment}
        runningExperimentStatus={runningExperimentStatus}
        editSchedule={
          canEditExperiment && editSchedule ? () => editSchedule() : undefined
        }
      />
    ) : null;

  const runningExperimentDecisionBanner =
    experiment.status === "running" && !isHoldout && runningExperimentStatus ? (
      <RunningExperimentDecisionBanner
        experiment={experiment}
        runningExperimentStatus={runningExperimentStatus}
        decisionCriteria={decisionCriteria}
      />
    ) : null;

  const startExperimentButton = (
    <Button
      // Soft until everything's done, then primary. On the redesigned page
      // "done" is the rail's To Do list (setupToDosDone); elsewhere it's the
      // pre-launch checklist. Styling only: on the redesigned page only
      // deliveryStartBlocker disables the button.
      variant={
        (useDeliveryStartGate ? setupToDosDone : checklistReady)
          ? "solid"
          : "soft"
      }
      onClick={() => {
        setShowStartExperiment(true);
      }}
      disabled={
        !canRunExperiment ||
        !!deliveryStartBlocker ||
        (isBandit &&
          !experimentHasLiveLinkedChanges(experiment, linkedFeatures))
      }
      // On the redesigned page, a scheduled start reads "Schedule Start"
      // with a filled clock on the left (being tried in review), as the page's Start and Actions
      // buttons carry an icon (both set in review). Elsewhere unchanged.
      icon={
        hasExperimentSchedule ? (
          setupLayout ? (
            <PiClockFill />
          ) : undefined
        ) : (
          <MdRocketLaunch />
        )
      }
    >
      {hasExperimentSchedule
        ? setupLayout
          ? "Schedule Start"
          : "Approve for Scheduled Start"
        : `Start ${isHoldout ? "Holdout" : "Experiment"}`}
    </Button>
  );

  return (
    <>
      {/* The redesigned page edits just the name here (set in review); the
        rest of Edit Info lives in the Setup page's rail. Bandits keep the
        full Edit Info modal. */}
      {showEditInfoModal &&
      !isHoldout &&
      !isBandit &&
      editInfoFocusSelector === "name" ? (
        <EditNameModal
          experiment={experiment}
          close={() => setShowEditInfoModal(false)}
          mutate={mutate}
        />
      ) : null}
      {/* Bandits, and the other tabs' metadata row "+Add" links (project,
        tags), still get the full Edit Info modal. */}
      {showEditInfoModal &&
      !isHoldout &&
      (isBandit || editInfoFocusSelector !== "name") ? (
        <EditExperimentInfoModal
          experiment={experiment}
          setShowEditInfoModal={setShowEditInfoModal}
          mutate={mutate}
          focusSelector={editInfoFocusSelector}
        />
      ) : null}
      {showEditInfoModal && isHoldout && holdout ? (
        <EditHoldoutInfoModal
          experiment={experiment}
          holdout={holdout}
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
                              ? formatPercent(1 / (variations.length ?? 2))
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
          close={() => setShowDeleteModal(false)}
          cta="Delete"
          ctaColor="red"
          submit={async () => {
            try {
              await apiCall<{ status: number; message?: string }>(
                `/${isHoldout ? "holdout" : "experiment"}/${
                  isHoldout ? holdout?.id : experiment.id
                }`,
                {
                  method: "DELETE",
                  body: JSON.stringify({
                    id: isHoldout ? holdout?.id : experiment.id,
                  }),
                },
              );
              router.push(
                isBandit
                  ? "/bandits"
                  : isHoldout
                    ? "/holdouts"
                    : "/experiments",
              );
            } catch (e) {
              console.error(e);
            }
          }}
        >
          <Box>
            <Text as="p">
              Are you sure you want to delete this{" "}
              {isHoldout ? "holdout" : "experiment"}?
            </Text>
            {!safeToEdit ? (
              <Callout status="warning">
                This will immediately stop all linked Feature Flags, Visual
                Editor Changes, and URL Redirects from running
              </Callout>
            ) : null}
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
          close={() => setShowArchiveModal(false)}
          submit={async () => {
            try {
              await apiCall(
                `/experiment/${experiment.id}/${
                  experiment.archived ? "unarchive" : "archive"
                }`,
                {
                  method: "POST",
                },
              );
              mutate();
            } catch (e) {
              console.error(e);
            }
          }}
        >
          <Box>
            <Text as="p">{`Are you sure you want to ${
              experiment.archived ? "unarchive" : "archive"
            } this ${isHoldout ? "holdout" : "experiment"}?`}</Text>
            {!safeToEdit && !experiment.archived ? (
              <Callout status="warning">
                This will immediately stop all linked Feature Flags, Visual
                Editor Changes, and URL Redirects from running
              </Callout>
            ) : null}
          </Box>
        </ModalStandard>
      ) : null}
      {showStartExperiment && experiment.status === "draft" && (
        <StartExperimentModal
          experiment={experiment}
          close={() => {
            setShowStartExperiment(false);
            setPendingDraftFailures([]);
          }}
          startExperiment={startExperiment}
          pendingDraftFailures={pendingDraftFailures}
          scheduleExperiment={approveScheduledExperimentStart}
          checklistItemsRemaining={checklistItemsRemaining || 0}
          checklistHardBlockerCount={checklistHardBlockerCount}
          incompleteChecklistItems={incompleteChecklistItems}
          isHoldout={isHoldout}
          linkedFeatures={linkedFeatures}
          visualChangesets={visualChangesets}
          urlRedirects={urlRedirects}
        />
      )}
      {showScheduleModal && !isHoldout ? (
        <EditScheduleModal
          experiment={experiment}
          close={() => setShowScheduleModal(false)}
          mutate={mutate}
          envs={envs}
          // On the redesigned page: say when it's scheduled, and keep an
          // approved schedule approved after a time change (set in review).
          redesigned={setupLayout}
        />
      ) : null}
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
      {showAddToHoldoutModal ? (
        <AddToHoldoutModal
          experiment={experiment}
          close={() => setShowAddToHoldoutModal(false)}
          mutate={mutate}
        />
      ) : null}
      {showRemoveFromHoldoutModal ? (
        <RemoveFromHoldoutModal
          experiment={experiment}
          close={() => setShowRemoveFromHoldoutModal(false)}
          mutate={mutate}
        />
      ) : null}

      <div
        className={clsx(
          "container-fluid pagecontents",
          // Not on the redesigned page: Bootstrap's position-relative is
          // !important, and would override the row's position: sticky.
          !setupLayout && "position-relative px-3 pt-3 pb-0",
        )}
        // Sticky on the redesigned page, at a fixed height (see
        // TITLE_HEIGHT_PX).
        style={
          setupLayout
            ? {
                ...SETUP_LAYOUT_STYLE,
                position: "sticky",
                top: TOP_NAV_PX,
                // Above the pinned tab bar (930) and the rail (931).
                zIndex: 933,
                backgroundColor: "var(--color-background)",
                boxSizing: "border-box",
                height: TITLE_HEIGHT_PX,
                overflow: "hidden",
                // 24px above the title, instead of pt-3 (14px).
                paddingTop: "var(--space-5)",
                // None below the row: it sits on the tab bar (set in review).
                paddingBottom: 0,
              }
            : undefined
        }
      >
        <Flex direction="row" align="start" justify="between" gap="5">
          <Flex
            align="center"
            gap="2"
            minWidth="0"
            // One line on the redesigned page, so the sticky row's fixed
            // height holds; a long name ends in "…" (see .titleLine).
            className={setupLayout ? headerStyles.titleLine : undefined}
          >
            {/* One step smaller on the Setup tab, set in review; the same in
              the compact sticky row. */}
            <Heading
              as="h1"
              size={setupLayout ? "xl" : "2xl"}
              // On the Setup tab, no colour: it inherits the page's
              // --gray-12, the same as the section headings and the
              // Implementation cards' titles (set in review).
              color={setupLayout ? undefined : "text-high"}
              overflowWrap="anywhere"
              weight="medium"
              title={setupLayout ? experiment.name : undefined}
            >
              {experiment.name}
            </Heading>
            <Box style={{ userSelect: "none" }}>
              {/* Neutral grey Draft badge for the redesigned page, set in
                review. Bandits and holdouts keep their status colour. */}
              <ExperimentStatusIndicator
                experimentData={experiment}
                neutralDraft={!isBandit && !isHoldout}
              />
            </Box>
          </Flex>

          <Flex direction="row" align="center" gap="2" flexShrink="0">
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
                    editTargeting={canRunExperiment ? editTargeting : undefined}
                    isBandit={isBandit}
                    runningExperimentStatus={runningExperimentStatus}
                    holdoutStage={holdoutStage}
                    // One "Actions" menu on the redesigned page (set in
                    // review).
                    asMenu={setupLayout}
                    newPhase={canRunExperiment ? newPhase : undefined}
                  />
                ) : experiment.status === "draft" &&
                  nextScheduledStartDate &&
                  setupLayout ? (
                  // An approved scheduled start, on the redesigned page: a
                  // primary dropdown button with the time, and a filled
                  // calendar-dots icon (being tried in review).
                  // @/ui/Button + @/ui/DropdownMenu, the caret as the menu's
                  // own text trigger draws it (as Actions). Edit Schedule
                  // opens the schedule modal; Cancel Scheduled Start confirms
                  // first, with the menu item's built-in dialog. No "Start
                  // now" (removed in review).
                  <DropdownMenu
                    menuPlacement="end"
                    // As wide as the button, with the Values Type menu's soft
                    // shadow (both set in review).
                    menuWidth="full"
                    // Soft, as the Values Type menu: the hovered option takes
                    // the pale --accent-a4 fill and keeps its text colour
                    // (set in review).
                    variant="soft"
                    contentClassName={setupFunnelStyles.softMenuShadow}
                    trigger={
                      <Button
                        icon={<PiCalendarDotsFill />}
                        disabled={!canRunExperiment}
                      >
                        <Flex as="span" align="center" gap="2">
                          Scheduled{" "}
                          {format(nextScheduledStartDate, "MMM d, h:mm a")}
                          <PiCaretDown />
                        </Flex>
                      </Button>
                    }
                  >
                    {/* Change the time, in the schedule modal; it saves on
                      its own (set in review). */}
                    {editSchedule ? (
                      <DropdownMenuItem
                        onClick={() => setShowScheduleModal(true)}
                      >
                        Edit Schedule
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      confirmation={{
                        confirmationTitle: "Cancel scheduled start?",
                        getConfirmationContent: async () =>
                          "The experiment won't start at its scheduled time. It stays a draft, and you can schedule or start it again.",
                        cta: "Cancel Scheduled Start",
                        ctaColor: "red",
                        // The schedule modal's own Unschedule Experiment.
                        submit: async () => {
                          await apiCall(
                            `/experiment/${experiment.id}/unschedule-start`,
                            { method: "POST" },
                          );
                          await mutate();
                        },
                      }}
                    >
                      Cancel Scheduled Start
                    </DropdownMenuItem>
                  </DropdownMenu>
                ) : experiment.status === "draft" && nextScheduledStartDate ? (
                  <Button
                    variant="ghost"
                    disabled={!canRunExperiment}
                    onClick={() => {
                      if (editSchedule) setShowScheduleModal(true);
                    }}
                  >
                    Starts{" "}
                    {format(
                      nextScheduledStartDate,
                      "MMM d, yyyy 'at' h:mm a (z)",
                    )}{" "}
                    {editSchedule && <PiPencilSimpleFill className="ml-1" />}
                  </Button>
                ) : experiment.status === "draft" ? (
                  // 12px between Test and Start, set in review.
                  <Flex align="center" gap="3">
                    {/* Test, left of the primary action, per the design's
                      header cluster (draft states). A dropdown: the design
                      doesn't specify its contents yet, so it holds a
                      disabled placeholder. Standard experiments only. */}
                    {!isBandit && !isHoldout ? (
                      <DropdownMenu
                        trigger={
                          // No leading icon, --slate-12 text, and the same
                          // --slate-6 inset outline as the kebab (set in
                          // review).
                          <Button
                            variant="outline"
                            color="gray"
                            // The caret as DropdownMenu's built-in text
                            // trigger adds it (a right-hand PiCaretDown), on
                            // a custom button so the styling below applies.
                            icon={<PiCaretDown />}
                            iconPosition="right"
                            // The --slate-6 outline, darkening on hover (see
                            // .outlineButton).
                            className={headerStyles.outlineButton}
                            style={{ color: "var(--slate-12)" }}
                          >
                            Test
                          </Button>
                        }
                        menuPlacement="end"
                      >
                        <DropdownMenuItem disabled>
                          Testing options coming soon
                        </DropdownMenuItem>
                      </DropdownMenu>
                    ) : null}
                    {deliveryStartBlocker ? (
                      // The design's disabled-start popover: what to finish
                      // first, on hover. A span wraps the disabled button,
                      // which fires no pointer events of its own; it's
                      // focusable so keyboard users can reach the explanation.
                      <Popover
                        openOnHover
                        side="bottom"
                        // Centred on the button, so the arrow sits in the
                        // middle of both (set in review). Near the page edge,
                        // Radix shifts the panel inward but keeps the arrow on
                        // the button's centre.
                        align="center"
                        contentStyle={{
                          padding: "var(--space-3) var(--space-4)",
                          maxWidth: 340,
                        }}
                        trigger={
                          <span
                            tabIndex={0}
                            aria-label={`Start Experiment unavailable. Finish this first: ${deliveryStartBlocker.title}`}
                            style={{ display: "inline-flex" }}
                          >
                            {startExperimentButton}
                          </span>
                        }
                        content={
                          // The To Do tab's own rows (ring, title, location),
                          // for the open "Required to Start" items, set in
                          // review. Clicking one jumps to it, as in the tab.
                          <ToDoGroup
                            title="Finish this first:"
                            items={(setupToDos?.start ?? []).filter(
                              (item) => !item.done,
                            )}
                          />
                        }
                      />
                    ) : (
                      <Tooltip
                        shouldDisplay={
                          isBandit &&
                          !experimentHasLiveLinkedChanges(
                            experiment,
                            linkedFeatures,
                          )
                        }
                        body="Add at least one live Linked Feature, AI Visual Editor change, or URL Redirect before starting."
                      >
                        {startExperimentButton}
                      </Tooltip>
                    )}
                  </Flex>
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
            {/* Divider between the primary action and the kebab, per the
              design: 1px x 20px. 12px either side (set in review): the row's
              gap="2" (8px) plus mx="1" (4px). */}
            {!isBandit && !isHoldout ? (
              <Box
                aria-hidden
                mx="1"
                style={{
                  width: 1,
                  height: 20,
                  flexShrink: 0,
                  backgroundColor: "var(--gray-a5)",
                }}
              />
            ) : null}
            <DropdownMenu
              trigger={
                // Outline, like the header's other buttons, on the redesigned
                // page (set in review): violet outline with 4px corners.
                // Bandits and holdouts keep the round ghost button.
                <IconButton
                  variant={isBandit || isHoldout ? "ghost" : "outline"}
                  // Violet like @/ui/Button's outline default, so it matches
                  // the page's other outline buttons (set in review).
                  color={isBandit || isHoldout ? "gray" : "violet"}
                  radius={isBandit || isHoldout ? "full" : undefined}
                  // The same size in both sticky states (set in review).
                  size="3"
                  highContrast={isBandit || isHoldout}
                  // 4px corners and a --slate-6 outline on the outline
                  // version, set in review. The outline is Radix's own inset
                  // box-shadow, redrawn here with the new colour.
                  // The outline itself, darkening on hover, is .outlineButton.
                  className={
                    isBandit || isHoldout
                      ? undefined
                      : headerStyles.outlineButton
                  }
                  style={
                    isBandit || isHoldout
                      ? undefined
                      : {
                          borderRadius: "var(--radius-2)",
                          // The dots in --slate-12, like the Test button's
                          // text (set in review), rather than the violet
                          // outline variant's --violet-a11.
                          color: "var(--slate-12)",
                        }
                  }
                  // The divider's gap spaces it on the redesigned page.
                  ml={isBandit || isHoldout ? "2" : "0"}
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
              {/* Title Case on these menu items (Edit Name, Edit Phase, Remove
                from Holdout, View Watchers, Audit History, Save as Template)
                was set in review. It departs from the repo's copy guide
                (.agents/guides/ui-copy-style.md), which puts menu items in
                sentence case, so reconcile before this ships. The other items
                are unchanged. */}
              <DropdownMenuGroup>
                {canEditExperiment ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setEditInfoFocusSelector("name");
                      setShowEditInfoModal(true);
                    }}
                  >
                    {isBandit || isHoldout ? "Edit info" : "Edit Name"}
                  </DropdownMenuItem>
                ) : null}
                {canRunExperiment &&
                  !isBandit &&
                  !isHoldout &&
                  (experiment.status !== "draft" || hasResults) && (
                    <DropdownMenuItem
                      onClick={() => {
                        setStatusModal(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Edit status
                    </DropdownMenuItem>
                  )}
                {editPhases && !isBandit && !isHoldout && (
                  <DropdownMenuItem
                    onClick={() => {
                      editPhases();
                      setDropdownOpen(false);
                    }}
                  >
                    Edit Phase
                  </DropdownMenuItem>
                )}
                {showEditHoldoutScheduleButton && (
                  <DropdownMenuItem
                    onClick={() => {
                      editSchedule();
                      setDropdownOpen(false);
                    }}
                  >
                    {holdoutHasSchedule ? "Edit " : "Add "} Schedule
                  </DropdownMenuItem>
                )}
                {canEditExperiment &&
                  !isHoldout &&
                  holdoutsEnabled &&
                  holdouts.length > 0 &&
                  !experiment.holdoutId &&
                  experiment.status === "draft" && (
                    <DropdownMenuItem
                      onClick={() => {
                        setShowAddToHoldoutModal(true);
                      }}
                    >
                      Add to holdout
                    </DropdownMenuItem>
                  )}
                {canEditExperiment && !isHoldout && experiment.holdoutId && (
                  <DropdownMenuItem
                    onClick={() => {
                      setShowRemoveFromHoldoutModal(true);
                      setDropdownOpen(false);
                    }}
                  >
                    Remove from Holdout
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {isHoldout && canRunExperiment && (
                <>
                  {(holdout?.nextScheduledStatusUpdate ||
                    experiment.status !== "draft" ||
                    hasResults) && <DropdownMenuSeparator />}
                  <DropdownMenuGroup>
                    {holdout?.nextScheduledStatusUpdate &&
                      (experiment.status === "running" && editResult ? (
                        <DropdownMenuItem
                          onClick={() => {
                            editResult();
                            setDropdownOpen(false);
                          }}
                        >
                          <Tooltip
                            body={`Override Holdout schedule and manually ${holdoutStage === "running" ? "start next phase" : "stop Holdout"} now`}
                            tipPosition="left"
                          >
                            {holdoutStage === "running"
                              ? "Start Analysis Phase"
                              : "Stop Holdout"}
                          </Tooltip>
                        </DropdownMenuItem>
                      ) : experiment.status === "draft" ? (
                        <DropdownMenuItem
                          onClick={() => {
                            setShowStartExperiment(true);
                            setDropdownOpen(false);
                          }}
                        >
                          <Tooltip
                            body="Override Holdout schedule and manually start Holdout now"
                            tipPosition="left"
                          >
                            Start Holdout
                          </Tooltip>
                        </DropdownMenuItem>
                      ) : null)}
                    {(experiment.status !== "draft" || hasResults) && (
                      <DropdownMenuItem
                        onClick={() => {
                          setStatusModal(true);
                          setDropdownOpen(false);
                        }}
                      >
                        Force Status Change
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </>
              )}
              {!isHoldout && (
                <>
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
                        {usersWatching.length > 0
                          ? "View Watchers"
                          : "No watchers"}
                      </Flex>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
              <DropdownMenuItem
                onClick={() => {
                  setCompareModal(true);
                  setDropdownOpen(false);
                }}
              >
                Audit History
              </DropdownMenuItem>
              {/* Only show the separator if one of the following cases is true to avoid double separators */}
              {(showConvertButton ||
                showShareableReportButton ||
                showShareButton ||
                showSaveAsTemplateButton) &&
              !isHoldout ? (
                <DropdownMenuSeparator />
              ) : null}
              {showSaveAsTemplateButton && !isHoldout && (
                <DropdownMenuItem
                  onClick={() => {
                    setShowTemplateForm(true);
                    setDropdownOpen(false);
                  }}
                >
                  Save as Template
                </DropdownMenuItem>
              )}
              {showShareButton && !isHoldout && (
                <DropdownMenuItem
                  onClick={() => {
                    setShareModalOpen(true);
                    setDropdownOpen(false);
                  }}
                >
                  Share {isBandit ? "Bandit" : "Experiment"}
                </DropdownMenuItem>
              )}
              {showShareableReportButton && !isHoldout && (
                <DropdownMenuItem
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
                </DropdownMenuItem>
              )}
              {showConvertButton && !isHoldout && (
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
          </Flex>
        </Flex>
        {/* The redesigned page shows this metadata in the Setup tab's right
          rail, so the header skips it, on every tab: the title row is a fixed
          height, the same on all of them (set in review). */}
        {setupLayout ? null : (
          <ProjectTagBar
            experiment={experiment}
            holdout={holdout}
            setShowEditInfoModal={setShowEditInfoModal}
            setEditInfoFocusSelector={setEditInfoFocusSelector}
            editTags={editTags}
          />
        )}

        {/* In the header on other tabs; on the redesigned page it's below
          the sticky title row instead, which has a fixed height. */}
        {runningExperimentDecisionBanner && !setupLayout ? (
          <Box pt="1" pb="1">
            {runningExperimentDecisionBanner}
          </Box>
        ) : null}
        {scheduledEndPassedBanner && !setupLayout ? (
          <Box pt="1" pb="1">
            {scheduledEndPassedBanner}
          </Box>
        ) : null}
      </div>
      {runningExperimentDecisionBanner && setupLayout ? (
        // Collapses when the banner renders nothing (it often does: no
        // decision yet), so a running experiment's header-to-tabs spacing is
        // the same as a draft's (fixed in review; the 4px + 4px padding
        // showed as an empty 8px strip).
        <Box
          className={clsx(
            "container-fluid pagecontents",
            headerStyles.decisionBanner,
          )}
          pt="1"
          pb="1"
          style={SETUP_LAYOUT_STYLE}
        >
          {runningExperimentDecisionBanner}
        </Box>
      ) : null}
      {/* Main's "scheduled end passed" banner, placed as the decision
        banner is on the redesigned page. */}
      {scheduledEndPassedBanner && setupLayout ? (
        <Box
          className="container-fluid pagecontents"
          pt="1"
          pb="1"
          style={SETUP_LAYOUT_STYLE}
        >
          {scheduledEndPassedBanner}
        </Box>
      ) : null}

      {shouldHideTabs ? null : (
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
            // Always sticky on the redesigned page, right under the sticky
            // title row, so nothing can show between them; `pinned` then
            // only adds the shadow. Elsewhere it goes sticky only once pinned
            // (global.scss), which the observer above detects a frame or two
            // late on a fast scroll (fixed in review).
            //
            // Also a solid strip of the page background 24px up from its top
            // edge (a box-shadow, so it takes no space), hidden under the
            // title row, which is layered above: if a gap ever opens between
            // the two for a frame, the strip fills it instead of the content
            // scrolling past showing through (fixed in review). Written out
            // here with the pinned shadow, which it would otherwise replace.
            style={
              setupLayout
                ? {
                    position: "sticky",
                    zIndex: 930,
                    // Up over the 1px pin sentinel and by the tuck, so before
                    // any scroll it already sits where it pins: tucked 2px
                    // under the title row, as when sticky (set in review).
                    marginTop: -(1 + TABS_TUCK_PX),
                    boxShadow: [
                      "0 -24px 0 0 var(--color-background)",
                      ...(headerPinned
                        ? [
                            "0 1px 2px rgba(0, 0, 0, 0.1)",
                            "0 4px 4px rgba(0, 0, 0, 0.025)",
                          ]
                        : []),
                    ].join(", "),
                  }
                : undefined
            }
          >
            <div
              className={clsx(
                "position-relative container-fluid pagecontents",
                !setupLayout && "px-3",
              )}
              style={setupLayout ? SETUP_LAYOUT_STYLE : undefined}
            >
              {/* Full-bleed divider on the Setup tab. The tab list's own
                divider only spans the padded content width, so it's turned off
                below and redrawn here across the whole container. The row is
                exactly the tabs' height (40px), so the line lands where the
                old one was and the tabs don't move. Rendered before the tabs so
                the active tab's indicator paints over it. */}
              {setupLayout ? (
                <Box
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 1,
                    backgroundColor: "var(--gray-a5)",
                    pointerEvents: "none",
                  }}
                />
              ) : null}
              <div className="d-flex header-tabs">
                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  // Shares the row with the rail toggle on the Setup tab.
                  style={{ width: "100%", flex: 1, minWidth: 0 }}
                >
                  {/* Size 2 on the Setup tab (14px), set in review; other tabs
                    keep size 3 (16px). Both are 40px tall, so the divider above
                    still lines up. */}
                  <TabsList
                    size={setupLayout ? "md" : "lg"}
                    className={setupLayout ? headerStyles.setupTabs : undefined}
                    style={
                      setupLayout
                        ? ({
                            boxShadow: "none",
                            // 4px outside each tab's hover highlight, down
                            // from size 2's 8px. Trying it out in review.
                            "--tab-padding-x": "var(--space-1)",
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    {/* 12px between tabs on the Setup tab, set in review. */}
                    <Flex
                      align="center"
                      className="flex-1"
                      gap={setupLayout ? "3" : undefined}
                    >
                      <TabsTrigger
                        value="overview"
                        style={tabWeight("overview")}
                      >
                        {/* The redesigned tab is named Setup; bandits and
                          holdouts keep the previous layout and name. */}
                        {isBandit || isHoldout ? "Overview" : "Setup"}
                      </TabsTrigger>
                      {/* Tabs disabled before the experiment starts have no
                        hover tooltip (set in review). */}
                      <TabsTrigger
                        value="results"
                        style={tabWeight("results")}
                        disabled={disableNonSetupTabs}
                      >
                        Results
                      </TabsTrigger>
                      {isBandit ? (
                        <TabsTrigger value="explore">Explore</TabsTrigger>
                      ) : null}
                      {!isBandit && !isHoldout && (
                        <TabsTrigger
                          value="dashboards"
                          style={tabWeight("dashboards")}
                          disabled={disableNonSetupTabs}
                        >
                          Dashboards
                        </TabsTrigger>
                      )}
                      {disableNonSetupTabs ? (
                        <TabsTrigger
                          disabled
                          value="health"
                          style={tabWeight("health")}
                        >
                          Health
                        </TabsTrigger>
                      ) : disableHealthTab ? (
                        <DisabledHealthTabTooltip reason="UNSUPPORTED_DATASOURCE">
                          <TabsTrigger
                            disabled
                            value="health"
                            style={tabWeight("health")}
                          >
                            Health
                          </TabsTrigger>
                        </DisabledHealthTabTooltip>
                      ) : (
                        <TabsTrigger
                          value="health"
                          style={tabWeight("health")}
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
                      {hasMultiplePhases ? (
                        <>
                          <div className="flex-1" />
                          <Text size="md" weight="medium">
                            <PhaseSelector
                              phase={phase}
                              phases={experiment.phases}
                              isBandit={
                                experiment.type === "multi-armed-bandit"
                              }
                              isHoldout={experiment.type === "holdout"}
                              holdout={holdout}
                            />
                          </Text>
                        </>
                      ) : null}
                    </Flex>
                  </TabsList>
                </Tabs>
                {/* Collapse / expand the right rail, per the design: at the
                  end of the tab row, above the rail. Outside the tab list, so
                  it isn't announced as a tab. */}
                {onSetupTab && setSetupRailCollapsed ? (
                  <Flex align="center" flexShrink="0" pl="2">
                    {/* A plain span around the button, as the legacy tooltip
                      had: it sets where the button sits in the row, and the
                      3px nudge below was tuned against it. It's OUTSIDE the
                      tooltip so the tooltip attaches to the button itself,
                      and its arrow centres on the button, not the span. */}
                    <span>
                      {/* @/ui/Tooltip, the design system's (set in review),
                        not the legacy one the rest of this header uses. */}
                      <UiTooltip
                        // To the left of the button, not above (set in
                        // review).
                        side="left"
                        content={
                          setupRailCollapsed
                            ? "Expand right rail"
                            : "Collapse right rail"
                        }
                      >
                        <IconButton
                          variant="ghost"
                          color="gray"
                          // Size 2 at its own 24px (set in review), not the
                          // design's 28px, which left a lot of empty space
                          // around the icon.
                          size="2"
                          aria-label={
                            setupRailCollapsed
                              ? "Expand right rail"
                              : "Collapse right rail"
                          }
                          aria-pressed={!setupRailCollapsed}
                          onClick={() =>
                            setSetupRailCollapsed(!setupRailCollapsed)
                          }
                          // Lined up under the header's kebab, set in review:
                          // a 2px right margin, replacing the ghost button's
                          // own -6px, so its right edge sits 2px inside the
                          // row's 32px padding. Nudged down 3px so its bottom
                          // edge is 4px above the tab divider (centred, it was
                          // 7px); a relative offset, so the row doesn't move.
                          style={{
                            marginRight: 2,
                            position: "relative",
                            top: 3,
                          }}
                        >
                          <RailToggleIcon collapsed={setupRailCollapsed} />
                        </IconButton>
                      </UiTooltip>
                    </span>
                  </Flex>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
