import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { isDefined } from "shared/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useRouter } from "next/router";
import { DifferenceType } from "shared/types/stats";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { HoldoutInterfaceStringDates } from "shared/validators";
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
import useSDKConnections from "@/hooks/useSDKConnections";
import { useAuth } from "@/services/auth";
import EditStatusModal from "@/components/Experiment/EditStatusModal";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import BanditSummaryResultsTab from "@/components/Experiment/TabbedPage/BanditSummaryResultsTab";
import PremiumCallout from "@/ui/PremiumCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import DashboardsTab from "@/enterprise/components/Dashboards/DashboardsTab";
import { useExperimentDashboards } from "@/hooks/useDashboards";
import Callout from "@/ui/Callout";
import { useManagedExperimentFlags } from "@/hooks/useManagedExperimentFlags";
import Link from "@/ui/Link";
import CompareExperimentEventsModal from "@/components/Experiment/CompareExperimentEventsModal";
import { PreLaunchChecklistProvider } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  NARROW_LAYOUT_BREAKPOINT_PX,
  TABS_BAR_HEIGHT_PX,
  TABS_HEADER_HEIGHT_PX,
} from "@/components/Layout/constants";
import useMediaQuery from "@/hooks/useMediaQuery";
import { ManagedFlagRenameProvider } from "@/components/Experiment/ManagedFlagRename";
import ExperimentHeader from "./ExperimentHeader";
import useExperimentEditing from "./useExperimentEditing";
import useExperimentReviewRoute from "./useExperimentReviewRoute";
import useStartExperiment from "./useStartExperiment";
import ExperimentReview from "./ExperimentReview";
import ExperimentRevisionControl from "./ExperimentRevisionControl";
import {
  VALUES_STATUS_BANNER_ID,
  ValuesStatusBanner,
  ValuesStatusRow,
} from "./ValuesStatusBanner";
import { hasValuesReview } from "./valuesStatus";
import ExperimentDetailsPanel, {
  DetailsPanelTab,
} from "./ExperimentDetailsPanel";
import {
  ExperimentEditsProvider,
  experimentFieldChanges,
  HoldoutDraft,
  ImplementationTypeDraft,
  useRegisterExperimentEdit,
} from "./ExperimentEdits";
import UnsavedEditsBar from "./UnsavedEditsBar";
import SetupTabOverview from "./SetupTabOverview";
import Implementation, { IMPLEMENTATION_ID } from "./Implementation";
import { TargetingDraft } from "./TrafficAllocationFunnel";
import ResultsTab from "./ResultsTab";
import StoppedExperimentBanner from "./StoppedExperimentBanner";
import HealthTab from "./HealthTab";
import { FLAG_VALUES_ID } from "./FlagValueRows";

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

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  mutate: () => void;
  duplicate?: (() => void) | null;
  envs: string[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  newPhase?: (() => void) | null;
  editPhase?: ((i: number | null) => void) | null;
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
      experimentId={props.experiment.id}
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
  mutate,
  duplicate,
  visualChangesets,
  envs,
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
  // The URL outranks the stored tab from the first render, so a link to a
  // sub-path such as the review never renders under another tab.
  const [initialHash] = useState(() => {
    const [name, ...path] = window.location.hash.replace(/^#/, "").split("/");
    return {
      tab: (experimentTabs as readonly string[]).includes(name)
        ? (name as ExperimentTabName)
        : null,
      path: path.join("/"),
    };
  });
  const [tab, setTab] = useLocalStorage<ExperimentTab>(
    `tabbedPageTab__${experiment.id}`,
    "overview",
    initialHash.tab,
  );
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [tabPath, setTabPath] = useState(initialHash.path);

  const router = useRouter();

  const { apiCall } = useAuth();

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
  // The analysis settings modal, which the pre-launch checklist opens too.
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [visualEditorModal, setVisualEditorModal] = useState(false);
  const [featureModal, setFeatureModal] = useState(false);
  // Staged like any other field; the save converts or deletes a managed flag
  // to match, or creates one on the way into Values.
  const [stagedType, setStagedType] =
    useState<ImplementationTypeDraft["value"]>(null);
  useRegisterExperimentEdit("implementationType", !!stagedType, {
    changes: () =>
      stagedType
        ? {
            ...experimentFieldChanges(experiment, {
              implementationType: stagedType.type,
            }),
            ...(stagedType.deletesManagedFlag && { deleteManagedFlag: true }),
          }
        : {},
    onSaved: () => setStagedType(null),
    discard: () => setStagedType(null),
  });
  const implementationTypeDraft: ImplementationTypeDraft = {
    value: stagedType,
    set: setStagedType,
  };
  // Joining, changing or leaving a holdout waits for the page's Save too.
  const [stagedHoldout, setStagedHoldout] =
    useState<HoldoutDraft["value"]>(null);
  useRegisterExperimentEdit("holdout", stagedHoldout !== null, {
    changes: () =>
      stagedHoldout !== null
        ? experimentFieldChanges(experiment, { holdoutId: stagedHoldout })
        : {},
    onSaved: () => setStagedHoldout(null),
    discard: () => setStagedHoldout(null),
  });
  const holdoutDraft: HoldoutDraft = {
    value: stagedHoldout,
    set: setStagedHoldout,
  };

  const { managedFeature } = useManagedExperimentFlags({
    experiment,
    linkedFeatures,
  });
  // Keyed on `pendingDraft`, not `state`: a running experiment's unpublished
  // edit still reports "live".
  const managedFlagWithDraft = managedFeature?.pendingDraft
    ? managedFeature
    : null;
  const valuesReview =
    !!managedFlagWithDraft?.pendingDraft &&
    hasValuesReview(managedFlagWithDraft.pendingDraft);
  const reviewable =
    !experiment.archived && experiment.type !== "holdout" && valuesReview;
  const { reviewing, openReview } = useExperimentReviewRoute({
    tab,
    tabPath,
    setTab,
    setTabPath,
    reviewable,
  });
  const reviewingRef = useRef(reviewing);
  reviewingRef.current = reviewing;

  const [healthNotificationCount, setHealthNotificationCount] = useState(0);
  const [showDashboardView, setShowDashboardView] = useState(
    !!experiment.defaultDashboardId && !reviewing,
  );
  // The review outranks a default dashboard, which would rewrite the hash.
  const dashboardView = showDashboardView && !reviewing;
  // Leaving the review lands on Setup, however it was entered.
  useEffect(() => {
    if (reviewing) setShowDashboardView(false);
  }, [reviewing]);
  // Every tab keeps the details rail; the dashboard view and the review are
  // pages of their own.
  const showDetailsPanel = !dashboardView && !reviewing;

  // Too narrow for the page and the panel side by side, the panel starts
  // hidden and opens only when asked, over the content. The stored choice is
  // for a wide window, so narrowing one never overwrites it.
  const narrow = useMediaQuery(`(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`);
  const [openWhileNarrow, setOpenWhileNarrow] = useState(false);
  useEffect(() => setOpenWhileNarrow(false), [narrow]);
  const detailsShown = narrow ? openWhileNarrow : detailsOpen;
  const detailsPanelOpen = showDetailsPanel && detailsShown;
  const setDetailsShown = (open: boolean) =>
    narrow ? setOpenWhileNarrow(open) : setDetailsOpen(open);

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
      const hash = getHash() as ExperimentTab;
      const [tabName, ...tabPathSegments] = hash.split("/") as [
        ExperimentTabName,
        ...string[],
      ];
      if (experimentTabs.includes(tabName)) {
        const tabPath = tabPathSegments.join("/");
        setTab(tabName);
        setTabPath(tabPath);
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
    // Dashboards that load under the review must not reopen it on the way out.
    if (reviewingRef.current) return;
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
  );

  const setTabAndScroll = (tab: ExperimentTab, scrollToId?: string) => {
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
  // The header's Start anchors it, and the review hides that.
  const [startOpen, setStartOpen] = useState(false);
  useEffect(() => {
    if (reviewing) setStartOpen(false);
  }, [reviewing]);

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

  const { data: sdkConnectionsData } = useSDKConnections();
  const connections = sdkConnectionsData?.connections || [];

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

    // only show if there are atleast 2 metrics in any section
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

  const showStoppedBanner =
    experiment.status === "stopped" && tab !== "dashboards";

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
      // Its To Do shows only off the review, in the rail and the start popover.
      // Before the values are sent, Setup's banner is where they go.
      openManagedApproval={
        reviewable
          ? () => openReview("todo")
          : managedFlagWithDraft
            ? () => setTabAndScroll("overview", VALUES_STATUS_BANNER_ID)
            : undefined
      }
      editVariationValues={() => setTabAndScroll("overview", FLAG_VALUES_ID)}
      openImplementation={() => setTabAndScroll("overview", IMPLEMENTATION_ID)}
      openAnalysisSettings={() => {
        // The modal belongs to the hidden Setup, so it opens over the review.
        if (!reviewing) setTabAndScroll("overview");
        setAnalysisSettingsOpen(true);
      }}
    >
      <ManagedFlagRenameProvider
        experiment={experiment}
        feature={managedFeature?.feature ?? null}
        stagedType={stagedType?.type ?? null}
        canEdit={canEditExperiment}
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
              });
            }}
            cta="Open Visual Editor"
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
            openStart={
              experiment.type !== "holdout"
                ? () => {
                    if (reviewing) setTabAndScroll("overview");
                    setStartOpen(true);
                  }
                : null
            }
          />
        )}
        {featureModal && (
          <FeatureFromExperimentModal
            experiment={experiment}
            close={() => setFeatureModal(false)}
            mutate={mutate}
            source={trackSource}
            reAddableFeatureIds={linkedFeatures
              .filter((f) => f.state === "discarded")
              .map((f) => f.feature.id)}
          />
        )}
        {/* TODO: Update Experiment Header props to include redirect and pipe through to StartExperimentBanner */}

        <ExperimentHeader
          experiment={experiment}
          holdout={holdout}
          envs={envs}
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
          setDetailsOpen={showDetailsPanel ? toggleDetailsPanel : undefined}
          start={start}
          reviewing={reviewing}
          startOpen={startOpen}
          setStartOpen={setStartOpen}
          editPhases={editPhases}
          healthNotificationCount={healthNotificationCount}
          linkedFeatures={linkedFeatures}
          visualChangesets={visualChangesets}
          urlRedirects={urlRedirects}
          showDashboardView={dashboardView}
          editSchedule={editSchedule}
          revisionControl={
            experiment.type !== "holdout" && linkedFeatures.length > 0 ? (
              <ExperimentRevisionControl
                experiment={experiment}
                linkedFeatures={linkedFeatures}
              />
            ) : null
          }
          detailsWidth={detailsWidth}
          startValuesStatus={
            <ValuesStatusRow
              experiment={experiment}
              linkedFeatures={linkedFeatures}
              managed={managedFlagWithDraft}
              mutate={mutate}
              openReview={reviewable ? () => openReview("start") : null}
            />
          }
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
            panel={
              showDetailsPanel ? (
                <ExperimentDetailsPanel
                  experiment={experiment}
                  holdout={holdout}
                  mutate={mutate}
                  disableEditing={viewingOldPhase}
                  linkedFeatures={linkedFeatures}
                  stagedImplementationType={stagedType?.type ?? null}
                  stagedHoldoutId={stagedHoldout}
                  editSchedule={editSchedule}
                  tab={detailsTab}
                  setTab={setDetailsTab}
                />
              ) : null
            }
          >
            <div
              className={clsx(
                "container-fluid pagecontents px-4",
                dashboardView && "pt-0",
              )}
            >
              {tab === "overview" &&
              !reviewing &&
              !dashboardView &&
              experiment.type !== "holdout" &&
              !experiment.archived ? (
                <ValuesStatusBanner
                  experiment={experiment}
                  linkedFeatures={linkedFeatures}
                  managed={managedFlagWithDraft}
                  mutate={mutate}
                  openReview={reviewable ? () => openReview("banner") : null}
                />
              ) : null}
              {experiment.type !== "holdout" &&
                tab !== "dashboards" &&
                !dashboardView &&
                !reviewing && (
                  <CustomMarkdown page={"experiment"} variables={variables} />
                )}
              {showStoppedBanner && (
                <div className="pt-3">
                  <StoppedExperimentBanner
                    experiment={experiment}
                    linkedFeatures={linkedFeatures}
                    mutate={mutate}
                    editResult={editResult || undefined}
                  />
                </div>
              )}
              {viewingOldPhase &&
                ((!isBandit && tab === "results") ||
                  (isBandit && tab === "explore")) && (
                  <Callout status="info">
                    {isHoldout
                      ? "You are viewing the results of the entire holdout period."
                      : "You are viewing the results of a previous experiment phase."}
                    <Link
                      ml="2"
                      onClick={() => setPhase(experiment.phases.length - 1)}
                    >
                      {isHoldout
                        ? "Switch to the analysis phase to view results with a lookback based on the analysis phase start date."
                        : "Switch to the latest phase"}
                    </Link>
                  </Callout>
                )}

              {reviewing && managedFlagWithDraft ? (
                <ExperimentReview
                  experiment={experiment}
                  info={managedFlagWithDraft}
                  mutate={mutate}
                  exit={() => setTabAndScroll("overview")}
                />
              ) : null}
              {dashboardView && (
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
                  tab === "overview" && !dashboardView && !reviewing
                    ? "d-block"
                    : "d-none d-print-block",
                )}
              >
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
                  implementationTypeDraft={implementationTypeDraft}
                  holdoutDraft={holdoutDraft}
                  disableEditing={viewingOldPhase}
                  holdout={holdout}
                  holdoutFeatures={holdoutFeatures}
                  holdoutExperiments={holdoutExperiments}
                  mutate={mutate}
                  setFeatureModal={setFeatureModal}
                  setVisualEditorModal={setVisualEditorModal}
                  visualChangesets={visualChangesets}
                  urlRedirects={urlRedirects}
                  editTargeting={editTargeting}
                  targetingDraft={targetingDraft}
                  analysisSettingsOpen={analysisSettingsOpen}
                  setAnalysisSettingsOpen={setAnalysisSettingsOpen}
                  editTraffic={editTraffic}
                  canAddVariation={canAddVariation}
                  editNamespace={editNamespace}
                  linkedFeatures={linkedFeatures}
                  envs={envs}
                  visualChangesetEnvStates={visualChangesetEnvStates}
                  urlRedirectEnvStates={urlRedirectEnvStates}
                />
              </div>
              {isBandit && !dashboardView ? (
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
                !dashboardView
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
                editMetrics={editMetrics}
                editResult={editResult}
                newPhase={newPhase}
                connections={connections}
                envs={envs}
                setTab={setTabAndScroll}
                visualChangesets={visualChangesets}
                editTargeting={editTargeting}
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
                tab === "dashboards" && !dashboardView
                  ? "container-fluid pagecontents px-4 py-4 d-block"
                  : "d-none d-print-block"
              }
            >
              <DashboardsTab
                experiment={experiment}
                // The review's path isn't a dashboard id.
                initialDashboardId={tab === "dashboards" ? tabPath : ""}
                isTabActive={tab === "dashboards"}
                mutateExperiment={mutate}
                updateTabPath={persistTabPath}
              />
            </div>
            <div
              className={
                tab === "health" && !dashboardView
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
              />
            </div>
          </CollapsiblePanelLayout>
        </Box>
        {/* Outside the page's max width: the bar spans the window, its contents
          line up with the page. */}
        <UnsavedEditsBar />
      </ManagedFlagRenameProvider>
    </PreLaunchChecklistProvider>
  );
}
