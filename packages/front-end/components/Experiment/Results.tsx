import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, { FC, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  DifferenceType,
  SignificanceThresholds,
  StatsEngine,
} from "shared/types/stats";
import { getValidDate, ago, relativeDate } from "shared/dates";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import {
  isDimensionPrecomputed,
  getEffectiveLookbackOverride,
  getAllMetricIdsFromExperiment,
  getLatestPhaseVariations,
} from "shared/experiments";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { MetricSnapshotSettings } from "shared/types/report";
import { useDefinitions } from "@/services/DefinitionsContext";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import DateResults from "@/components/Experiment/DateResults";
import VariationIdWarning from "@/components/Experiment/VariationIdWarning";
import useOrgSettings from "@/hooks/useOrgSettings";
import { trackSnapshot } from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import { MetricDrilldownProvider } from "@/components/MetricDrilldown/MetricDrilldownContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { useIncrementalPipelineUnsupportedReason } from "@/hooks/useIncrementalPipelineUnsupportedReason";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import { hasHealthData } from "@/components/HealthTab/constants";
import { ExperimentTab } from "./TabbedPage";
import { showsUnhealthyBanner } from "./TabbedPage/UnhealthyExperimentBanner";

export type AnalysisBarSettings = {
  dimension: string;
  baselineRow: number;
  differenceType: DifferenceType;
  variationFilter: number[];
};

const BreakDownResults = dynamic(
  () => import("@/components/Experiment/BreakDownResults"),
);
const CompactResults = dynamic(
  () => import("@/components/Experiment/CompactResults"),
);

const Results: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutateExperiment: () => void;
  editMetrics?: () => void;
  statsEngine: StatsEngine;
  analysisBarSettings: AnalysisBarSettings;
  setAnalysisBarSettings: (s: AnalysisBarSettings) => void;
  metricTagFilter?: string[];
  metricsFilter?: string[];
  sliceTagsFilter?: string[];
  isTabActive?: boolean;
  setTab?: (tab: ExperimentTab) => void;
  sortBy?: "significance" | "change" | null;
  setSortBy?: (s: "significance" | "change" | null) => void;
  sortDirection?: "asc" | "desc" | null;
  setSortDirection?: (d: "asc" | "desc" | null) => void;
}> = ({
  experiment,
  mutateExperiment,
  editMetrics,
  statsEngine,
  analysisBarSettings,
  setAnalysisBarSettings,
  metricTagFilter,
  metricsFilter,
  sliceTagsFilter,
  isTabActive = true,
  setTab,
  sortBy,
  setSortBy,
  sortDirection,
  setSortDirection,
}) => {
  const { apiCall } = useAuth();

  const [queriesModalOpen, setQueriesModalOpen] = useState(false);

  // todo: move to snapshot property
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const bayesianConfidenceLevels = useConfidenceLevels(experiment.project);
  const pValueThreshold = usePValueThreshold(experiment.project);
  const significanceThresholds: SignificanceThresholds = {
    bayesianConfidenceLevels,
    pValueThreshold,
  };

  const {
    error,
    snapshot,
    dimensionless,
    analysis,
    latestSummary: latest,
    phase,
    setPhase,
    dimension,
    setAnalysisSettings,
    mutate,
    loading: snapshotLoading,
  } = useSnapshot();

  // Child tables (BreakdownResults/CompactResults → BaselineChooserColumnLabel)
  // append analyses to the **current** snapshot in place, so the heavy
  // fetch needs to be re-issued when they call back. Bind `inPlace: true`
  // here so the children stay decoupled from the option name.
  const mutateInPlace = () => mutate({ inPlace: true });

  const queryStatusData = getQueryStatus(latest?.queries || [], latest?.error);
  const { status } = queryStatusData;

  const queryStrings = latest?.queries?.map((q) => q.query) || [];

  useEffect(() => {
    setPhase(experiment.phases.length - 1);
  }, [experiment.phases.length, setPhase]);

  const permissionsUtil = usePermissionsUtil();
  const { getRunningExperimentResultStatus } = useRunningExperimentStatus();
  const { getDatasourceById, getExperimentMetricById, metricGroups } =
    useDefinitions();
  const incrementalPipelineUnsupportedReason =
    useIncrementalPipelineUnsupportedReason(experiment);

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const hasValidStatsEngine =
    !analysis?.settings ||
    (analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE) === statsEngine;

  const phaseObj = experiment.phases?.[phase];

  const phaseAgeMinutes =
    (Date.now() - getValidDate(phaseObj?.dateStarted ?? "").getTime()) /
    (1000 * 60);

  const variations = getLatestPhaseVariations(experiment).map((v, i) => {
    return {
      id: v.key || v.index + "",
      experimentVariationId: v.id,
      index: v.index,
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
    hasData &&
    hasValidStatsEngine &&
    snapshot &&
    analysis &&
    !analysis?.settings?.dimensions?.length;

  const showBreakDownResults =
    hasData &&
    hasValidStatsEngine &&
    ((snapshot?.dimension &&
      snapshot.dimension.substring(0, 8) !== "pre:date") ||
      (analysis?.settings?.dimensions?.length ?? 0) > 0);

  const showDateResults =
    hasData &&
    hasValidStatsEngine &&
    snapshot?.dimension?.substring(0, 8) === "pre:date" && // todo: refactor hardcoded dimension
    analysis?.settings?.dimensions?.length; // todo: needed? separate desired vs actual

  if (error) {
    return (
      <Callout status="error" mx="3" my="4">
        {error.message}
      </Callout>
    );
  }

  // cannot re-aggregate quantile metrics across non-unit pre-computed dimensions
  const showErrorsOnQuantileMetrics = analysis?.settings?.dimensions.some((d) =>
    // Pass in empty array to indicate pre-computed standalone (not exp) dimensions are fine
    isDimensionPrecomputed(d, []),
  );

  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  // Keep this in sync with ResultMoreMenu's incremental refresh check.
  const isIncrementalActive =
    getIsExperimentIncludedInIncrementalRefresh(
      datasource ?? undefined,
      experiment.id,
      experiment.type,
    ) && !incrementalPipelineUnsupportedReason;
  const dimensionNeedsOverallResultsFirst =
    !!analysisBarSettings.dimension &&
    isIncrementalActive &&
    !(dimensionless && !dimensionless.dimension);

  const hasMetrics = getAllMetricIdsFromExperiment(
    experiment,
    false,
    metricGroups,
  ).some((metricId) => getExperimentMetricById(metricId) !== null);

  const isBandit = experiment.type === "multi-armed-bandit";
  const hasQueries = queryStrings.length > 0;

  function noDataHint(): string | null {
    if (!hasValidStatsEngine) {
      return "The stats engine changed, so click Update to re-run the analysis.";
    }
    if (!snapshot) {
      return datasource && permissionsUtil.canRunExperimentQueries(datasource)
        ? "Click Update to run the analysis."
        : null;
    }
    const started = phaseObj?.dateStarted ?? "";
    if (phaseAgeMinutes >= 120) {
      const noun = isBandit
        ? "Bandit"
        : experiment.type === "holdout"
          ? "holdout"
          : "experiment";
      return `Make sure your ${noun} is tracking properly.`;
    }
    if (phaseAgeMinutes < 0) {
      return `This experiment will start ${relativeDate(started)}. Once it has run for a little while, click Update to check again.`;
    }
    return `It started ${ago(started)}. Give it a little longer, then click Update to check again.`;
  }

  return (
    <>
      {!hasMetrics && (
        <Callout
          status="info"
          contentAlign="center"
          mx="3"
          my="3"
          action={
            editMetrics && (
              <Button variant="outline" size="sm" onClick={() => editMetrics()}>
                Add metrics
              </Button>
            )
          }
        >
          Add at least 1 metric to view results.
        </Callout>
      )}

      {status === "failed" && !hasData && !snapshotLoading && hasMetrics ? (
        <Callout
          status="error"
          contentAlign="center"
          mx="3"
          my="3"
          action={
            hasQueries ? (
              <Link onClick={() => setQueriesModalOpen(true)}>
                View queries
              </Link>
            ) : null
          }
        >
          The most recent update failed.
        </Callout>
      ) : null}

      {(!hasData || !hasValidStatsEngine) &&
        status !== "failed" && // failed is handled above
        status !== "running" &&
        !snapshot?.unknownVariations?.length &&
        hasMetrics &&
        !dimensionNeedsOverallResultsFirst &&
        !snapshotLoading && (
          <Callout status="info" contentAlign="center" mx="3" my="3">
            No data yet. {noDataHint()}
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
                variations: getLatestPhaseVariations(experiment).map((v, i) => {
                  return {
                    ...v,
                    key: ids[i] ?? v.key,
                  };
                }),
                isVariationKeyReconciliation: true,
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

      {analysis && (
        <MetricDrilldownProvider
          experimentId={experiment.id}
          significanceThresholds={significanceThresholds}
          phase={phase}
          experimentStatus={experiment.status}
          analysis={analysis}
          variations={variations}
          goalMetrics={experiment.goalMetrics}
          secondaryMetrics={experiment.secondaryMetrics}
          guardrailMetrics={experiment.guardrailMetrics}
          metricOverrides={experiment.metricOverrides ?? []}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          customMetricSlices={experiment.customMetricSlices}
          statsEngine={analysis.settings?.statsEngine || DEFAULT_STATS_ENGINE}
          pValueCorrection={pValueCorrection}
          startDate={phaseObj?.dateStarted ?? ""}
          endDate={phaseObj?.dateEnded ?? ""}
          reportDate={snapshot?.dateCreated ?? new Date()}
          isLatestPhase={phase === experiment.phases.length - 1}
          sequentialTestingEnabled={analysis.settings?.sequentialTesting}
          lookbackOverride={getEffectiveLookbackOverride(
            snapshot?.settings?.attributionModel,
            snapshot?.settings?.lookbackOverride,
          )}
          differenceType={analysis.settings?.differenceType || "relative"}
          baselineRow={analysisBarSettings.baselineRow}
          variationFilter={analysisBarSettings.variationFilter}
          sortBy={sortBy}
          sortDirection={sortDirection}
        >
          {showDateResults ? (
            <DateResults
              significanceThresholds={significanceThresholds}
              goalMetrics={experiment.goalMetrics}
              secondaryMetrics={experiment.secondaryMetrics}
              guardrailMetrics={experiment.guardrailMetrics}
              results={analysis?.results ?? []}
              seriestype={snapshot.dimension ?? ""}
              variations={variations}
              statsEngine={
                analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE
              }
              differenceType={analysis.settings?.differenceType}
            />
          ) : showBreakDownResults && snapshot ? (
            <BreakDownResults
              experimentId={experiment.id}
              significanceThresholds={significanceThresholds}
              key={analysis?.settings?.dimensions?.[0] ?? snapshot.dimension}
              results={analysis?.results ?? []}
              queryStatusData={queryStatusData}
              variations={variations}
              variationFilter={analysisBarSettings.variationFilter}
              setVariationFilter={(v: number[]) =>
                setAnalysisBarSettings({
                  ...analysisBarSettings,
                  variationFilter: v,
                })
              }
              baselineRow={analysisBarSettings.baselineRow}
              setBaselineRow={(b: number) =>
                setAnalysisBarSettings({
                  ...analysisBarSettings,
                  baselineRow: b,
                })
              }
              snapshot={snapshot}
              analysis={analysis}
              setAnalysisSettings={setAnalysisSettings}
              mutate={mutateInPlace}
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
              statsEngine={
                analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE
              }
              pValueCorrection={pValueCorrection}
              settingsForSnapshotMetrics={settingsForSnapshotMetrics}
              sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
              differenceType={analysis?.settings?.differenceType || "relative"}
              setDifferenceType={(d: DifferenceType) =>
                setAnalysisBarSettings({
                  ...analysisBarSettings,
                  differenceType: d,
                })
              }
              metricTagFilter={metricTagFilter}
              metricsFilter={metricsFilter}
              experimentType={experiment.type}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
              analysisBarSettings={analysisBarSettings}
              customMetricSlices={experiment.customMetricSlices}
            />
          ) : showCompactResults ? (
            <CompactResults
              experimentId={experiment.id}
              significanceThresholds={significanceThresholds}
              editMetrics={editMetrics}
              variations={variations}
              variationFilter={analysisBarSettings.variationFilter}
              setVariationFilter={(v: number[]) =>
                setAnalysisBarSettings({
                  ...analysisBarSettings,
                  variationFilter: v,
                })
              }
              baselineRow={analysisBarSettings.baselineRow}
              setBaselineRow={(b: number) =>
                setAnalysisBarSettings({
                  ...analysisBarSettings,
                  baselineRow: b,
                })
              }
              snapshot={snapshot}
              analysis={analysis}
              setAnalysisSettings={setAnalysisSettings}
              mutate={mutateInPlace}
              multipleExposures={snapshot.multipleExposures || 0}
              results={analysis.results[0]}
              queryStatusData={queryStatusData}
              reportDate={snapshot.dateCreated}
              startDate={phaseObj?.dateStarted ?? ""}
              endDate={phaseObj?.dateEnded ?? ""}
              isLatestPhase={phase === experiment.phases.length - 1}
              // Hidden where the page's banner takes their place and links
              // to the Health tab.
              showHealthWarnings={
                phase !== experiment.phases.length - 1 ||
                !hasHealthData(datasource) ||
                !showsUnhealthyBanner(
                  experiment,
                  getRunningExperimentResultStatus(experiment),
                )
              }
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
              setDifferenceType={(d: DifferenceType) =>
                setAnalysisBarSettings({
                  ...analysisBarSettings,
                  differenceType: d,
                })
              }
              metricTagFilter={metricTagFilter}
              metricsFilter={metricsFilter}
              sliceTagsFilter={sliceTagsFilter}
              isTabActive={isTabActive}
              setTab={setTab}
              experimentType={experiment.type}
              customMetricSlices={experiment.customMetricSlices}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
              analysisBarSettings={analysisBarSettings}
            />
          ) : null}
        </MetricDrilldownProvider>
      )}
      {queriesModalOpen && hasQueries && (
        <AsyncQueriesModal
          close={() => setQueriesModalOpen(false)}
          queries={queryStrings}
          savedQueries={[]}
          error={latest?.error}
        />
      )}
    </>
  );
};

export default Results;
