import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { FC, useEffect } from "react";
import dynamic from "next/dynamic";
import { DifferenceType, StatsEngine } from "back-end/types/stats";
import { getValidDate, ago, relativeDate } from "shared/dates";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { MetricSnapshotSettings } from "back-end/types/report";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import FilterSummary from "@/components/Experiment/FilterSummary";
import DateResults from "@/components/Experiment/DateResults";
import VariationIdWarning from "@/components/Experiment/VariationIdWarning";
import AnalysisSettingsBar from "@/components/Experiment/AnalysisSettingsBar";
import StatusBanner from "@/components/Experiment/StatusBanner";
import { GBCuped, GBSequential } from "@/components/Icons";
import useOrgSettings from "@/hooks/useOrgSettings";
import { trackSnapshot } from "@/services/track";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import { ExperimentTab } from "./TabbedPage";

const BreakDownResults = dynamic(
  () => import("@/components/Experiment/BreakDownResults")
);
const CompactResults = dynamic(
  () => import("@/components/Experiment/CompactResults")
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
  variationFilter?: number[];
  setVariationFilter?: (variationFilter: number[]) => void;
  baselineRow?: number;
  setBaselineRow?: (baselineRow: number) => void;
  differenceType?: DifferenceType;
  setDifferenceType?: (differenceType: DifferenceType) => void;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (metricFilter: ResultsMetricFilters) => void;
  isTabActive?: boolean;
  setTab?: (tab: ExperimentTab) => void;
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
  variationFilter,
  setVariationFilter,
  baselineRow,
  setBaselineRow,
  differenceType,
  setDifferenceType,
  metricFilter,
  setMetricFilter,
  isTabActive = true,
  setTab,
}) => {
  const { apiCall } = useAuth();

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
      regressionAdjustmentEnabled: !!m.computedSettings
        ?.regressionAdjustmentEnabled,
      regressionAdjustmentAvailable: !!m.computedSettings
        ?.regressionAdjustmentAvailable,
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
    snapshot?.dimension &&
    snapshot.dimension.substring(0, 8) !== "pre:date" && // todo: refactor hardcoded dimension
    analysis?.settings?.dimensions?.length; // todo: needed? separate desired vs actual

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
          variationFilter={variationFilter}
          setVariationFilter={(v: number[]) => setVariationFilter?.(v)}
          baselineRow={baselineRow}
          setBaselineRow={(b: number) => setBaselineRow?.(b)}
          differenceType={differenceType}
          setDifferenceType={setDifferenceType}
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
                isBandit ? "Bandit" : "Experiment"
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
              res.snapshot
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
      ) : showBreakDownResults ? (
        <BreakDownResults
          key={snapshot.dimension}
          results={analysis?.results ?? []}
          queryStatusData={queryStatusData}
          variations={variations}
          variationFilter={variationFilter}
          baselineRow={baselineRow}
          goalMetrics={experiment.goalMetrics}
          secondaryMetrics={experiment.secondaryMetrics}
          guardrailMetrics={experiment.guardrailMetrics}
          metricOverrides={experiment.metricOverrides ?? []}
          dimensionId={snapshot.dimension ?? ""}
          isLatestPhase={phase === experiment.phases.length - 1}
          startDate={phaseObj?.dateStarted ?? ""}
          endDate={phaseObj?.dateEnded ?? ""}
          reportDate={snapshot.dateCreated}
          activationMetric={experiment.activationMetric}
          status={experiment.status}
          statsEngine={analysis.settings.statsEngine}
          pValueCorrection={pValueCorrection}
          regressionAdjustmentEnabled={analysis?.settings?.regressionAdjusted}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          sequentialTestingEnabled={analysis?.settings?.sequentialTesting}
          differenceType={analysis.settings?.differenceType}
          metricFilter={metricFilter}
          setMetricFilter={setMetricFilter}
          isBandit={isBandit}
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
            editMetrics={editMetrics}
            variations={variations}
            variationFilter={variationFilter}
            baselineRow={baselineRow}
            multipleExposures={snapshot.multipleExposures || 0}
            results={analysis.results[0]}
            queryStatusData={queryStatusData}
            reportDate={snapshot.dateCreated}
            startDate={phaseObj?.dateStarted ?? ""}
            endDate={phaseObj?.dateEnded ?? ""}
            isLatestPhase={phase === experiment.phases.length - 1}
            status={experiment.status}
            goalMetrics={experiment.goalMetrics}
            secondaryMetrics={experiment.secondaryMetrics}
            guardrailMetrics={experiment.guardrailMetrics}
            metricOverrides={experiment.metricOverrides ?? []}
            id={experiment.id}
            statsEngine={analysis.settings.statsEngine}
            pValueCorrection={pValueCorrection}
            regressionAdjustmentEnabled={analysis.settings?.regressionAdjusted}
            settingsForSnapshotMetrics={settingsForSnapshotMetrics}
            sequentialTestingEnabled={analysis.settings?.sequentialTesting}
            differenceType={analysis.settings?.differenceType}
            metricFilter={metricFilter}
            setMetricFilter={setMetricFilter}
            isTabActive={isTabActive}
            setTab={setTab}
            experimentType={experiment.type}
          />
        </>
      ) : null}

      {!draftMode && hasData ? (
        <div className="row align-items-center mx-2 my-3">
          <div className="col-auto small" style={{ lineHeight: 1.2 }}>
            <div className="text-muted mb-1">
              The above results were computed with:
            </div>
            <div>
              <span className="text-muted">Engine:</span>{" "}
              <span>
                {analysis?.settings?.statsEngine === "frequentist"
                  ? "Frequentist"
                  : "Bayesian"}
              </span>
            </div>
            <div>
              <span className="text-muted">
                <GBCuped size={13} /> CUPED:
              </span>{" "}
              <span>
                {analysis?.settings?.regressionAdjusted
                  ? "Enabled"
                  : "Disabled"}
              </span>
            </div>
            {analysis?.settings?.statsEngine === "frequentist" && (
              <div>
                <span className="text-muted">
                  <GBSequential size={13} /> Sequential:
                </span>{" "}
                <span>
                  {analysis?.settings?.sequentialTesting
                    ? "Enabled"
                    : "Disabled"}
                </span>
              </div>
            )}
            <div>
              <span className="text-muted">Run date:</span>{" "}
              <span>
                {getValidDate(snapshot?.dateCreated ?? "").toLocaleString([], {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default Results;

// given an ordered list of tags, sort the metrics by their tags
export type ResultsMetricFilters = {
  tagOrder?: string[];
  filterByTag?: boolean;
  tagFilter?: string[] | null; // if null, use tagOrder
};
export function sortAndFilterMetricsByTags(
  metrics: ExperimentMetricInterface[],
  filters?: ResultsMetricFilters
): string[] {
  let { tagOrder, filterByTag, tagFilter } = filters || {};
  // normalize input
  if (!tagOrder) tagOrder = [];
  if (!filterByTag) filterByTag = false;
  if (!tagFilter) tagFilter = null;

  if (filterByTag && !tagFilter) {
    tagFilter = tagOrder;
  }
  const sortedMetrics: string[] = [];

  const metricsByTag: Record<string, string[]> = {};
  const metricDefs: Record<string, ExperimentMetricInterface> = {};

  // get all possible tags from the metric definitions
  const tagsInMetrics: Set<string> = new Set();
  const allMetrics: ExperimentMetricInterface[] = [];
  metrics.forEach((metric) => {
    if (!metric) return;
    metricDefs[metric.id] = metric;
    allMetrics.push(metric);
    metric.tags?.forEach((tag) => {
      tagsInMetrics.add(tag);
    });
  });

  // reduce tagOrder to only the tags that are in the metrics
  tagOrder = tagOrder.filter((tag) => tagsInMetrics.has(tag));

  // using tagOrder, build our initial set of sorted metrics
  if (tagOrder?.length) {
    tagOrder.forEach((tag) => {
      metricsByTag[tag] = [];
      for (const metricId in metricDefs) {
        const metric = metricDefs[metricId];
        if (metric.tags?.includes(tag)) {
          if (filterByTag && !tagFilter?.includes(tag)) {
            continue;
          }
          // pick out the metrics that match the tag
          metricsByTag[tag].push(metricId);
          delete metricDefs[metricId];
        }
      }
    });
    for (const tag in metricsByTag) {
      sortedMetrics.push(...metricsByTag[tag]);
    }
  }

  // add any remaining metrics to the end
  for (const i in allMetrics) {
    const metric = allMetrics[i];
    if (filterByTag) {
      if (metric.tags?.some((tag) => tagFilter?.includes(tag))) {
        sortedMetrics.push(metric.id);
      }
    } else {
      sortedMetrics.push(metric.id);
    }
  }

  return sortedMetrics;
}
