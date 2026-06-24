import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FactTableColumnType } from "shared/types/fact-table";
import { getScopedSettings } from "shared/settings";
import {
  isDimensionPrecomputed,
  getEffectiveLookbackOverride,
} from "shared/experiments";
import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  ExperimentSnapshotReportArgs,
  ExperimentSnapshotReportInterface,
  ReportInterface,
} from "shared/types/report";
import {
  ExperimentSnapshotInterface,
  SnapshotHistoryEntry,
} from "shared/types/experiment-snapshot";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import NextLink from "next/link";
import { useRouter } from "next/router";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { Box, Flex, Text } from "@radix-ui/themes";
import { date, datetime } from "shared/dates";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { PiLink, PiCheck } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Results, { AnalysisBarSettings } from "@/components/Experiment/Results";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import ExperimentReportsList from "@/components/Experiment/ExperimentReportsList";
import {
  LocalSnapshotProvider,
  useSnapshot,
} from "@/components/Experiment/SnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useApi from "@/hooks/useApi";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";
import { getHonoredPrecomputedUnitDimensionIds } from "@/services/experiments";
import LinkButton from "@/ui/LinkButton";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import track from "@/services/track";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import AnalysisSettingsSummary from "./AnalysisSettingsSummary";
import { ExperimentTab } from ".";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editMetrics?: (() => void) | null;
  editResult?: (() => void) | null;
  newPhase?: (() => void) | null;
  visualChangesets: VisualChangesetInterface[];
  editTargeting?: (() => void) | null;
  envs: string[];
  setTab: (tab: ExperimentTab) => void;
  connections: SDKConnectionInterface[];
  isTabActive: boolean;
  metricTagFilter: string[];
  setMetricTagFilter: (tags: string[]) => void;
  metricsFilter: string[];
  setMetricsFilter: (filters: string[]) => void;
  availableMetricsFilters: {
    groups: Array<{ id: string; name: string }>;
    metrics: Array<{ id: string; name: string }>;
  };
  availableMetricTags: string[];
  availableSliceTags: Array<{
    id: string;
    datatypes: Record<string, FactTableColumnType>;
    isSelectAll?: boolean;
  }>;
  sliceTagsFilter: string[];
  setSliceTagsFilter: (tags: string[]) => void;
  analysisBarSettings: AnalysisBarSettings;
  setAnalysisBarSettings: (
    s:
      | AnalysisBarSettings
      | ((prev: AnalysisBarSettings) => AnalysisBarSettings),
  ) => void;
  sortBy: "significance" | "change" | null;
  setSortBy: (s: "significance" | "change" | null) => void;
  sortDirection: "asc" | "desc" | null;
  setSortDirection: (d: "asc" | "desc" | null) => void;
}

// map URL hash → view. Defaults to "official" with a pin, "latest" otherwise.
// Uses #results/<sub-view> so the parent TabbedPage routes to the Results tab on cold load.
function viewFromHash(hash: string, hasPin: boolean): "official" | "latest" {
  if (hash === "#results/latest-results") return "latest";
  if (hash === "#results/official-results" && hasPin) return "official";
  return hasPin ? "official" : "latest";
}

// outer wrapper for Official readout pinning. Fetches the pinned report
// and its snapshot, then wraps the body in LocalSnapshotProvider when the user
// is on the "Official readout" tab. The default SnapshotProvider from the parent
// page still serves the latest snapshot when on "Latest results".
export default function ResultsTab(props: Props) {
  const { experiment } = props;
  const pinnedReportId = experiment.pinnedReportId;
  const hasPin = !!pinnedReportId;
  const router = useRouter();

  // seed view from URL hash for deep linking
  const [view, setViewState] = useState<"official" | "latest">(() =>
    viewFromHash(
      typeof window !== "undefined" ? window.location.hash : "",
      hasPin,
    ),
  );

  // sync view on back/forward navigation
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () =>
      setViewState(viewFromHash(window.location.hash, hasPin));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [hasPin]);

  // if the hash asks for official but there's no pin, drop the sub-path
  // so the URL matches what's actually rendered (Latest results)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hasPin && window.location.hash === "#results/official-results") {
      router.replace(
        `${window.location.pathname}${window.location.search}#results`,
        undefined,
        { shallow: true },
      );
    }
  }, [hasPin, router]);

  // setView also writes the hash so the URL stays shareable
  const setView = useCallback(
    (newView: "official" | "latest") => {
      setViewState(newView);
      if (typeof window === "undefined") return;
      const targetHash =
        newView === "official"
          ? "#results/official-results"
          : "#results/latest-results";
      if (window.location.hash !== targetHash) {
        const newUrl = `${window.location.pathname}${window.location.search}${targetHash}`;
        router.replace(newUrl, undefined, { shallow: true });
      }
    },
    [router],
  );

  const { data: pinnedReportData } = useApi<{ report: ReportInterface }>(
    `/report/${pinnedReportId}`,
    { shouldRun: () => hasPin },
  );
  const pinnedReport =
    pinnedReportData?.report?.type === "experiment-snapshot"
      ? pinnedReportData.report
      : undefined;

  // load the snapshot from experiment.pinnedSnapshotId — frozen at pin
  // time — so the official view doesn't follow report edits/refreshes. Fall back
  // to the report's current snapshot for legacy pins that pre-date the field.
  const pinnedSnapshotId =
    experiment.pinnedSnapshotId || pinnedReport?.snapshot;
  const { data: pinnedSnapshotData } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/snapshot/${pinnedSnapshotId}`, {
    shouldRun: () => !!pinnedSnapshotId,
  });
  const pinnedSnapshot = pinnedSnapshotData?.snapshot;

  // "view a past snapshot" (decoupled from pinning). Reads the parent
  // provider's current phase/dimension + latest snapshot, lists past snapshots,
  // and — when the user browses to an older one — loads it into a
  // LocalSnapshotProvider so the whole results view reflects that snapshot
  // (without committing). Only active when nothing is pinned; once pinned, the
  // existing Official/Latest toggle takes over.
  const parentSnapshotCtx = useSnapshot();
  const currentPhase = parentSnapshotCtx.phase;
  const currentDimension = parentSnapshotCtx.dimension;
  const latestSnapshotId = parentSnapshotCtx.snapshot?.id;

  const { data: historyData, mutate: mutateHistory } = useApi<{
    snapshots: SnapshotHistoryEntry[];
  }>(
    `/experiment/${experiment.id}/snapshot-history/${currentPhase}` +
      (currentDimension ? `?dimension=${currentDimension}` : ""),
    { shouldRun: () => !hasPin },
  );
  const snapshotHistory = useMemo(
    () => historyData?.snapshots ?? [],
    [historyData],
  );

  // refetch the history when a new snapshot becomes the latest, so the
  // dropdown's value always has a matching option. Otherwise it renders blank
  // until the cached list reloads on its own, which can take 30-45s+ after a refresh.
  useEffect(() => {
    if (latestSnapshotId) mutateHistory();
  }, [latestSnapshotId, mutateHistory]);

  const [previewSnapshotId, setPreviewSnapshotId] = useState<string | null>(
    null,
  );
  const { data: previewSnapshotData } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/snapshot/${previewSnapshotId}`, {
    shouldRun: () => !!previewSnapshotId,
  });
  const previewSnapshot = previewSnapshotData?.snapshot;
  const previewActive = !hasPin && !!previewSnapshotId && !!previewSnapshot;

  // Select a specific snapshot to preview by id. The latest snapshot maps to
  // null so we fall back to the live view rather than a frozen copy of it.
  const selectPreviewSnapshot = useCallback(
    (snapshotId: string) => {
      setPreviewSnapshotId(snapshotId === latestSnapshotId ? null : snapshotId);
    },
    [latestSnapshotId],
  );
  const clearPreview = useCallback(() => setPreviewSnapshotId(null), []);

  // a previewed snapshot is specific to a phase+dimension, so drop it
  // when the user switches either — otherwise the view would keep rendering a
  // snapshot from a different slice than the one now selected.
  useEffect(() => {
    setPreviewSnapshotId(null);
  }, [currentPhase, currentDimension]);

  const isOfficialView = hasPin && view === "official";

  // The snapshot whose frozen metric arrays the view should reflect: the pinned
  // one on the Official view, or the previewed one while browsing a past date.
  const frozenSnapshot =
    isOfficialView && pinnedSnapshot
      ? pinnedSnapshot
      : previewActive && previewSnapshot
        ? previewSnapshot
        : null;

  // Swap the experiment's current metric arrays for the frozen snapshot's so the
  // row list matches the data. Without this, an out-of-band metric sync that
  // adds/removes metrics on the experiment after the snapshot ran can leave the
  // view rendering "No data" rows or silently dropping metrics.
  const effectiveExperiment = frozenSnapshot
    ? {
        ...experiment,
        goalMetrics: frozenSnapshot.settings.goalMetrics,
        secondaryMetrics: frozenSnapshot.settings.secondaryMetrics,
        guardrailMetrics: frozenSnapshot.settings.guardrailMetrics,
      }
    : experiment;

  const body = (
    <ResultsTabBody
      {...props}
      experiment={effectiveExperiment}
      hasPin={hasPin}
      view={view}
      setView={setView}
      pinnedReport={pinnedReport}
      pinnedSnapshotLoading={hasPin && !!pinnedSnapshotId && !pinnedSnapshot}
      snapshotHistory={snapshotHistory}
      previewActive={previewActive}
      selectPreviewSnapshot={selectPreviewSnapshot}
      clearPreview={clearPreview}
    />
  );

  // Render the chosen snapshot (pinned or previewed) via LocalSnapshotProvider.
  if (frozenSnapshot) {
    const phase =
      typeof frozenSnapshot.phase === "number"
        ? frozenSnapshot.phase
        : Math.max(0, (experiment.phases?.length ?? 1) - 1);
    return (
      <LocalSnapshotProvider
        experiment={effectiveExperiment}
        snapshot={frozenSnapshot}
        phase={phase}
        dimension={frozenSnapshot.dimension || ""}
      >
        {body}
      </LocalSnapshotProvider>
    );
  }

  return body;
}

// tabbed toggle between the pinned official results and latest results
function OfficialReadoutToggle({
  view,
  setView,
}: {
  view: "official" | "latest";
  setView: (v: "official" | "latest") => void;
}) {
  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v as "official" | "latest")}
    >
      <TabsList mb="3">
        <TabsTrigger value="official">
          <Tooltip body="A frozen snapshot of the experiment's results. The numbers and analysis settings don't change when the experiment refreshes.">
            <span>
              <span role="img" aria-label="pinned" style={{ marginRight: 6 }}>
                📌
              </span>
              Official results
            </span>
          </Tooltip>
        </TabsTrigger>
        <TabsTrigger value="latest">
          <Tooltip body="Live experiment results that get updated with each refresh.">
            <span>Latest results</span>
          </Tooltip>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// green "pinned" banner with provenance + actions for the official readout
function OfficialReadoutBanner({
  pinnedReport,
  pinnedSnapshot,
  experimentId,
  pinnedBy,
  pinnedAt,
  onUnpin,
  canManage,
}: {
  pinnedReport: ExperimentSnapshotReportInterface;
  pinnedSnapshot?: ExperimentSnapshotInterface;
  experimentId: string;
  pinnedBy?: string;
  pinnedAt?: string | Date;
  onUnpin: () => Promise<void> | void;
  canManage: boolean;
}) {
  const { getUserDisplay } = useUser();
  const resolvedPinnedById = pinnedBy || pinnedReport.userId;
  const pinnedByName = resolvedPinnedById
    ? getUserDisplay(resolvedPinnedById, false)
    : null;
  const resolvedPinnedAt = pinnedAt || pinnedReport.dateUpdated;

  // prefer the snapshot's actual analysis window over the experiment
  // phase dates.
  const snapshotStart = pinnedSnapshot?.settings?.startDate;
  const snapshotEnd = pinnedSnapshot?.settings?.endDate;
  const phaseStart = pinnedReport.experimentMetadata?.phases?.[0]?.dateStarted;
  const phaseEnd =
    pinnedReport.experimentMetadata?.phases?.[
      (pinnedReport.experimentMetadata?.phases?.length ?? 1) - 1
    ]?.dateEnded;
  const rangeStart = snapshotStart ?? phaseStart;
  const rangeEnd = snapshotEnd ?? phaseEnd;
  const dateRange = rangeStart
    ? rangeEnd
      ? `${date(rangeStart)} – ${date(rangeEnd)}`
      : `Since ${date(rangeStart)}`
    : "";

  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 1500 });
  const copyShareableLink = () => {
    if (typeof window === "undefined") return;
    performCopy(
      `${window.location.origin}/experiment/${experimentId}#results/official-results`,
    );
  };

  return (
    <Callout status="success" mb="3" contentsAs="div">
      <Flex justify="between" align="start" gap="3">
        <Box>
          <Text as="div" weight="bold">
            Official results
          </Text>
          {dateRange ? (
            <Text as="div" size="2" color="gray">
              Analysis window:{" "}
              <Text
                as="span"
                weight="medium"
                style={{ color: "var(--gray-12)" }}
              >
                {dateRange}
              </Text>
            </Text>
          ) : null}
          <Text
            as="div"
            size="1"
            color="gray"
            style={{ fontSize: 11, marginTop: 2 }}
          >
            {pinnedByName ? `Pinned by ${pinnedByName} on ` : "Pinned on "}
            {date(resolvedPinnedAt)}
          </Text>
        </Box>
        <Flex gap="3" align="center" style={{ alignSelf: "center" }}>
          <Tooltip body="Open the underlying report page for editing, sharing, or seeing the full report metadata.">
            <LinkButton variant="outline" href={`/report/${pinnedReport.id}`}>
              Open report
            </LinkButton>
          </Tooltip>
          <Tooltip
            body={
              copySuccess
                ? "Copied"
                : "Copy a shareable link that opens this experiment on the Official results view."
            }
          >
            <Button
              variant="ghost"
              onClick={copyShareableLink}
              icon={copySuccess ? <PiCheck /> : <PiLink />}
            >
              {copySuccess ? "Copied" : "Copy link"}
            </Button>
          </Tooltip>
          {canManage ? (
            <Button variant="ghost" color="gray" onClick={onUnpin}>
              Remove official results
            </Button>
          ) : null}
        </Flex>
      </Flex>
    </Callout>
  );
}

type ResultsTabBodyProps = Props & {
  // props threaded from the outer wrapper for the pinning feature
  hasPin: boolean;
  view: "official" | "latest";
  setView: (v: "official" | "latest") => void;
  pinnedReport?: ExperimentSnapshotReportInterface;
  pinnedSnapshotLoading: boolean;
  // "view a past snapshot" controls
  snapshotHistory: SnapshotHistoryEntry[];
  previewActive: boolean;
  selectPreviewSnapshot: (snapshotId: string) => void;
  clearPreview: () => void;
};

function ResultsTabBody({
  experiment,
  envs,
  mutate,
  editMetrics,
  editResult,
  setTab,
  isTabActive,
  analysisBarSettings,
  setAnalysisBarSettings,
  metricTagFilter,
  setMetricTagFilter,
  metricsFilter,
  setMetricsFilter,
  availableMetricsFilters,
  availableMetricTags,
  availableSliceTags,
  sliceTagsFilter,
  setSliceTagsFilter,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
  hasPin,
  view,
  setView,
  pinnedReport,
  pinnedSnapshotLoading,
  snapshotHistory,
  previewActive,
  selectPreviewSnapshot,
  clearPreview,
}: ResultsTabBodyProps) {
  const {
    getDatasourceById,
    getExperimentMetricById,
    getProjectById,
    metrics: _metrics,
    datasources,
    getSegmentById,
  } = useDefinitions();

  const { apiCall } = useAuth();

  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);

  const router = useRouter();

  const { snapshot, analysis, setSnapshotType, setAnalysisSettings } =
    useSnapshot();

  const permissionsUtil = usePermissionsUtil();
  const { organization, hasCommercialFeature } = useUser();
  const project = getProjectById(experiment.project || "");
  const isDemoExperiment =
    !!experiment.project &&
    experiment.project ===
      getDemoDatasourceProjectIdForOrganization(organization.id);
  const honoredPrecomputedUnitDimensionIds =
    getHonoredPrecomputedUnitDimensionIds(
      experiment.precomputedUnitDimensionIds,
      experiment.datasource
        ? getDatasourceById(experiment.datasource)
        : undefined,
      hasCommercialFeature("pipeline-mode"),
    );

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment: experiment,
  });

  const statsEngine = scopedSettings.statsEngine.value;

  const segment = getSegmentById(experiment.segment || "");

  const activationMetric = getExperimentMetricById(
    experiment.activationMetric || "",
  );

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const hasValidStatsEngine =
    !analysis?.settings ||
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const hasResults =
    experiment.status !== "draft" &&
    hasData &&
    hasValidStatsEngine &&
    snapshot &&
    analysis?.results?.[0];

  const isBandit = experiment.type === "multi-armed-bandit";

  const datasourceSettings = experiment.datasource
    ? getDatasourceById(experiment.datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  )?.userIdType;

  const reportArgs: ExperimentSnapshotReportArgs = useMemo(
    () => ({
      userIdType: userIdType as "user" | "anonymous" | undefined,
      differenceType: analysisBarSettings.differenceType,
      dimension: analysisBarSettings.dimension,
    }),
    [
      userIdType,
      analysisBarSettings.differenceType,
      analysisBarSettings.dimension,
    ],
  );

  // derived state + callbacks for the official-readout pin feature
  const isOfficialView = hasPin && view === "official";
  const canManagePin = permissionsUtil.canUpdateExperiment(experiment, {});

  // pins whatever snapshot is currently being viewed as the official
  // readout. `isPast` = the view is a previewed past snapshot (not the latest).
  const saveAsOfficialReadout = useCallback(
    async (isPast: boolean) => {
      const targetSnapshotId = snapshot?.id;
      if (!targetSnapshotId) return;
      // self-describing title — a past pin is dated by its window end,
      // a live pin by today.
      const windowEnd = snapshot?.settings?.endDate;
      const officialTitle =
        isPast && windowEnd
          ? `Official results — ${date(windowEnd)}`
          : `Official results — ${date(new Date())}`;
      // for a *past* snapshot, the live analysis bar's differenceType
      // may not have been computed back then. Omit it so postReportFromSnapshot
      // falls back to the snapshot's default analysis (no upstream change
      // needed). The live-snapshot path keeps its differenceType as before.
      const body = isPast
        ? { ...reportArgs, differenceType: undefined, title: officialTitle }
        : { ...reportArgs, title: officialTitle };
      const res = await apiCall<{ report: ReportInterface }>(
        `/experiments/report/${targetSnapshotId}`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      if (!res.report) throw new Error("Failed to create report");
      await apiCall(`/experiment/${experiment.id}`, {
        method: "POST",
        body: JSON.stringify({ pinnedReportId: res.report.id }),
      });
      track("Experiment Official Readout: Save", {
        source: isPast
          ? "experiment results tab (past snapshot)"
          : "experiment results tab",
      });
      clearPreview();
      mutate();
      setView("official");
    },
    [
      apiCall,
      experiment.id,
      mutate,
      reportArgs,
      setView,
      snapshot,
      clearPreview,
    ],
  );

  const unpinOfficialReadout = useCallback(async () => {
    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify({ pinnedReportId: "" }),
    });
    track("Experiment Official Readout: Unpin", {
      source: "experiment results tab",
    });
    mutate();
    setView("latest");
  }, [apiCall, experiment.id, mutate, setView]);
  // error from the save-as-official button, rendered as a Callout
  const [saveError, setSaveError] = useState<string | null>(null);

  const onSnapshotSuccessfulUpdate = useCallback(() => {
    // Reset analysis settings to default
    setAnalysisSettings(null);
    setAnalysisBarSettings((prev) => ({
      ...prev,
      dimension: isDimensionPrecomputed(
        prev.dimension,
        honoredPrecomputedUnitDimensionIds,
      )
        ? ""
        : prev.dimension,
      baselineRow: 0,
      variationFilter: [],
      differenceType: "relative",
    }));
  }, [
    setAnalysisBarSettings,
    setAnalysisSettings,
    honoredPrecomputedUnitDimensionIds,
  ]);

  const endDate =
    experiment.status !== "running" ? snapshot?.settings?.endDate : undefined;

  return (
    <div>
      {isBandit && hasResults ? (
        <Callout status="info" mb="5">
          Bandits are better than experiments at directing traffic to the best
          variation but they can produce biased results.
        </Callout>
      ) : null}

      {/* toggle + pinned banner + loading state for official readout */}
      {saveError ? (
        <Callout status="error" mb="3">
          Failed to set as official results: {saveError}
        </Callout>
      ) : null}
      {hasPin && <OfficialReadoutToggle view={view} setView={setView} />}
      {isOfficialView && pinnedReport ? (
        <OfficialReadoutBanner
          pinnedReport={pinnedReport}
          pinnedSnapshot={snapshot ?? undefined}
          experimentId={experiment.id}
          pinnedBy={experiment.pinnedReportBy}
          pinnedAt={experiment.pinnedReportAt}
          onUnpin={unpinOfficialReadout}
          canManage={canManagePin}
        />
      ) : null}
      {isOfficialView && pinnedSnapshotLoading ? (
        <Callout status="info" mb="3">
          Loading official results…
        </Callout>
      ) : null}

      {/* hide the regular settings header while viewing the pinned readout */}
      {!isOfficialView && (
        <Box>
          <Flex direction="row" align="start" gap="3" mx="1" mb="4">
            {!(
              experiment.type === "multi-armed-bandit" &&
              experiment.status === "running"
            ) && permissionsUtil.canUpdateExperiment(experiment, {}) ? (
              <Link
                type="button"
                onClick={() => setAnalysisSettingsOpen(true)}
                mr="2"
              >
                Edit Settings
              </Link>
            ) : null}
            {hasData && (
              <>
                <Metadata
                  label="Engine"
                  value={
                    analysis?.settings?.statsEngine === "frequentist"
                      ? "Frequentist"
                      : "Bayesian"
                  }
                />
                <Metadata
                  label="CUPED"
                  value={
                    analysis?.settings?.regressionAdjusted
                      ? "Enabled"
                      : "Disabled"
                  }
                />
                {!organization?.settings?.disablePrecomputedDimensions ? (
                  <Metadata
                    label="Post-Stratification"
                    value={
                      analysis?.settings?.postStratificationEnabled
                        ? "Enabled"
                        : "Disabled"
                    }
                  />
                ) : null}
                {analysis?.settings?.statsEngine === "frequentist" ? (
                  <Metadata
                    label="Sequential"
                    value={
                      analysis?.settings?.sequentialTesting
                        ? "Enabled"
                        : "Disabled"
                    }
                  />
                ) : null}
                {segment ? (
                  <Metadata label="Segment" value={segment.name} />
                ) : null}
                {activationMetric ? (
                  <Metadata
                    label="Activation Metric"
                    value={activationMetric.name}
                  />
                ) : null}
                {getEffectiveLookbackOverride(
                  experiment.attributionModel,
                  experiment.lookbackOverride,
                ) && experiment.lookbackOverride ? (
                  <Metadata
                    label="Lookback Enforced"
                    value={
                      experiment.lookbackOverride.type === "date"
                        ? `${date(experiment.lookbackOverride.value, "UTC")} - ${endDate ? date(endDate, "UTC") : "now"}`
                        : `${experiment.lookbackOverride.value} ${experiment.lookbackOverride.valueUnit}`
                    }
                  />
                ) : null}
                {/* view-a-past-snapshot control + pin, when nothing is pinned */}
                {!hasPin &&
                canManagePin &&
                hasResults &&
                experiment.status !== "draft" ? (
                  <>
                    <Flex style={{ flex: 1 }} />
                    {/* browse to a past snapshot (snaps to nearest that ran) */}
                    {snapshotHistory.length > 0 ? (
                      <Tooltip body="View a previously computed snapshot (e.g. the day-14 readout). Snaps to the nearest snapshot that actually ran; only changes what you see until you pin.">
                        <Flex
                          align="center"
                          gap="2"
                          style={{
                            fontSize: 13,
                            color: "var(--color-text-mid)",
                          }}
                        >
                          View results as of
                          <Select
                            value={snapshot?.id ?? ""}
                            setValue={selectPreviewSnapshot}
                            size="2"
                            placeholder="Select a snapshot"
                          >
                            {snapshotHistory.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {datetime(s.windowEndDate)}
                              </SelectItem>
                            ))}
                          </Select>
                        </Flex>
                      </Tooltip>
                    ) : null}
                    <Tooltip
                      body={
                        previewActive
                          ? "Pins the snapshot you're previewing as this experiment's official results."
                          : "Creates a new custom report from the current snapshot and marks it as this experiment's official results. Visible to anyone who can view the experiment."
                      }
                    >
                      <Button
                        variant="outline"
                        setError={setSaveError}
                        onClick={() => saveAsOfficialReadout(previewActive)}
                      >
                        📌{" "}
                        {previewActive
                          ? "Pin these results"
                          : "Pin as official results"}
                      </Button>
                    </Tooltip>
                  </>
                ) : null}
                {isBandit && snapshot ? (
                  <>
                    <Flex style={{ flex: 1 }} />
                    <Flex direction="column" align="end">
                      <Metadata
                        label="Analysis type"
                        value={
                          snapshot?.type === "exploratory" ? (
                            <Tooltip
                              body={
                                <div className="text-left">
                                  <p>This is an exploratory analysis.</p>
                                  <p>
                                    Exploratory analyses do not cause bandit
                                    variation weights to change.
                                  </p>
                                </div>
                              }
                            >
                              Exploratory
                            </Tooltip>
                          ) : snapshot?.type === "standard" ? (
                            <Tooltip
                              body={
                                <div className="text-left">
                                  <p>This is a standard analysis.</p>
                                  <p>
                                    Bandit variation weights may have changed in
                                    response to this analysis.
                                  </p>
                                </div>
                              }
                            >
                              Standard
                            </Tooltip>
                          ) : (
                            <span>{snapshot?.type || `unknown`}</span>
                          )
                        }
                      />
                      {snapshot?.type !== "standard" && (
                        <Link
                          onClick={() => setSnapshotType("standard")}
                          style={{ marginBottom: -8 }}
                        >
                          <Text size="1">View standard analysis</Text>
                        </Link>
                      )}
                    </Flex>
                  </>
                ) : null}
              </>
            )}
          </Flex>
        </Box>
      )}

      <div className="appbox">
        {analysisSettingsOpen ? (
          <AnalysisForm
            cancel={() => setAnalysisSettingsOpen(false)}
            experiment={experiment}
            envs={envs}
            mutate={mutate}
            phase={experiment.phases.length - 1}
            editDates={false}
            editMetrics={true}
            editVariationIds={false}
            source={"results-tab"}
          />
        ) : null}
        <div className="mb-2" style={{ overflowX: "initial" }}>
          {/* skip AnalysisSettingsSummary on the pinned readout. Its
              Run Queries / date controls would mutate the snapshot. */}
          {!isOfficialView && (
            <AnalysisSettingsSummary
              experiment={experiment}
              mutate={mutate}
              statsEngine={statsEngine}
              editMetrics={editMetrics ?? undefined}
              variationFilter={analysisBarSettings.variationFilter}
              baselineRow={analysisBarSettings.baselineRow}
              differenceType={analysisBarSettings.differenceType}
              dimension={analysisBarSettings.dimension}
              setDimension={(d: string, resetOtherSettings?: boolean) =>
                setAnalysisBarSettings({
                  ...analysisBarSettings,
                  dimension: d,
                  ...(resetOtherSettings
                    ? {
                        baselineRow: 0,
                        differenceType: "relative",
                        variationFilter: [],
                      }
                    : {}),
                })
              }
              metricTagFilter={metricTagFilter}
              setMetricTagFilter={setMetricTagFilter}
              metricsFilter={metricsFilter}
              setMetricsFilter={setMetricsFilter}
              availableMetricsFilters={availableMetricsFilters}
              availableMetricTags={availableMetricTags}
              availableSliceTags={availableSliceTags}
              sliceTagsFilter={sliceTagsFilter}
              setSliceTagsFilter={setSliceTagsFilter}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSnapshotSuccessfulUpdate={onSnapshotSuccessfulUpdate}
            />
          )}
          {experiment.status === "draft" ? (
            <Callout status="info" mx="3" my="4">
              Your experiment is still in a <strong>draft</strong> state. You
              must start the experiment first before seeing results.
            </Callout>
          ) : (
            <>
              {experiment.status === "running" &&
              !experiment.datasource &&
              !snapshot &&
              !experiment.id.match(/^exp_sample/) ? (
                <div className="alert-cool-1 text-center m-4 px-3 py-4">
                  <p className="h4">Use GrowthBook for Analysis</p>
                  {datasources.length > 0 ? (
                    <>
                      <p>
                        Select a Data Source and metrics so GrowthBook can
                        analyze the experiment results.
                      </p>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setAnalysisSettingsOpen(true);
                        }}
                      >
                        Select Data Source
                      </button>
                    </>
                  ) : (
                    <>
                      <p>
                        Connect GrowthBook to your data and use our powerful
                        metrics and stats engine to automatically analyze your
                        experiment results.
                      </p>
                      <NextLink href="/datasources" className="btn btn-primary">
                        Connect to your Data
                      </NextLink>
                    </>
                  )}
                </div>
              ) : (
                <Results
                  experiment={experiment}
                  mutateExperiment={mutate}
                  editMetrics={editMetrics ?? undefined}
                  editResult={editResult ?? undefined}
                  statsEngine={statsEngine}
                  analysisBarSettings={analysisBarSettings}
                  setAnalysisBarSettings={setAnalysisBarSettings}
                  isTabActive={isTabActive}
                  metricTagFilter={metricTagFilter}
                  metricsFilter={metricsFilter}
                  sliceTagsFilter={sliceTagsFilter}
                  setTab={setTab}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  sortDirection={sortDirection}
                  setSortDirection={setSortDirection}
                />
              )}
            </>
          )}
        </div>
      </div>
      {/* also hide the Custom Reports section while viewing the pinned readout */}
      {snapshot && !isDemoExperiment && !isOfficialView && (
        <div className="appbox mt-4">
          <div className="row mx-2 py-3 d-flex align-items-center">
            <div className="col ml-2">
              <div className="h3">Custom Reports</div>
              <div>
                Create and share a stand-alone ad-hoc analysis without affecting
                this {isBandit ? "Bandit" : "Experiment"}.
              </div>
            </div>
            <div className="col-auto mr-2">
              {permissionsUtil.canCreateReport(experiment) ? (
                <Button
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
                      source: "experiment results tab",
                    });
                    await router.push(`/report/${res.report.id}`);
                  }}
                >
                  New Custom Report
                </Button>
              ) : null}
            </div>
          </div>
          <ExperimentReportsList experiment={experiment} />
        </div>
      )}
      {/* bottom-of-page nav so users on the Official view know how to
          find the Custom Reports section. */}
      {isOfficialView && (
        <Box mt="4" mb="2" style={{ textAlign: "center" }}>
          <Text as="div" size="2" color="gray">
            <Link type="button" onClick={() => setView("latest")}>
              View other custom reports →
            </Link>{" "}
            Switch to Latest results
          </Text>
        </Box>
      )}
    </div>
  );
}
