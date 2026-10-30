import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
  Variation,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { isDefined } from "shared/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useRouter } from "next/router";
import { DifferenceType } from "shared/types/stats";
import { URLRedirectInterface } from "shared/types/url-redirect";
import {
  HoldoutInterfaceStringDates,
  HoldoutMissingLinkage,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { Box } from "@radix-ui/themes";
import {
  getAvailableMetricsFilters,
  getAvailableMetricTags,
  getAvailableSliceTags,
} from "@/services/experiments";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import CollapsiblePanelLayout, {
  PANEL_WIDTH_PX,
} from "@/components/CollapsiblePanelLayout";
import FeatureFromExperimentModal from "@/components/Features/FeatureModal/FeatureFromExperimentModal";
import Modal from "@/components/Modal";
import {
  getBrowserDevice,
  openVisualEditor,
} from "@/components/OpenVisualEditorLink";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import EditStatusModal from "@/components/Experiment/EditStatusModal";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import BanditSummaryResultsTab from "@/components/Experiment/TabbedPage/BanditSummaryResultsTab";
import PremiumCallout from "@/ui/PremiumCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasHealthData } from "@/components/HealthTab/constants";
import DashboardsTab from "@/enterprise/components/Dashboards/DashboardsTab";
import { useExperimentDashboards } from "@/hooks/useDashboards";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import CompareExperimentEventsModal from "@/components/Experiment/CompareExperimentEventsModal";
import { PreLaunchChecklistProvider } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  NARROW_LAYOUT_BREAKPOINT_PX,
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import type { AnalysisFormFocus } from "@/components/Experiment/AnalysisForm";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ExperimentHeader from "./ExperimentHeader";
import useExperimentEditing from "./useExperimentEditing";
import useStartExperiment from "./useStartExperiment";
import ExperimentDetailsPanel, {
  DetailsPanelTab,
} from "./ExperimentDetailsPanel";
import {
  ExperimentEditsProvider,
  HoldoutDraft,
  useExperimentEdits,
  useExperimentFieldEdit,
  useStagedState,
} from "./ExperimentEdits";
import UnsavedEditsBar from "./UnsavedEditsBar";
import SetupTabOverview from "./SetupTabOverview";
import DraftReviewCallouts from "./DraftReviewCallouts";
import ScheduledUpdateFailureCallout from "./ScheduledUpdateFailureCallout";
import Implementation, {
  IMPLEMENTATION_ID,
  withStagedVariations,
} from "./Implementation";
import { TargetingDraft } from "./TrafficAllocationFunnel";
import {
  AddedFlag,
  addedFlagChanges,
  linkEditId,
  useAddedFlags,
} from "./addedFlags";
import ResultsTab from "./ResultsTab";
import StoppedExperimentBanner from "./StoppedExperimentBanner";
import RunningExperimentDecisionBanner from "./RunningExperimentDecisionBanner";
import ScheduledEndPassedBanner from "./ScheduledEndPassedBanner";
import UnhealthyExperimentBanner, {
  showsUnhealthyBanner,
} from "./UnhealthyExperimentBanner";
import HealthTab from "./HealthTab";

const experimentTabs = [
  "overview",
  "results",
  "explore",
  "dashboards",
  "health",
] as const;
type ExperimentTabName = (typeof experimentTabs)[number];
export type ExperimentTab =
  | ExperimentTabName
  | `${ExperimentTabName}/${string}`;

// The tab a URL hash names, and the path within it.
const parseTabHash = (hash: string) => {
  const [tab, ...path] = hash.replace(/^#/, "").split("/") as [
    ExperimentTabName,
    ...string[],
  ];
  return experimentTabs.includes(tab) ? { tab, path: path.join("/") } : null;
};

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  // Its Data Source was deleted, rather than hidden from this viewer.
  datasourceMissing?: boolean;
  holdout?: HoldoutInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  holdoutMissingLinkage?: HoldoutMissingLinkage;
  mutate: () => void;
  duplicate?: (() => void) | null;
  envs: string[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  newPhase?: (() => void) | null;
  editPhases?: (() => void) | null;
  editTargeting?: (() => void) | null;
  /** Targeting confirmed in a modal but not yet written. */
  targetingDraft?: TargetingDraft;
  editTraffic?: (() => void) | null;
  canAddVariation?: boolean;
  editNamespace?: (() => void) | null;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  editSchedule?: (() => void) | null;
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
}

/** The provider has to sit outside, so the page itself can read its state. */
export default function TabbedPage(props: Props) {
  return (
    <ExperimentEditsProvider
      experiment={props.experiment}
      mutate={props.mutate}
    >
      <TabbedPageContents {...props} />
    </ExperimentEditsProvider>
  );
}

function TabbedPageContents({
  experiment,
  holdout,
  linkedFeatures,
  holdoutFeatures,
  holdoutExperiments,
  holdoutMissingLinkage,
  mutate,
  duplicate,
  visualChangesets,
  envs,
  datasourceMissing = false,
  urlRedirects,
  editTargeting,
  targetingDraft,
  editTraffic,
  canAddVariation,
  editNamespace,
  newPhase,
  editPhases,
  editMetrics,
  editResult,
  editSchedule,
  visualChangesetEnvStates,
  urlRedirectEnvStates,
}: Props) {
  // A tab named in the URL wins over the one viewed last, from the first
  // render, so the last one's content never acts on the URL meanwhile.
  const fromUrl = parseTabHash(window.location.hash);
  const [tab, setTab] = useLocalStorage<ExperimentTab>(
    `tabbedPageTab__${experiment.id}`,
    "overview",
    fromUrl?.tab ?? null,
  );
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [tabPath, setTabPath] = useState(fromUrl?.path ?? "");

  const router = useRouter();

  const { apiCall } = useAuth();
  const edits = useExperimentEdits();

  const [compareModal, setCompareModal] = useState(false);
  // Open state is remembered per experiment; width is a global preference.
  const [detailsOpen, setDetailsOpen] = useLocalStorage(
    `experiment-details-panel-open__${experiment.id}`,
    true,
  );
  const [detailsWidth, setDetailsWidth] = useLocalStorage(
    `experiment-details-panel-width`,
    PANEL_WIDTH_PX,
  );
  // Up here because the panel unmounts whenever it closes.
  const [detailsTab, setDetailsTab] = useState<DetailsPanelTab>("details");
  // The pre-launch checklist and the details panel point at analysis fields.
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);
  const [analysisSettingsFocus, setAnalysisSettingsFocus] =
    useState<AnalysisFormFocus | null>(null);
  const showAnalysisSettings = (
    open: boolean,
    focus: AnalysisFormFocus | null = null,
  ) => {
    setAnalysisSettingsOpen(open);
    setAnalysisSettingsFocus(focus);
  };
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [visualEditorModal, setVisualEditorModal] = useState(false);
  const [featureModal, setFeatureModal] = useState(false);
  // A flag added over staged variations has values for them, and saves with
  // them in one request.
  const [variationsDraft] = useStagedState<Variation[] | null>(
    "variations",
    null,
  );
  const variationsStaged =
    !!variationsDraft &&
    variationsDraft.map((v) => v.id).join() !==
      experiment.variations.map((v) => v.id).join();
  // On a draft, an added flag waits for the page's Save like everything else;
  // every check the save runs happens first, so a refusal shows in the modal.
  const stagesFlags = experiment.status === "draft" && !!edits;
  const [, setAddedFlags] = useAddedFlags();
  const stageFlag = async (added: AddedFlag) => {
    const id = added.feature.id;
    await edits?.checkChanges(linkEditId(id), addedFlagChanges(added));
    setAddedFlags((prev) => [
      ...prev.filter((a) => a.feature.id !== id),
      added,
    ]);
  };
  // Joining, changing or leaving a holdout waits for the page's Save too.
  const [stagedHoldout, setStagedHoldout] = useStagedState<
    HoldoutDraft["value"]
  >("holdout", null);
  useExperimentFieldEdit("holdout", stagedHoldout !== null, experiment, {
    label: "Holdout",
    statusBound: true,
    fields: () => (stagedHoldout !== null ? { holdoutId: stagedHoldout } : {}),
    discard: () => setStagedHoldout(null),
  });
  const holdoutDraft: HoldoutDraft = {
    value: stagedHoldout,
    set: setStagedHoldout,
  };

  const [healthNotificationCount, setHealthNotificationCount] = useState(0);
  const [showDashboardView, setShowDashboardView] = useState(
    !!experiment.defaultDashboardId,
  );
  // Every tab keeps the details rail; the dashboard view is a page of its own.
  const showDetailsPanel = !showDashboardView;

  // When narrow, the panel opens only on request, over the content; the stored
  // choice is for a wide window, so narrowing never overwrites it.
  const narrow = useMediaQuery(`(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`);
  const [openWhileNarrow, setOpenWhileNarrow] = useState(false);
  useEffect(() => setOpenWhileNarrow(false), [narrow]);
  // Off Setup the rail starts closed, and opening it there lasts until the
  // tab changes; Setup keeps the stored choice.
  const tabName = tab.split("/")[0];
  const onSetup = tabName === "overview";
  const [openOffSetup, setOpenOffSetup] = useState(false);
  useEffect(() => setOpenOffSetup(false), [tabName]);
  const [detailsShown, setDetailsShown]: [boolean, (open: boolean) => void] =
    narrow
      ? [openWhileNarrow, setOpenWhileNarrow]
      : onSetup
        ? [detailsOpen, setDetailsOpen]
        : [openOffSetup, setOpenOffSetup];
  const detailsPanelOpen = showDetailsPanel && detailsShown;

  // The toggle is a fresh start: a width dragged out earlier is forgotten.
  const toggleDetailsPanel = (open: boolean) => {
    setDetailsWidth(PANEL_WIDTH_PX);
    setDetailsShown(open);
  };

  // Results tab filters
  const [analysisBarSettings, setAnalysisBarSettings] = useState<{
    dimension: string;
    baselineRow: number;
    differenceType: DifferenceType;
    variationFilter: number[];
  }>({
    dimension: "",
    baselineRow: 0,
    variationFilter: [],
    differenceType: "relative",
  });
  const [metricTagFilter, setMetricTagFilter] = useLocalStorage<string[]>(
    `experiment-page__${experiment.id}__metric_tag_filter`,
    [],
  );
  const [metricsFilter, setMetricsFilter] = useLocalStorage<string[]>(
    `experiment-page__${experiment.id}__metrics_filter`,
    [],
  );
  const [sliceTagsFilter, setSliceTagsFilter] = useLocalStorage<string[]>(
    `experiment-page__${experiment.id}__slice_tags_filter`,
    [],
  );
  const [sortBy, setSortBy] = useLocalStorage<"significance" | "change" | null>(
    `experiment-page__${experiment.id}__sort_by`,
    null,
  );
  const [sortDirection, setSortDirection] = useLocalStorage<
    "asc" | "desc" | null
  >(`experiment-page__${experiment.id}__sort_direction`, null);

  const setMetricTagFilterWithPriority = (newMetricTagFilter: string[]) => {
    setMetricTagFilter(newMetricTagFilter);
  };

  useEffect(() => {
    const getHash = () => {
      // Prefer window.location.hash; on client-side nav it can be empty at first,
      // so fall back to router.asPath (Next.js includes hash in asPath on client).
      const fromWindow =
        typeof window !== "undefined"
          ? window.location.hash.replace(/^#/, "")
          : "";
      const fromAsPath = router.asPath.includes("#")
        ? (router.asPath.split("#")[1] ?? "")
        : "";
      return fromWindow || fromAsPath;
    };

    const handler = () => {
      const hash = getHash();
      const fromHash = parseTabHash(hash);
      if (fromHash) {
        setTab(fromHash.tab);
        setTabPath(fromHash.path);
      } else if (!hash) {
        // If no hash in URL, add the current tab from state to the URL
        const newUrl =
          window.location.href.replace(/#.*/, "") + "#" + tabRef.current;
        router.replace(newUrl, undefined, { shallow: true }).catch((e) => {
          if (!e.cancelled) {
            throw e;
          }
        });
      }
    };
    handler();
    window.addEventListener("hashchange", handler, false);
    return () => window.removeEventListener("hashchange", handler, false);
  }, [setTab, router]);

  const { dashboards } = useExperimentDashboards(experiment.id);

  // If experiment now has a default dashboard, show the dashboard view
  useEffect(() => {
    if (!experiment.defaultDashboardId) {
      setShowDashboardView(false);
      return;
    }
    const defaultDashboard = dashboards?.find(
      ({ id }) => id === experiment.defaultDashboardId,
    );
    if (!defaultDashboard || defaultDashboard.shareLevel !== "published") {
      setShowDashboardView(false);
      return;
    }
    setShowDashboardView(true);
  }, [experiment.defaultDashboardId, dashboards]);

  const { phase, setPhase } = useSnapshot();
  const {
    metricGroups,
    getExperimentMetricById,
    getFactTableById,
    factTables,
    getDatasourceById,
  } = useDefinitions();

  // Extract available metrics and groups for filtering
  const availableMetricsFilters = useMemo(
    () =>
      getAvailableMetricsFilters({
        goalMetrics: experiment.goalMetrics,
        secondaryMetrics: experiment.secondaryMetrics,
        guardrailMetrics: experiment.guardrailMetrics,
        metricGroups,
        getExperimentMetricById,
      }),
    [
      experiment.goalMetrics,
      experiment.secondaryMetrics,
      experiment.guardrailMetrics,
      metricGroups,
      getExperimentMetricById,
    ],
  );

  // Extract all metric tags from expanded metrics
  const availableMetricTags = useMemo(
    () =>
      getAvailableMetricTags({
        goalMetrics: experiment.goalMetrics,
        secondaryMetrics: experiment.secondaryMetrics,
        guardrailMetrics: experiment.guardrailMetrics,
        metricGroups,
        getExperimentMetricById,
      }),
    [
      experiment.goalMetrics,
      experiment.secondaryMetrics,
      experiment.guardrailMetrics,
      metricGroups,
      getExperimentMetricById,
    ],
  );

  // Extract all slice tags from expanded metrics
  const availableSliceTags = useMemo(
    () =>
      getAvailableSliceTags({
        goalMetrics: experiment.goalMetrics,
        secondaryMetrics: experiment.secondaryMetrics,
        guardrailMetrics: experiment.guardrailMetrics,
        customMetricSlices: experiment.customMetricSlices,
        metricGroups,
        factTables,
        getExperimentMetricById,
        getFactTableById,
      }),
    [
      experiment.goalMetrics,
      experiment.secondaryMetrics,
      experiment.guardrailMetrics,
      experiment.customMetricSlices,
      metricGroups,
      getExperimentMetricById,
      getFactTableById,
      factTables,
    ],
  );

  const variables = {
    experiment: experiment.name,
    tags: experiment.tags,
    experimentStatus: experiment.status,
  };

  const viewingOldPhase =
    experiment.phases.length > 0 && phase < experiment.phases.length - 1;
  const { canEdit: canEditExperiment } = useExperimentEditing(
    experiment,
    viewingOldPhase,
    holdout,
  );

  // Other tabs show what's saved, so leaving Setup with staged edits leaves them.
  const [pendingTab, setPendingTab] = useState<{
    tab: ExperimentTab;
    scrollToId?: string;
  } | null>(null);
  const setTabAndScroll = (tab: ExperimentTab, scrollToId?: string) => {
    // Mid-save, Setup stays mounted underneath, and what it saves lands.
    if (
      edits?.dirty &&
      !edits.saving &&
      onSetup &&
      tab.split("/")[0] !== "overview"
    ) {
      setPendingTab({ tab, scrollToId });
      return;
    }
    switchTab(tab, scrollToId);
  };
  const switchTab = (tab: ExperimentTab, scrollToId?: string) => {
    setTab(tab);
    setTabPath("");
    const newUrl = window.location.href.replace(/#.*/, "") + "#" + tab;
    if (newUrl !== window.location.href) {
      router.push(newUrl, undefined, { shallow: true }).catch((e) => {
        // HACK: Workaround for https://github.com/vercel/next.js/issues/37362#issuecomment-1283671326
        // This navigation gets cancelled by persistTabPath with the default dashboard id
        if (!e.cancelled) {
          throw e;
        }
      });
    }
    if (scrollToId) {
      requestAnimationFrame(() => {
        const el = document.getElementById(scrollToId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    } else if (newUrl !== window.location.href) {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
  };

  const start = useStartExperiment({
    experiment,
    holdout,
    envs,
    linkedFeatures,
    mutate,
    newPhase,
    onStarted: () => setTabAndScroll("results"),
  });
  // Up here so the status modal can open the header's Start popover.
  const [startOpen, setStartOpen] = useState(false);

  const persistTabPath = useCallback(
    (path: string) => {
      setTabPath(path);
      const newUrl =
        window.location.href.replace(/#.*/, "") + "#" + tab + "/" + path;
      if (newUrl === window.location.href) return;
      router
        .replace(newUrl, undefined, {
          shallow: true,
        })
        .catch((e) => {
          // HACK: Workaround for https://github.com/vercel/next.js/issues/37362#issuecomment-1283671326
          // Route changes can be cancelled when component unmounts or another navigation occurs
          if (!e.cancelled) {
            throw e;
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab],
  );

  const handleIncrementHealthNotifications = useCallback(() => {
    setHealthNotificationCount((prev) => prev + 1);
  }, []);

  const handleSnapshotChange = useCallback(() => {
    // Reset notifications when snapshot changes and the health tab needs to re-render
    setHealthNotificationCount(0);
  }, []);

  const { data, mutate: mutateWatchers } = useApi<{
    userIds: string[];
  }>(`/experiment/${experiment.id}/watchers`);
  const { users, organization } = useUser();

  // Get name or email of all active users watching this experiment
  const usersWatching = (data?.userIds || [])
    .map((id) => users.get(id))
    .filter(isDefined)
    .map((u) => u.name || u.email);

  const { browser, deviceType } = useMemo(() => {
    const ua = navigator.userAgent;
    return getBrowserDevice(ua);
  }, []);

  const isBandit = experiment.type === "multi-armed-bandit";
  const trackSource = "tabbed-page";

  const showMetricGroupPromo = (): boolean => {
    if (metricGroups.length) return false;

    if (
      experiment.project ===
      getDemoDatasourceProjectIdForOrganization(organization.id)
    ) {
      return false;
    }

    // only show if there are at least 2 metrics in any section
    if (
      experiment.goalMetrics.length > 2 ||
      experiment.secondaryMetrics.length > 2 ||
      experiment.guardrailMetrics.length > 2
    ) {
      return true;
    }

    return false;
  };

  const isHoldout = experiment.type === "holdout";

  const { getDecisionCriteria, getRunningExperimentResultStatus } =
    useRunningExperimentStatus();
  const decisionCriteria = getDecisionCriteria(
    experiment.decisionFrameworkSettings?.decisionCriteriaId,
  );
  const runningExperimentStatus = getRunningExperimentResultStatus(experiment);
  const dataSource = getDatasourceById(experiment.datasource);
  const healthTabAvailable = hasHealthData(dataSource);

  const showStoppedBanner =
    experiment.status === "stopped" && tab !== "dashboards";
  // Setup's content starts close under the tabs; the other tabs pad their own.
  const bannerMargin = {
    mt: "3",
    mb: tab === "overview" ? "4" : "0",
  } as const;
  const showRunningBanners =
    experiment.status === "running" && !isHoldout && tab !== "dashboards";

  return (
    <PreLaunchChecklistProvider
      experiment={experiment}
      linkedFeatures={linkedFeatures}
      visualChangesets={visualChangesets}
      urlRedirects={urlRedirects}
      mutateExperiment={mutate}
      canEdit={canEditExperiment}
      editTargeting={editTargeting}
      editSchedule={editSchedule}
      openImplementation={() => setTabAndScroll("overview", IMPLEMENTATION_ID)}
      openAnalysisSettings={(focus) => {
        setTabAndScroll("overview");
        showAnalysisSettings(true, focus);
      }}
    >
      {compareModal && (
        <CompareExperimentEventsModal
          experiment={experiment}
          onClose={() => setCompareModal(false)}
        />
      )}
      {watchersModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="Experiment Watchers"
          close={() => setWatchersModal(false)}
          closeCta="Close"
        >
          <ul>
            {usersWatching.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </Modal>
      )}
      {visualEditorModal && (
        <VisualChangesetModal
          mode="add"
          experiment={experiment}
          mutate={mutate}
          close={() => setVisualEditorModal(false)}
          onCreate={async (vc) => {
            // Try to immediately open the visual editor
            await openVisualEditor({
              vc,
              apiCall,
              browser,
              deviceType,
              beforeLeave: edits?.allowUnload,
            });
          }}
          cta="Open AI Visual Editor"
          source={trackSource}
        />
      )}
      {statusModal && (
        <EditStatusModal
          experiment={experiment}
          close={() => setStatusModal(false)}
          mutate={mutate}
          source={trackSource}
          holdout={holdout}
          openStart={isHoldout ? null : () => setStartOpen(true)}
        />
      )}
      {featureModal && (
        <FeatureFromExperimentModal
          experiment={withStagedVariations(experiment, variationsDraft)}
          stage={stagesFlags ? stageFlag : undefined}
          saveWithStagedChanges={
            !stagesFlags && variationsStaged && edits
              ? edits.saveAll
              : undefined
          }
          close={() => setFeatureModal(false)}
          mutate={mutate}
          source={trackSource}
          reAddableFeatureIds={linkedFeatures
            .filter((f) => f.state === "discarded")
            .map((f) => f.feature.id)}
        />
      )}
      {/* TODO: Update Experiment Header props to include redirect and pipe through to StartExperimentBanner */}

      {pendingTab ? (
        <ConfirmDialog
          title="Leave without saving?"
          content="You have unsaved changes to this experiment. Leaving Setup discards them."
          // Staying is the primary action; leaving is the secondary one.
          yesText="Keep editing"
          noText="Leave Setup"
          onConfirm={() => setPendingTab(null)}
          onCancel={() => {
            edits?.discardAll();
            switchTab(pendingTab.tab, pendingTab.scrollToId);
            setPendingTab(null);
          }}
          onDismiss={() => setPendingTab(null)}
        />
      ) : null}
      <ExperimentHeader
        experiment={experiment}
        datasourceMissing={datasourceMissing}
        holdout={holdout}
        tab={tab}
        setTab={setTabAndScroll}
        mutate={mutate}
        setCompareModal={setCompareModal}
        setStatusModal={setStatusModal}
        setWatchersModal={setWatchersModal}
        duplicate={duplicate}
        usersWatching={usersWatching}
        mutateWatchers={mutateWatchers}
        editResult={editResult || undefined}
        editTargeting={editTargeting}
        detailsOpen={detailsShown}
        setDetailsOpen={toggleDetailsPanel}
        start={start}
        startOpen={startOpen}
        setStartOpen={setStartOpen}
        editPhases={editPhases}
        healthNotificationCount={healthNotificationCount}
        linkedFeatures={linkedFeatures}
        visualChangesets={visualChangesets}
        urlRedirects={urlRedirects}
        showDashboardView={showDashboardView}
        editSchedule={editSchedule}
      />
      <Box
        mx="auto"
        width="100%"
        style={{ maxWidth: "var(--page-content-max-width)" }}
      >
        <CollapsiblePanelLayout
          open={detailsPanelOpen}
          top={TABS_HEADER_HEIGHT_PX + TABS_BAR_HEIGHT_PX}
          width={detailsWidth}
          onWidthChange={setDetailsWidth}
          onCollapse={() => setDetailsShown(false)}
          // Only the content's edits stage; the panel's save as they're made.
          footer={<UnsavedEditsBar />}
          // So what a save judges as saved is what it sent.
          busy={!!edits?.saving}
          panel={
            showDetailsPanel ? (
              <ExperimentDetailsPanel
                experiment={experiment}
                datasourceMissing={datasourceMissing}
                holdout={holdout}
                mutate={mutate}
                disableEditing={viewingOldPhase}
                stagedHoldoutId={stagedHoldout}
                tab={detailsTab}
                setTab={setDetailsTab}
              />
            ) : null
          }
        >
          <div className="experiment-column">
            <div
              className={clsx(
                "container-fluid pagecontents px-4",
                showDashboardView && "pt-0",
              )}
            >
              {experiment.type !== "holdout" &&
                tab !== "dashboards" &&
                !showDashboardView && (
                  <CustomMarkdown page={"experiment"} variables={variables} />
                )}
              {edits?.refreshFailed ? (
                <Callout
                  status="warning"
                  action={
                    <Link onClick={() => window.location.reload()}>Reload</Link>
                  }
                  {...bannerMargin}
                >
                  Your changes saved, but the page couldn&apos;t refresh to show
                  them.
                </Callout>
              ) : null}
              {showStoppedBanner && (
                <StoppedExperimentBanner
                  experiment={experiment}
                  linkedFeatures={linkedFeatures}
                  mutate={mutate}
                  editResult={editResult || undefined}
                  {...bannerMargin}
                />
              )}
              {showRunningBanners &&
              tab !== "health" &&
              showsUnhealthyBanner(experiment, runningExperimentStatus) ? (
                <UnhealthyExperimentBanner
                  status={runningExperimentStatus!}
                  viewHealth={
                    healthTabAvailable ? () => setTabAndScroll("health") : null
                  }
                  {...bannerMargin}
                />
              ) : null}
              {showRunningBanners && runningExperimentStatus ? (
                <RunningExperimentDecisionBanner
                  experiment={experiment}
                  runningExperimentStatus={runningExperimentStatus}
                  decisionCriteria={decisionCriteria}
                  makeDecision={editResult || undefined}
                  {...bannerMargin}
                />
              ) : null}
              {showRunningBanners && !isBandit ? (
                <ScheduledEndPassedBanner
                  experiment={experiment}
                  runningExperimentStatus={runningExperimentStatus}
                  editSchedule={
                    canEditExperiment && editSchedule ? editSchedule : undefined
                  }
                  {...bannerMargin}
                />
              ) : null}
              {viewingOldPhase &&
                ((!isBandit && tab === "results") ||
                  (isBandit && tab === "explore")) && (
                  <Callout
                    status="info"
                    contentAlign="center"
                    action={
                      <Link
                        onClick={() => setPhase(experiment.phases.length - 1)}
                      >
                        {isHoldout
                          ? "Switch to analysis phase"
                          : "Switch to latest phase"}
                      </Link>
                    }
                    {...bannerMargin}
                  >
                    {isHoldout
                      ? "You're viewing results for the whole holdout period. The analysis phase looks back from its own start date."
                      : "You're viewing results from a previous phase."}
                  </Callout>
                )}

              {showDashboardView && (
                <DashboardsTab
                  experiment={experiment}
                  initialDashboardId={experiment.defaultDashboardId ?? ""}
                  isTabActive
                  showDashboardView
                  switchToExperimentView={() => setShowDashboardView(false)}
                  updateTabPath={persistTabPath}
                />
              )}
              <div
                className={clsx(
                  "pt-2",
                  // Hidden, never unmounted: staged edits live in Setup.
                  tab === "overview" && !showDashboardView
                    ? "d-block"
                    : "d-none d-print-block",
                )}
              >
                <ScheduledUpdateFailureCallout
                  experiment={experiment}
                  editSchedule={editSchedule}
                />
                <DraftReviewCallouts
                  experiment={experiment}
                  linkedFeatures={linkedFeatures}
                />
                <SetupTabOverview
                  experiment={experiment}
                  holdout={holdout}
                  holdoutExperiments={holdoutExperiments}
                  mutate={mutate}
                  disableEditing={viewingOldPhase}
                  editSchedule={editSchedule}
                />
                <Implementation
                  experiment={experiment}
                  datasourceMissing={datasourceMissing}
                  holdoutDraft={holdoutDraft}
                  disableEditing={viewingOldPhase}
                  holdout={holdout}
                  holdoutFeatures={holdoutFeatures}
                  holdoutExperiments={holdoutExperiments}
                  holdoutMissingLinkage={holdoutMissingLinkage}
                  mutate={mutate}
                  setFeatureModal={setFeatureModal}
                  setVisualEditorModal={setVisualEditorModal}
                  visualChangesets={visualChangesets}
                  urlRedirects={urlRedirects}
                  editTargeting={editTargeting}
                  targetingDraft={targetingDraft}
                  analysisSettingsOpen={analysisSettingsOpen}
                  setAnalysisSettingsOpen={showAnalysisSettings}
                  analysisSettingsFocus={analysisSettingsFocus}
                  editTraffic={editTraffic}
                  canAddVariation={canAddVariation}
                  editNamespace={editNamespace}
                  linkedFeatures={linkedFeatures}
                  envs={envs}
                  visualChangesetEnvStates={visualChangesetEnvStates}
                  urlRedirectEnvStates={urlRedirectEnvStates}
                />
              </div>
              {isBandit && !showDashboardView ? (
                <div
                  className={
                    // todo: standardize explore & results tabs across experiment types
                    isBandit && tab === "results"
                      ? "container-fluid pagecontents px-4 py-4 d-block"
                      : "d-none d-print-block"
                  }
                >
                  <BanditSummaryResultsTab
                    experiment={experiment}
                    mutate={mutate}
                    isTabActive={tab === "results"}
                  />
                </div>
              ) : null}
            </div>
            <div
              className={
                // todo: standardize explore & results tabs across experiment types
                ((!isBandit && tab === "results") ||
                  (isBandit && tab === "explore")) &&
                !showDashboardView
                  ? "container-fluid pagecontents px-4 py-4 d-block"
                  : "d-none d-print-block"
              }
            >
              {showMetricGroupPromo() ? (
                <PremiumCallout
                  commercialFeature="metric-groups"
                  dismissible={true}
                  id="metrics-list-metric-group-promo"
                  docSection="metricGroups"
                  mb="2"
                >
                  <strong>Metric Groups</strong> help you organize and manage
                  your metrics at scale.
                </PremiumCallout>
              ) : null}
              {/* TODO: Update ResultsTab props to include redirect and pipe through to StartExperimentBanner */}
              <ResultsTab
                experiment={experiment}
                mutate={mutate}
                holdoutProjects={holdout?.projects}
                editMetrics={editMetrics}
                envs={envs}
                setTab={setTabAndScroll}
                isTabActive={tab === "results"}
                metricTagFilter={metricTagFilter}
                metricsFilter={metricsFilter}
                setMetricsFilter={setMetricsFilter}
                availableMetricsFilters={availableMetricsFilters}
                availableMetricTags={availableMetricTags}
                availableSliceTags={availableSliceTags}
                sliceTagsFilter={sliceTagsFilter}
                setSliceTagsFilter={setSliceTagsFilter}
                analysisBarSettings={analysisBarSettings}
                setAnalysisBarSettings={setAnalysisBarSettings}
                setMetricTagFilter={setMetricTagFilterWithPriority}
                sortBy={sortBy}
                setSortBy={setSortBy}
                sortDirection={sortDirection}
                setSortDirection={setSortDirection}
              />
            </div>
            <div
              className={
                tab === "dashboards" && !showDashboardView
                  ? "container-fluid pagecontents px-4 py-4 d-block"
                  : "d-none d-print-block"
              }
            >
              <DashboardsTab
                experiment={experiment}
                initialDashboardId={tabPath}
                isTabActive={tab === "dashboards"}
                mutateExperiment={mutate}
                updateTabPath={persistTabPath}
              />
            </div>
            <div
              className={
                tab === "health" && !showDashboardView
                  ? "container-fluid pagecontents px-4 py-4 d-block"
                  : "d-none d-print-block"
              }
            >
              <HealthTab
                experiment={experiment}
                onHealthNotify={handleIncrementHealthNotifications}
                onSnapshotUpdate={handleSnapshotChange}
                resetResultsSettings={() => {
                  setAnalysisBarSettings({
                    ...analysisBarSettings,
                    baselineRow: 0,
                    differenceType: "relative",
                    variationFilter: [],
                  });
                }}
                isTabActive={tab === "health"}
              />
            </div>
          </div>
        </CollapsiblePanelLayout>
      </Box>
    </PreLaunchChecklistProvider>
  );
}
