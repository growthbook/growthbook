import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { FC, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { StatsEngine } from "back-end/types/stats";
import { getValidDate, ago, relativeDate } from "shared/dates";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { generatePinnedSliceKey, SliceLevelsData } from "shared/experiments";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { MetricSnapshotSettings } from "back-end/types/report";
import { HoldoutInterface } from "back-end/src/validators/holdout";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import FilterSummary from "@/components/Experiment/FilterSummary";
import DateResults from "@/components/Experiment/DateResults";
import VariationIdWarning from "@/components/Experiment/VariationIdWarning";
import AnalysisSettingsBar, {
  AnalysisBarSettings,
} from "@/components/Experiment/AnalysisSettingsBar";
import StatusBanner from "@/components/Experiment/StatusBanner";
import useOrgSettings from "@/hooks/useOrgSettings";
import { trackSnapshot } from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import { ExperimentTab } from "./TabbedPage";

const BreakDownResults = dynamic(
  () => import("@/components/Experiment/BreakDownResults"),
);
const CompactResults = dynamic(
  () => import("@/components/Experiment/CompactResults"),
);

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  envs: string[];
  mutateExperiment: () => void;
  draftMode?: boolean;
  editMetrics?: () => void;
  editResult?: () => void;
  editPhases?: () => void;
  alwaysShowPhaseSelector?: boolean;
  reportDetailsLink?: boolean;
  statsEngine: StatsEngine;
  regressionAdjustmentAvailable?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentHasValidMetrics?: boolean;
  onRegressionAdjustmentChange?: (enabled: boolean) => Promise<void>;
  analysisBarSettings: AnalysisBarSettings;
  setAnalysisBarSettings: (s: AnalysisBarSettings) => void;
  metricTagFilter?: string[];
  setMetricTagFilter?: (tags: string[]) => void;
  metricGroupsFilter?: string[];
  setMetricGroupsFilter?: (groups: string[]) => void;
  availableMetricGroups?: Array<{ id: string; name: string }>;
  availableSliceTags?: string[];
  sliceTagsFilter?: string[];
  setSliceTagsFilter?: (tags: string[]) => void;
  isTabActive?: boolean;
  setTab?: (tab: ExperimentTab) => void;
  holdout?: HoldoutInterface;
  sortBy?: "metric-tags" | "significance" | "change" | null;
  setSortBy?: (s: "metric-tags" | "significance" | "change" | null) => void;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
}> = ({
  experiment,
  envs,
  mutateExperiment,
  draftMode = false,
  editMetrics,
  editPhases,
  editResult,
  alwaysShowPhaseSelector = false,
  reportDetailsLink = true,
  statsEngine,
  regressionAdjustmentAvailable = false,
  regressionAdjustmentEnabled = false,
  regressionAdjustmentHasValidMetrics = false,
  onRegressionAdjustmentChange,
  analysisBarSettings,
  setAnalysisBarSettings,
  metricTagFilter,
  setMetricTagFilter,
  metricGroupsFilter,
  setMetricGroupsFilter,
  availableMetricGroups,
  availableSliceTags = [],
  sliceTagsFilter,
  setSliceTagsFilter,
  isTabActive = true,
  setTab,
  holdout,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
}) => {
  const { apiCall } = useAuth();

  const [optimisticPinnedLevels, setOptimisticPinnedLevels] = useState<
    string[]
  >(experiment.pinnedMetricSlices || []);
  useEffect(
    () => setOptimisticPinnedLevels(experiment.pinnedMetricSlices || []),
    [experiment.pinnedMetricSlices],
  );

  const togglePinnedMetricSlice = async (
    metricId: string,
    sliceLevels: SliceLevelsData[],
    location?: "goal" | "secondary" | "guardrail",
  ) => {
    if (!editMetrics || !mutateExperiment) return;

    const key = generatePinnedSliceKey(
      metricId,
      sliceLevels,
      location || "goal",
    );
    const newPinned = optimisticPinnedLevels.includes(key)
      ? optimisticPinnedLevels.filter((id) => id !== key)
      : [...optimisticPinnedLevels, key];
    setOptimisticPinnedLevels(newPinned);

    try {
      const response = await apiCall<{ pinnedMetricSlices: string[] }>(
        `/experiment/${experiment.id}`,
        {
          method: "POST",
          body: JSON.stringify({
            pinnedMetricSlices: newPinned,
          }),
        },
      );
      if (response?.pinnedMetricSlices) {
        setOptimisticPinnedLevels(response.pinnedMetricSlices);
      }
      mutateExperiment();
    } catch (error) {
      setOptimisticPinnedLevels(experiment.pinnedMetricSlices || []);
    }
  };

  // todo: move to snapshot property
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const {
    error,
    snapshot,
    analysis,
    latest,
    phase,
    setPhase,
    dimension,
    setAnalysisSettings,
    mutateSnapshot: mutate,
    loading: snapshotLoading,
  } = useSnapshot();

  const queryStatusData = getQueryStatus(latest?.queries || [], latest?.error);

  useEffect(() => {
    setPhase(experiment.phases.length - 1);
  }, [experiment.phases.length, setPhase]);

  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();

  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData =
    (analysis?.results?.[0]?.variations?.length ?? 0) > 0 &&
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const phaseObj = experiment.phases?.[phase];

  const phaseAgeMinutes =
    (Date.now() - getValidDate(phaseObj?.dateStarted ?? "").getTime()) /
    (1000 * 60);

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  const settingsForSnapshotMetrics: MetricSnapshotSettings[] =
    snapshot?.settings?.metricSettings?.map((m) => ({
      metric: m.id,
      properPrior: m.computedSettings?.properPrior ?? false,
      properPriorMean: m.computedSettings?.properPriorMean ?? 0,
      properPriorStdDev:
        m.computedSettings?.properPriorStdDev ?? DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentReason:
        m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays || 0,
      regressionAdjustmentEnabled:
        !!m.computedSettings?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable:
        !!m.computedSettings?.regressionAdjustmentAvailable,
    })) || [];

  const showCompactResults =
    !draftMode &&
    hasData &&
    snapshot &&
    analysis &&
    !analysis?.settings?.dimensions?.length;

  const showBreakDownResults =
    !draftMode &&
    hasData &&
    ((snapshot?.dimension &&
      snapshot.dimension.substring(0, 8) !== "pre:date") ||
      (analysis?.settings?.dimensions?.length ?? 0) > 0);

  const showDateResults =
    !draftMode &&
    hasData &&
    snapshot?.dimension?.substring(0, 8) === "pre:date" && // todo: refactor hardcoded dimension
    analysis?.settings?.dimensions?.length; // todo: needed? separate desired vs actual

  if (error) {
    return (
      <Callout status="error" mx="3" my="4">
        {error.message}
      </Callout>
    );
  }

  // cannot re-aggregate quantile metrics across pre-computed dimensions
  const showErrorsOnQuantileMetrics = analysis?.settings?.dimensions.some((d) =>
    d.startsWith("precomputed:"),
  );

  const datasource = getDatasourceById(experiment.datasource);

  const hasMetrics =
    experiment.goalMetrics.length > 0 ||
    experiment.secondaryMetrics.length > 0 ||
    experiment.guardrailMetrics.length > 0;

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <>
      {!draftMode ? (
        <AnalysisSettingsBar
          envs={envs}
          mutateExperiment={mutateExperiment}
          analysisBarSettings={analysisBarSettings}
          setAnalysisBarSettings={setAnalysisBarSettings}
          setAnalysisSettings={setAnalysisSettings}
          editMetrics={editMetrics}
          variations={variations}
          editPhases={editPhases}
          alwaysShowPhaseSelector={alwaysShowPhaseSelector}
          regressionAdjustmentAvailable={regressionAdjustmentAvailable}
          regressionAdjustmentEnabled={regressionAdjustmentEnabled}
          regressionAdjustmentHasValidMetrics={
            regressionAdjustmentHasValidMetrics
          }
          onRegressionAdjustmentChange={onRegressionAdjustmentChange}
          showMoreMenu={false}
          holdout={holdout}
        />
      ) : (
        <StatusBanner
          mutateExperiment={mutateExperiment}
          editResult={editResult || undefined}
        />
      )}

      {!hasMetrics && (
        <div className="alert alert-info m-3">
          Add at least 1 metric to view results.{" "}
          {editMetrics && (
            <button
              className="btn btn-primary btn-sm ml-3"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                editMetrics();
              }}
            >
              Add Metrics
            </button>
          )}
        </div>
      )}

      {!hasData &&
        !snapshot?.unknownVariations?.length &&
        status !== "running" &&
        hasMetrics &&
        !snapshotLoading && (
          <Callout status="info" mx="3" mb="4">
            No data yet.{" "}
            {snapshot &&
              phaseAgeMinutes >= 120 &&
              `Make sure your ${
                isBandit
                  ? "Bandit"
                  : experiment.type === "holdout"
                    ? "Holdout"
                    : "Experiment"
              } is tracking properly.`}
            {snapshot &&
              phaseAgeMinutes < 120 &&
              (phaseAgeMinutes < 0
                ? "This experiment will start " +
                  relativeDate(experiment.phases[phase]?.dateStarted ?? "") +
                  ". Wait until it's been running for a little while and click the 'Update' button above to check again."
                : "It was just started " +
                  ago(experiment.phases[phase]?.dateStarted ?? "") +
                  ". Give it a little longer and click the 'Update' button above to check again.")}
            {!snapshot &&
              datasource &&
              permissionsUtil.canRunExperimentQueries(datasource) &&
              `Click the "Update" button above.`}
            {snapshotLoading && <div> Snapshot loading...</div>}
          </Callout>
        )}

      {snapshot && !snapshot.dimension && (
        <VariationIdWarning
          datasource={datasource}
          unknownVariations={snapshot.unknownVariations || []}
          isUpdating={status === "running"}
          results={analysis?.results?.[0]}
          variations={variations}
          setVariationIds={async (ids) => {
            // Don't do anything if the query is currently running
            if (status === "running") {
              throw new Error("Cancel running query first");
            }

            // Update variation ids
            await apiCall(`/experiment/${experiment.id}`, {
              method: "POST",
              body: JSON.stringify({
                variations: experiment.variations.map((v, i) => {
                  return {
                    ...v,
                    key: ids[i] ?? v.key,
                  };
                }),
              }),
            });

            // Fetch results again
            const res = await apiCall<{
              snapshot: ExperimentSnapshotInterface;
            }>(`/experiment/${experiment.id}/snapshot`, {
              method: "POST",
              body: JSON.stringify({
                phase,
                dimension,
              }),
            });
            trackSnapshot(
              "create",
              "VariationIdWarning",
              getDatasourceById(experiment.datasource)?.type || null,
              res.snapshot,
            );

            mutateExperiment();
            mutate();
          }}
          project={experiment.project}
        />
      )}

      {showDateResults ? (
        <DateResults
          goalMetrics={experiment.goalMetrics}
          secondaryMetrics={experiment.secondaryMetrics}
          guardrailMetrics={experiment.guardrailMetrics}
          results={analysis?.results ?? []}
          seriestype={snapshot.dimension ?? ""}
          variations={variations}
          statsEngine={analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE}
          differenceType={analysis.settings?.differenceType}
        />
      ) : showBreakDownResults && snapshot ? (
        <BreakDownResults
          experimentId={experiment.id}
          key={analysis?.settings?.dimensions?.[0] ?? snapshot.dimension}
          results={analysis?.results ?? []}
          queryStatusData={queryStatusData}
          variations={variations}
          variationFilter={analysisBarSettings.variationFilter}
          baselineRow={analysisBarSettings.baselineRow}
          goalMetrics={experiment.goalMetrics}
          secondaryMetrics={experiment.secondaryMetrics}
          guardrailMetrics={experiment.guardrailMetrics}
          metricOverrides={experiment.metricOverrides ?? []}
          dimensionId={
            analysis?.settings?.dimensions?.[0] ?? snapshot.dimension ?? ""
          }
          showErrorsOnQuantileMetrics={showErrorsOnQuantileMetrics}
          isLatestPhase={phase === experiment.phases.length - 1}
          phase={phase}
          startDate={phaseObj?.dateStarted ?? ""}
          endDate={phaseObj?.dateEnded ?? ""}
          reportDate={snapshot.dateCreated}
          activationMetric={experiment.activationMetric}
          status={experiment.status}
          statsEngine={analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE}
          pValueCorrection={pValueCorrection}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
          differenceType={analysis?.settings?.differenceType || "relative"}
          metricTagFilter={metricTagFilter}
          setMetricTagFilter={setMetricTagFilter}
          metricGroupsFilter={metricGroupsFilter}
          setMetricGroupsFilter={setMetricGroupsFilter}
          availableMetricGroups={availableMetricGroups}
          availableSliceTags={availableSliceTags}
          sliceTagsFilter={sliceTagsFilter}
          setSliceTagsFilter={setSliceTagsFilter}
          experimentType={experiment.type}
          sortBy={sortBy}
          setSortBy={setSortBy}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
          analysisBarSettings={analysisBarSettings}
        />
      ) : showCompactResults ? (
        <>
          {reportDetailsLink && (
            <div className="float-right pr-3">
              <FilterSummary
                experiment={experiment}
                phase={phaseObj}
                snapshot={snapshot}
              />
            </div>
          )}
          <CompactResults
            experimentId={experiment.id}
            editMetrics={editMetrics}
            variations={variations}
            variationFilter={analysisBarSettings.variationFilter}
            baselineRow={analysisBarSettings.baselineRow}
            multipleExposures={snapshot.multipleExposures || 0}
            results={analysis.results[0]}
            queryStatusData={queryStatusData}
            reportDate={snapshot.dateCreated}
            startDate={phaseObj?.dateStarted ?? ""}
            endDate={phaseObj?.dateEnded ?? ""}
            isLatestPhase={phase === experiment.phases.length - 1}
            phase={phase}
            status={experiment.status}
            goalMetrics={experiment.goalMetrics}
            secondaryMetrics={experiment.secondaryMetrics}
            guardrailMetrics={experiment.guardrailMetrics}
            metricOverrides={experiment.metricOverrides ?? []}
            id={experiment.id}
            statsEngine={analysis.settings.statsEngine}
            pValueCorrection={pValueCorrection}
            settingsForSnapshotMetrics={settingsForSnapshotMetrics}
            sequentialTestingEnabled={analysis.settings?.sequentialTesting}
            differenceType={analysis.settings?.differenceType}
            metricTagFilter={metricTagFilter}
            setMetricTagFilter={setMetricTagFilter}
            metricGroupsFilter={metricGroupsFilter}
            setMetricGroupsFilter={setMetricGroupsFilter}
            availableMetricGroups={availableMetricGroups}
            availableSliceTags={availableSliceTags}
            sliceTagsFilter={sliceTagsFilter}
            setSliceTagsFilter={setSliceTagsFilter}
            isTabActive={isTabActive}
            setTab={setTab}
            experimentType={experiment.type}
            pinnedMetricSlices={optimisticPinnedLevels}
            togglePinnedMetricSlice={togglePinnedMetricSlice}
            customMetricSlices={experiment.customMetricSlices}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            analysisBarSettings={analysisBarSettings}
          />
        </>
      ) : null}
    </>
  );
};

export default Results;
