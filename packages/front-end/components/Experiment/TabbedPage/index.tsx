import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { isDefined, experimentHasLiveLinkedChanges } from "shared/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useRouter } from "next/router";
import { DifferenceType } from "shared/types/stats";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { FaChartBar } from "react-icons/fa";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import {
  getAvailableMetricsFilters,
  getAvailableMetricTags,
  getAvailableSliceTags,
} from "@/services/experiments";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeatureFromExperimentModal from "@/components/Features/FeatureModal/FeatureFromExperimentModal";
import Modal from "@/components/Modal";
import {
  getBrowserDevice,
  openVisualEditor,
} from "@/components/OpenVisualEditorLink";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import DiscussionThread from "@/components/DiscussionThread";
import { useAuth } from "@/services/auth";
import EditStatusModal from "@/components/Experiment/EditStatusModal";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import BanditSummaryResultsTab from "@/components/Experiment/TabbedPage/BanditSummaryResultsTab";
import Button from "@/ui/Button";
import PremiumCallout from "@/ui/PremiumCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import DashboardsTab from "@/enterprise/components/Dashboards/DashboardsTab";
import { useExperimentDashboards } from "@/hooks/useDashboards";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import CompareExperimentEventsModal from "@/components/Experiment/CompareExperimentEventsModal";
import { PreLaunchChecklistProvider } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import ExperimentHeader from "./ExperimentHeader";
import SetupTabOverview from "./SetupTabOverview";
import SetupPage from "./SetupPage/SetupPage";
import Implementation from "./Implementation";
import ResultsTab from "./ResultsTab";
import StoppedExperimentBanner from "./StoppedExperimentBanner";
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

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  mutate: () => void;
  duplicate?: (() => void) | null;
  editTags?: (() => void) | null;
  envs: string[];
  editVariations?: (() => void) | null;
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  newPhase?: (() => void) | null;
  editPhase?: ((i: number | null) => void) | null;
  editPhases?: (() => void) | null;
  editTargeting?: (() => void) | null;
  editTraffic?: ((variationId?: string) => void) | null;
  addVariation?: (() => void) | null;
  editNamespace?: (() => void) | null;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  editSchedule?: (() => void) | null;
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
}

export default function TabbedPage({
  experiment,
  holdout,
  linkedFeatures,
  holdoutFeatures,
  holdoutExperiments,
  mutate,
  duplicate,
  editTags,
  editVariations,
  visualChangesets,
  envs,
  urlRedirects,
  editTargeting,
  editTraffic,
  addVariation,
  editNamespace,
  newPhase,
  editPhases,
  editMetrics,
  editResult,
  editSchedule,
  visualChangesetEnvStates,
  urlRedirectEnvStates,
}: Props) {
  // The tab a fresh load lands on, from the experiment's status alone (set
  // in review): Setup ("overview") for a draft, scheduled or not; Results
  // once it's running or stopped. Never the last tab viewed: nothing is
  // remembered, so the same link lands everyone in the same place. A tab in
  // the URL always wins (the hash handler below applies it).
  const defaultTab: ExperimentTab =
    experiment.status === "running" || experiment.status === "stopped"
      ? "results"
      : "overview";
  const [tab, setTab] = useState<ExperimentTab>(defaultTab);
  // Moving to another experiment (client-side, without a remount): back to
  // that one's default, unless its URL names a tab.
  const loadedExperimentId = useRef(experiment.id);
  useEffect(() => {
    if (loadedExperimentId.current === experiment.id) return;
    loadedExperimentId.current = experiment.id;
    if (!window.location.hash.replace(/^#/, "")) setTab(defaultTab);
    // Only on a change of experiment; defaultTab follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment.id]);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // The redesigned Setup tab's right rail, collapsed or not. Remembered in
  // this browser, across experiments, so the choice sticks.
  const [setupRailCollapsed, setSetupRailCollapsed] = useLocalStorage<boolean>(
    "setupRailCollapsed",
    false,
  );
  const [tabPath, setTabPath] = useState(
    window.location.hash.replace(/^#/, "").split("/").slice(1).join("/"),
  );

  const router = useRouter();

  const { apiCall } = useAuth();

  const [compareModal, setCompareModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [visualEditorModal, setVisualEditorModal] = useState(false);
  const [featureModal, setFeatureModal] = useState(false);
  const [urlRedirectModal, setUrlRedirectModal] = useState(false);
  const [healthNotificationCount, setHealthNotificationCount] = useState(0);
  const [showDashboardView, setShowDashboardView] = useState(
    experiment.defaultDashboardId ? true : false,
  );

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

  const safeToEdit =
    experiment.status !== "running" ||
    !experimentHasLiveLinkedChanges(experiment, linkedFeatures);

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
  // The redesigned Setup tab covers standard experiments. Bandits and
  // holdouts keep the previous layout: the design doesn't cover them.
  const useRedesignedSetup =
    !isHoldout && experiment.type !== "multi-armed-bandit";
  const showRedesignedSetup =
    useRedesignedSetup && tab === "overview" && !showDashboardView;
  // The redesigned page's look (white background, header, tabs, page edges)
  // holds on every tab, not just Setup (set in review).
  const showRedesignedChrome = useRedesignedSetup && !showDashboardView;
  // The Results, Dashboards and Health tabs' wrappers. On a redesigned
  // experiment they take Setup's page spacing (set in review): 24px above
  // the content, as Setup's main column has, 32px on both sides, 32px at the
  // bottom, and no max width, so they line up with the header and tabs.
  // Elsewhere, unchanged (pt-0 is Bootstrap's !important, so it's left off
  // the redesigned version for the inline padding to apply).
  const tabWrapper = (active: boolean) =>
    !active
      ? { className: "d-none d-print-block" }
      : showRedesignedChrome
        ? {
            // redesigned-tab-cards: see the card outline rule in the style
            // block below.
            className:
              "container-fluid pagecontents d-block redesigned-tab-cards",
            style: {
              padding: "var(--space-5) var(--space-6) var(--space-6)",
              maxWidth: "none",
            },
          }
        : { className: "container-fluid pagecontents d-block pt-0" };

  const showStoppedBanner =
    experiment.status === "stopped" && tab !== "dashboards";

  return (
    <PreLaunchChecklistProvider
      experiment={experiment}
      linkedFeatures={linkedFeatures}
      visualChangesets={visualChangesets}
      urlRedirects={urlRedirects}
      connections={connections}
      mutateExperiment={mutate}
      editTargeting={editTargeting}
      envs={envs}
    >
      {/* Page-wide overrides for the redesigned Setup tab, set in review.
        White page background:
        Repoints the app's page-background token rather than painting one
        element, so everything that matches the page (the tab bar, the sticky
        Save footer) turns white with it. --color-panel-solid is white in light
        mode and the dark panel colour in dark mode. The tripled class beats
        radix-config.css's `.light-theme .radix-themes` regardless of load
        order. Mounted on every tab of a redesigned experiment, so the page
        looks the same whichever tab is open (set in review). */}
      {showRedesignedChrome ? (
        <style jsx global>{`
          .radix-themes.radix-themes.radix-themes {
            --color-background: var(--color-panel-solid);
          }
          /* The tab bar's pinned top follows the sticky title row's height
            (--experiment-tabs-top); here it eases over the same 120ms as the
            title row rather than the bar's general 150ms, so the two move
            together. Instant for reduced motion. */
          /* !important: global.scss's "transition: 150ms all" on the tab
            bar is more specific, and at 150ms the bar lagged the 120ms
            title row, opening a gap between them (fixed in review). */
          .experiment-tabs.experiment-tabs {
            transition: top 120ms ease !important;
          }
          /* No shadow under the top nav on this tab, even once scrolled: the
            sticky title row sits right under it, so the shadow only showed
            as a line above the row (set in review). */
          [data-topbar][data-topbar] {
            box-shadow: none !important;
          }
          @media (prefers-reduced-motion: reduce) {
            .experiment-tabs.experiment-tabs {
              transition: none !important;
            }
          }
          /* Select menus (@/ui/Select) and the metric pickers' and other
            react-select menus take @/ui/Toast's softer shadow on this tab,
            in place of Radix's --shadow-5 and react-select's own (set in
            review). They open outside the page, so this is here, where it
            applies only while the Setup tab shows. */
          .rt-SelectContent.rt-SelectContent,
          .gb-multi-select__menu.gb-multi-select__menu,
          .gb-select__menu.gb-select__menu {
            box-shadow:
              0 1px 2px var(--black-a2),
              0 4px 8px -2px var(--black-a3) !important;
          }
          /* The Results, Dashboards and Health tabs' cards (.appbox, and
            .box, its older twin that e.g. the Traffic card uses; nested ones
            too) take the Setup page's card outline, --gray-a5, instead
            of .appbox's --slate-a3 (set in review). Scoped to those tabs'
            wrappers on a redesigned experiment; .appbox itself is
            unchanged everywhere else. Doubled class to outrank .appbox's
            nested rule. A dashboard block being edited or focused keeps
            its violet outline (.border-violet). */
          .redesigned-tab-cards.redesigned-tab-cards
            .appbox:not(.border-violet),
          .redesigned-tab-cards.redesigned-tab-cards .box {
            border-color: var(--gray-a5);
          }
          /* Breadcrumb lines up with the page's 32px left edge. Above 520px
            only: below that the top bar drops to 8px for small screens, and
            that's left alone. */
          @media (min-width: 521px) {
            [data-topbar][data-topbar] {
              padding-left: var(--space-6);
            }
          }
        `}</style>
      ) : null}
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
          cta="Open AI Visual Editor"
          source={trackSource}
        />
      )}
      {urlRedirectModal && (
        <UrlRedirectModal
          mode="add"
          experiment={experiment}
          mutate={mutate}
          close={() => setUrlRedirectModal(false)}
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
        setupRailCollapsed={setupRailCollapsed}
        setSetupRailCollapsed={setSetupRailCollapsed}
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
        editTags={editTags}
        newPhase={newPhase}
        editPhases={editPhases}
        healthNotificationCount={healthNotificationCount}
        linkedFeatures={linkedFeatures}
        visualChangesets={visualChangesets}
        urlRedirects={urlRedirects}
        showDashboardView={showDashboardView}
        safeToEdit={safeToEdit}
        editSchedule={editSchedule}
      />

      <div
        className={clsx(
          "container-fluid pagecontents",
          showDashboardView && "pt-0",
        )}
        // The redesigned Setup tab uses the design's page padding instead of
        // the shared 15px from `.main > .container-fluid` in global.scss:
        // 32px left, on the Radix scale. No top padding, so the rail meets the
        // tab divider (the main column supplies its own 24px top gap). No right
        // padding and no max width, so the rail sits flush with the page's
        // right edge; the main column keeps its own 32px before the rail. The
        // header matches (see setupLayout in ExperimentHeader.tsx). Other tabs
        // are unchanged.
        //
        // The other tabs of a redesigned experiment take the same 32px left
        // edge, and 32px on the right too (they have no rail), with no max
        // width, so their content lines up with the header and tabs above
        // (set in review).
        style={
          showRedesignedSetup
            ? {
                paddingTop: 0,
                paddingLeft: "var(--space-6)",
                paddingRight: 0,
                // No bottom padding either, so the rail runs to the bottom
                // of the page.
                paddingBottom: 0,
                maxWidth: "none",
              }
            : showRedesignedChrome
              ? {
                  // Only banners on these tabs, and usually none: no
                  // vertical padding, so it adds no space of its own. The
                  // tab's own wrapper below supplies the 24px top gap.
                  paddingTop: 0,
                  paddingBottom: 0,
                  paddingLeft: "var(--space-6)",
                  paddingRight: "var(--space-6)",
                  maxWidth: "none",
                }
              : undefined
        }
      >
        {experiment.type !== "holdout" &&
          tab !== "dashboards" &&
          !showDashboardView && (
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
            // The page padding already supplies the top gap on the
            // redesigned tab.
            !useRedesignedSetup && "pt-3",
            tab === "overview" && !showDashboardView
              ? "d-block"
              : "d-none d-print-block",
          )}
        >
          {useRedesignedSetup ? (
            <SetupPage
              railCollapsed={setupRailCollapsed}
              experiment={experiment}
              mutate={mutate}
              disableEditing={viewingOldPhase}
              visualChangesets={visualChangesets}
              urlRedirects={urlRedirects}
              linkedFeatures={linkedFeatures}
              envs={envs}
              visualChangesetEnvStates={visualChangesetEnvStates}
              urlRedirectEnvStates={urlRedirectEnvStates}
              editTargeting={editTargeting}
              editTraffic={editTraffic}
              addVariation={addVariation}
              editNamespace={editNamespace}
              editVariations={editVariations}
              setFeatureModal={setFeatureModal}
              setVisualEditorModal={setVisualEditorModal}
              setUrlRedirectModal={setUrlRedirectModal}
            />
          ) : (
            <>
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
                holdout={holdout}
                holdoutFeatures={holdoutFeatures}
                holdoutExperiments={holdoutExperiments}
                mutate={mutate}
                editVariations={editVariations}
                setFeatureModal={setFeatureModal}
                setVisualEditorModal={setVisualEditorModal}
                setUrlRedirectModal={setUrlRedirectModal}
                visualChangesets={visualChangesets}
                urlRedirects={urlRedirects}
                editTargeting={editTargeting}
                editTraffic={editTraffic}
                addVariation={addVariation}
                editNamespace={editNamespace}
                linkedFeatures={linkedFeatures}
                envs={envs}
                visualChangesetEnvStates={visualChangesetEnvStates}
                urlRedirectEnvStates={urlRedirectEnvStates}
              />
            </>
          )}
          {experiment.status !== "draft" && !useRedesignedSetup && (
            <div className="mt-3 mb-2 text-center d-print-none">
              <Button
                onClick={() => setTabAndScroll("results")}
                size="lg"
                icon={<FaChartBar />}
              >
                View Results
              </Button>
            </div>
          )}
        </div>
        {isBandit && !showDashboardView ? (
          <div
            className={
              // todo: standardize explore & results tabs across experiment types
              isBandit && tab === "results"
                ? "container-fluid pagecontents d-block pt-0"
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
        // todo: standardize explore & results tabs across experiment types
        {...tabWrapper(
          ((!isBandit && tab === "results") ||
            (isBandit && tab === "explore")) &&
            !showDashboardView,
        )}
      >
        {showMetricGroupPromo() ? (
          <PremiumCallout
            commercialFeature="metric-groups"
            dismissible={true}
            id="metrics-list-metric-group-promo"
            docSection="metricGroups"
            mb="2"
          >
            <strong>Metric Groups</strong> help you organize and manage your
            metrics at scale.
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
      <div {...tabWrapper(tab === "dashboards" && !showDashboardView)}>
        <DashboardsTab
          experiment={experiment}
          initialDashboardId={tabPath}
          isTabActive={tab === "dashboards"}
          mutateExperiment={mutate}
          updateTabPath={persistTabPath}
        />
      </div>
      <div {...tabWrapper(tab === "health" && !showDashboardView)}>
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

      {/* Not on the redesigned page's Setup, Results or Health tabs (the
        last two set in review): comments live in the Setup tab's right
        rail. */}
      {tab !== "dashboards" &&
        !showDashboardView &&
        !(
          useRedesignedSetup &&
          (tab === "overview" || tab === "results" || tab === "health")
        ) && (
          <div className="mt-4 px-4 border-top pb-3">
            <div className="pt-2 pt-4 pb-5 container pagecontents">
              <div className="h3 mb-4">Comments</div>
              <DiscussionThread
                type="experiment"
                id={experiment.id}
                allowNewComments={!experiment.archived}
                projects={experiment.project ? [experiment.project] : []}
              />
            </div>
          </div>
        )}
    </PreLaunchChecklistProvider>
  );
}
