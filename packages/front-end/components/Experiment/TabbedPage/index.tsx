import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { includeExperimentInPayload, isDefined } from "shared/util";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useRouter } from "next/router";
import { DifferenceType } from "back-end/types/stats";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import { FaChartBar } from "react-icons/fa";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { FeatureInterface } from "back-end/types/feature";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeatureFromExperimentModal from "@/components/Features/FeatureModal/FeatureFromExperimentModal";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import {
  getBrowserDevice,
  openVisualEditor,
} from "@/components/OpenVisualEditorLink";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import DiscussionThread from "@/components/DiscussionThread";
import { useAuth } from "@/services/auth";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import { phaseSummary } from "@/services/utils";
import EditStatusModal from "@/components/Experiment/EditStatusModal";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import { ResultsMetricFilters } from "@/components/Experiment/Results";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import BanditSummaryResultsTab from "@/components/Experiment/TabbedPage/BanditSummaryResultsTab";
import Button from "@/components/Radix/Button";
import PremiumCallout from "@/components/Radix/PremiumCallout";
import { useDefinitions } from "@/services/DefinitionsContext";
import DashboardsTab from "@/enterprise/components/Dashboards/DashboardsTab";
import ExperimentHeader from "./ExperimentHeader";
import SetupTabOverview from "./SetupTabOverview";
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
  holdout?: HoldoutInterface;
  linkedFeatures: LinkedFeatureInfo[];
  holdoutFeatures?: FeatureInterface[];
  holdoutExperiments?: ExperimentInterfaceStringDates[];
  mutate: () => void;
  duplicate?: (() => void) | null;
  editTags?: (() => void) | null;
  checklistItemsRemaining: number | null;
  envs: string[];
  setChecklistItemsRemaining: (value: number | null) => void;
  editVariations?: (() => void) | null;
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  newPhase?: (() => void) | null;
  editPhases?: (() => void) | null;
  editPhase?: ((i: number | null) => void) | null;
  editTargeting?: (() => void) | null;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  stop?: (() => void) | null;
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
  editPhases,
  editTargeting,
  newPhase,
  editMetrics,
  editResult,
  checklistItemsRemaining,
  setChecklistItemsRemaining,
  stop,
}: Props) {
  const growthbook = useGrowthBook();
  const dashboardsEnabled = growthbook.isOn("experiment-dashboards-enabled");
  const [tab, setTab] = useLocalStorage<ExperimentTab>(
    `tabbedPageTab__${experiment.id}`,
    "overview",
  );
  const [tabPath, setTabPath] = useState("");

  const router = useRouter();

  const { apiCall } = useAuth();

  const [auditModal, setAuditModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [watchersModal, setWatchersModal] = useState(false);
  const [visualEditorModal, setVisualEditorModal] = useState(false);
  const [featureModal, setFeatureModal] = useState(false);
  const [urlRedirectModal, setUrlRedirectModal] = useState(false);
  const [healthNotificationCount, setHealthNotificationCount] = useState(0);

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
  const [metricFilter, setMetricFilter] = useLocalStorage<ResultsMetricFilters>(
    `experiment-page__${experiment.id}__metric_filter`,
    {
      tagOrder: [],
      filterByTag: false,
    },
  );

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace(/^#/, "") as ExperimentTab;
      let [tabName, ...tabPathSegments] = hash.split("/") as [
        ExperimentTabName,
        ...string[],
      ];
      if (experimentTabs.includes(tabName)) {
        if (tabName === "dashboards" && !dashboardsEnabled) {
          tabName = "overview";
          tabPathSegments = [];
        }
        const tabPath = tabPathSegments.join("/");
        setTab(tabName);
        setTabPath(tabPath);
        // Drop the tab path from the URL after reading it into state
      }
      window.history.replaceState({}, "", `#${tabName}`);
    };
    handler();
    window.addEventListener("hashchange", handler, false);
    return () => window.removeEventListener("hashchange", handler, false);
  }, [setTab, dashboardsEnabled]);

  const { phase, setPhase } = useSnapshot();
  const { metricGroups } = useDefinitions();

  const variables = {
    experiment: experiment.name,
    tags: experiment.tags,
    experimentStatus: experiment.status,
  };

  const viewingOldPhase =
    experiment.phases.length > 0 && phase < experiment.phases.length - 1;

  const setTabAndScroll = (tab: ExperimentTab) => {
    setTab(tab);
    const newUrl = window.location.href.replace(/#.*/, "") + "#" + tab;
    if (newUrl === window.location.href) return;
    window.history.pushState("", "", newUrl);
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleIncrementHealthNotifications = useCallback(() => {
    setHealthNotificationCount((prev) => prev + 1);
  }, []);

  const handleSnapshotChange = useCallback(() => {
    // Reset notifications when snapshot changes and the health tab needs to re-render
    setHealthNotificationCount(0);
  }, []);

  const hasLiveLinkedChanges = includeExperimentInPayload(
    experiment,
    linkedFeatures.map((f) => f.feature),
  );

  const { data: sdkConnectionsData } = useSDKConnections();
  const connections = sdkConnectionsData?.connections || [];

  const projectConnections = connections.filter(
    (connection) =>
      !connection.projects.length ||
      connection.projects.includes(experiment.project || ""),
  );
  const matchingConnections = projectConnections.filter(
    (connection) =>
      !visualChangesets.length || connection.includeVisualExperiments,
  );

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

  const safeToEdit = experiment.status !== "running" || !hasLiveLinkedChanges;

  const isBandit = experiment.type === "multi-armed-bandit";
  const trackSource = "tabbed-page";

  const showMetricGroupPromo = (): boolean => {
    if (metricGroups.length) return false;

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

  return (
    <>
      {auditModal && (
        <Modal
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
          closeCta="Close"
        >
          <HistoryTable type="experiment" id={experiment.id} />
        </Modal>
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
        safeToEdit={safeToEdit}
        setAuditModal={setAuditModal}
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
        checklistItemsRemaining={checklistItemsRemaining}
        linkedFeatures={linkedFeatures}
        stop={stop}
      />

      <div className="container-fluid pagecontents">
        {experiment.project ===
          getDemoDatasourceProjectIdForOrganization(organization.id) && (
          <div className="alert alert-info d-flex align-items-center mb-0 mt-2">
            <div className="flex-1">
              This experiment is part of our sample dataset. You can safely
              delete this once you are done exploring.
            </div>
            <div style={{ width: 180 }} className="ml-2">
              <DeleteDemoDatasourceButton
                onDelete={() => router.push("/experiments")}
                source="experiment"
              />
            </div>
          </div>
        )}
        {experiment.type !== "holdout" && (
          <CustomMarkdown page={"experiment"} variables={variables} />
        )}
        {experiment.status === "stopped" && (
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
            <div className="alert alert-warning mt-3">
              <div>
                {isHoldout
                  ? "You are viewing the results of the entire holdout period."
                  : "You are viewing the results of a previous experiment phase."}{" "}
                <a
                  role="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setPhase(experiment.phases.length - 1);
                  }}
                >
                  {isHoldout
                    ? "Switch to the analysis period to view results with a lookback based on the analysis period start date."
                    : "Switch to the latest phase"}
                </a>
              </div>
              {!isHoldout && (
                <div className="mt-1">
                  <strong>Phase settings:</strong>{" "}
                  {phaseSummary(experiment?.phases?.[phase])}
                </div>
              )}
            </div>
          )}
        <div
          className={clsx(
            "pt-3",
            tab === "overview" ? "d-block" : "d-none d-print-block",
          )}
        >
          <SetupTabOverview
            experiment={experiment}
            holdout={holdout}
            holdoutExperiments={holdoutExperiments}
            mutate={mutate}
            disableEditing={viewingOldPhase}
            linkedFeatures={linkedFeatures}
            visualChangesets={visualChangesets}
            editTargeting={editTargeting}
            matchingConnections={matchingConnections}
            checklistItemsRemaining={checklistItemsRemaining}
            setChecklistItemsRemaining={setChecklistItemsRemaining}
            envs={envs}
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
            linkedFeatures={linkedFeatures}
            envs={envs}
          />
          {experiment.status !== "draft" && (
            <div className="mt-3 mb-2 text-center d-print-none">
              <Button
                onClick={() => setTabAndScroll("results")}
                size="md"
                icon={<FaChartBar />}
              >
                View Results
              </Button>
            </div>
          )}
        </div>
        {isBandit ? (
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
        className={
          // todo: standardize explore & results tabs across experiment types
          (!isBandit && tab === "results") || (isBandit && tab === "explore")
            ? "container-fluid pagecontents d-block pt-0"
            : "d-none d-print-block"
        }
      >
        {showMetricGroupPromo() ? (
          <PremiumCallout
            commercialFeature="metric-groups"
            dismissable={true}
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
          editPhases={editPhases}
          editResult={editResult}
          newPhase={newPhase}
          connections={connections}
          envs={envs}
          setTab={setTabAndScroll}
          visualChangesets={visualChangesets}
          editTargeting={editTargeting}
          isTabActive={tab === "results"}
          safeToEdit={safeToEdit}
          metricFilter={metricFilter}
          analysisBarSettings={analysisBarSettings}
          setAnalysisBarSettings={setAnalysisBarSettings}
          setMetricFilter={setMetricFilter}
        />
      </div>
      <div
        className={
          tab === "dashboards"
            ? "container-fluid pagecontents d-block pt-0"
            : "d-none d-print-block"
        }
      >
        <DashboardsTab
          experiment={experiment}
          initialDashboardId={tabPath}
          isTabActive={tab === "dashboards"}
        />
      </div>
      <div
        className={
          tab === "health"
            ? "container-fluid pagecontents d-block pt-0"
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

      {tab !== "dashboards" && (
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
    </>
  );
}
