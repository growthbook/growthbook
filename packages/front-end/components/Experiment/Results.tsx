import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, { FC, useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import { getValidDate, ago, relativeDate } from "shared/dates";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { MetricSnapshotSettings } from "shared/types/report";
import { formatDimensionValueForDisplay } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import FilterSummary from "@/components/Experiment/FilterSummary";
import DateResults from "@/components/Experiment/DateResults";
import VariationIdWarning from "@/components/Experiment/VariationIdWarning";
import StatusBanner from "@/components/Experiment/StatusBanner";
import useOrgSettings from "@/hooks/useOrgSettings";
import { trackSnapshot } from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import MetricDrilldownModal, {
  MetricDrilldownTab,
} from "@/components/MetricDrilldown/MetricDrilldownModal";
import { ExperimentTableRow } from "@/services/experiments";
import { ExperimentTab } from "./TabbedPage";

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
  draftMode?: boolean;
  editMetrics?: () => void;
  editResult?: () => void;
  reportDetailsLink?: boolean;
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
  draftMode = false,
  editMetrics,
  editResult,
  reportDetailsLink = true,
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
  const [openMetricDrilldownModalInfo, setOpenMetricDrilldownModalInfo] =
    useState<{
      metricRow: ExperimentTableRow;
      initialTab?: MetricDrilldownTab;
      initialSliceSearchTerm?: string;
      dimensionInfo?: { name: string; value: string };
      dimensionIndex?: number;
    } | null>(null);

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
  const { status } = queryStatusData;

  const queryStrings = latest?.queries?.map((q) => q.query) || [];

  useEffect(() => {
    setPhase(experiment.phases.length - 1);
  }, [experiment.phases.length, setPhase]);

  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;
  const hasValidStatsEngine =
    !analysis?.settings ||
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

  const handleRowClick = useCallback(
    (
      row: ExperimentTableRow,
      dimensionInfo?: { name: string; value: string },
    ) => {
      // Find the dimension index if dimensionInfo is provided (from BreakDownResults)
      let dimensionIndex: number | undefined;
      if (dimensionInfo && analysis?.results) {
        dimensionIndex = analysis.results.findIndex(
          (r) => formatDimensionValueForDisplay(r.name) === dimensionInfo.value,
        );
        if (dimensionIndex === -1) dimensionIndex = undefined;
      }

      if (row.isSliceRow) {
        setOpenMetricDrilldownModalInfo({
          metricRow: row,
          initialTab: "slices",
          initialSliceSearchTerm:
            typeof row.label === "string" ? row.label : "",
          dimensionInfo,
          dimensionIndex,
        });
      } else {
        setOpenMetricDrilldownModalInfo({
          metricRow: row,
          initialTab: "overview",
          dimensionInfo,
          dimensionIndex,
        });
      }
    },
    [analysis?.results],
  );

  const showCompactResults =
    !draftMode &&
    hasData &&
    hasValidStatsEngine &&
    snapshot &&
    analysis &&
    !analysis?.settings?.dimensions?.length;

  const showBreakDownResults =
    !draftMode &&
    hasData &&
    hasValidStatsEngine &&
    ((snapshot?.dimension &&
      snapshot.dimension.substring(0, 8) !== "pre:date") ||
      (analysis?.settings?.dimensions?.length ?? 0) > 0);

  const showDateResults =
    !draftMode &&
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

  // cannot re-aggregate quantile metrics across pre-computed dimensions
  const showErrorsOnQuantileMetrics = analysis?.settings?.dimensions.some((d) =>
    d.startsWith("precomputed:"),
  );

  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;

  const hasMetrics =
    experiment.goalMetrics.length > 0 ||
    experiment.secondaryMetrics.length > 0 ||
    experiment.guardrailMetrics.length > 0;

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <>
      {!draftMode ? null : (
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

      {status === "failed" && !hasData && !snapshotLoading ? (
        <Callout status="error" mx="3" my="4">
          The most recent update failed.{" "}
          <Link onClick={() => setQueriesModalOpen(true)}>View queries</Link> to
          see what went wrong.
        </Callout>
      ) : null}

      {(!hasData || !hasValidStatsEngine) &&
        status !== "failed" && // failed is handled above
        status !== "running" &&
        !snapshot?.unknownVariations?.length &&
        hasMetrics &&
        !snapshotLoading && (
          <Callout status="info" mx="3" mb="4">
            No data yet.{" "}
            {!hasValidStatsEngine ? (
              "Stats engine was changed. Try clicking the 'Update' button above to re-run the analysis."
            ) : (
              <>
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
                      relativeDate(
                        experiment.phases[phase]?.dateStarted ?? "",
                      ) +
                      ". Wait until it's been running for a little while and click the 'Update' button above to check again."
                    : "It was just started " +
                      ago(experiment.phases[phase]?.dateStarted ?? "") +
                      ". Give it a little longer and click the 'Update' button above to check again.")}
                {!snapshot &&
                  datasource &&
                  permissionsUtil.canRunExperimentQueries(datasource) &&
                  `Click the "Update" button above.`}
                {snapshotLoading && <div> Snapshot loading...</div>}
              </>
            )}
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
          setVariationFilter={(v: number[]) =>
            setAnalysisBarSettings({
              ...analysisBarSettings,
              variationFilter: v,
            })
          }
          baselineRow={analysisBarSettings.baselineRow}
          setBaselineRow={(b: number) =>
            setAnalysisBarSettings({ ...analysisBarSettings, baselineRow: b })
          }
          snapshot={snapshot}
          analysis={analysis}
          setAnalysisSettings={setAnalysisSettings}
          mutate={mutate}
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
          onRowClick={handleRowClick}
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
            setVariationFilter={(v: number[]) =>
              setAnalysisBarSettings({
                ...analysisBarSettings,
                variationFilter: v,
              })
            }
            baselineRow={analysisBarSettings.baselineRow}
            setBaselineRow={(b: number) =>
              setAnalysisBarSettings({ ...analysisBarSettings, baselineRow: b })
            }
            snapshot={snapshot}
            analysis={analysis}
            setAnalysisSettings={setAnalysisSettings}
            mutate={mutate}
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
            onRowClick={handleRowClick}
          />
        </>
      ) : null}
      {queriesModalOpen && queryStrings.length > 0 && (
        <AsyncQueriesModal
          close={() => setQueriesModalOpen(false)}
          queries={queryStrings}
          savedQueries={[]}
          error={latest?.error}
        />
      )}

      {openMetricDrilldownModalInfo !== null && analysis?.results?.[0] && (
        <MetricDrilldownModal
          row={openMetricDrilldownModalInfo.metricRow}
          close={() => setOpenMetricDrilldownModalInfo(null)}
          initialTab={openMetricDrilldownModalInfo.initialTab}
          // useExperimentTableRows parameters
          results={
            analysis.results[openMetricDrilldownModalInfo.dimensionIndex ?? 0]
          }
          goalMetrics={experiment.goalMetrics}
          secondaryMetrics={experiment.secondaryMetrics}
          guardrailMetrics={experiment.guardrailMetrics}
          metricOverrides={experiment.metricOverrides ?? []}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          customMetricSlices={experiment.customMetricSlices}
          statsEngine={analysis.settings?.statsEngine || DEFAULT_STATS_ENGINE}
          pValueCorrection={pValueCorrection}
          // Initial filter values
          differenceType={analysis.settings?.differenceType || "relative"}
          baselineRow={analysisBarSettings.baselineRow}
          variationFilter={analysisBarSettings.variationFilter}
          // Experiment context
          experimentId={experiment.id}
          phase={phase}
          experimentStatus={experiment.status}
          variations={variations}
          startDate={phaseObj?.dateStarted ?? ""}
          endDate={phaseObj?.dateEnded ?? ""}
          reportDate={snapshot?.dateCreated ?? new Date()}
          isLatestPhase={phase === experiment.phases.length - 1}
          sequentialTestingEnabled={analysis.settings?.sequentialTesting}
          // Initial sorting state
          initialSortBy={sortBy ?? null}
          initialSortDirection={sortDirection ?? null}
          // Slice-specific
          initialSliceSearchTerm={
            openMetricDrilldownModalInfo.initialSliceSearchTerm
          }
          // Dimension info (for BreakDownResults)
          dimensionInfo={openMetricDrilldownModalInfo.dimensionInfo}
        />
      )}
    </>
  );
};

export default Results;
