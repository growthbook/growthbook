import React, { FC } from "react";
import dynamic from "next/dynamic";
import { getValidDate, ago, relativeDate } from "shared/dates";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricSnapshotSettings } from "back-end/types/report";
import { SafeRolloutRule } from "back-end/src/validators/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import { ExperimentTab } from "../Experiment/TabbedPage";
import { useSnapshot } from "./SnapshotProvider";
import AnalysisSettingsSummary from "./AnalysisSettingsSummary";

const CompactResults = dynamic(
  () => import("@/components/SafeRollout/Results/CompactResults")
);

const SAFE_ROLLOUT_VARIATIONS = [
  {
    id: "0",
    name: "Control",
    weight: 0.5,
  },
  {
    id: "1",
    name: "Variation",
    weight: 0.5,
  },
];

const SafeRolloutResults: FC<{
  safeRollout: SafeRolloutRule;
  draftMode?: boolean;
  editMetrics?: () => void;
  metricFilter?: ResultsMetricFilters;
  setMetricFilter?: (metricFilter: ResultsMetricFilters) => void;
  isTabActive?: boolean;
  setTab?: (tab: ExperimentTab) => void;
}> = ({
  safeRollout,
  draftMode = false,
  editMetrics,
  metricFilter,
  setMetricFilter,
  isTabActive = true,
  setTab,
}) => {
  // todo: move to snapshot property
  const orgSettings = useOrgSettings();
  const pValueCorrection = orgSettings?.pValueCorrection;

  const {
    error,
    snapshot,
    latest,
    analysis,
    mutateSnapshot: mutate,
    loading: snapshotLoading,
  } = useSnapshot();

  const queryStatusData = getQueryStatus(latest?.queries || [], latest?.error);

  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();

  const { status } = getQueryStatus(latest?.queries || [], latest?.error);

  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  const phaseAgeMinutes =
    (Date.now() - getValidDate(safeRollout.startedAt ?? "").getTime()) /
    (1000 * 60);

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

  if (error) {
    return (
      <Callout status="error" mx="3" my="4">
        {error.message}
      </Callout>
    );
  }

  const datasource = getDatasourceById(safeRollout.datasource);

  const hasMetrics = safeRollout.guardrailMetrics.length > 0;

  return (
    <>
      <h3>Analysis</h3>
      <AnalysisSettingsSummary safeRollout={safeRollout} mutate={mutate} />
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

      {!hasData && status !== "running" && hasMetrics && !snapshotLoading && (
        <Callout status="info" mx="3" my="4">
          No data yet.{" "}
          {snapshot &&
            phaseAgeMinutes >= 120 &&
            "Make sure your safe rollout is tracking properly."}
          {snapshot &&
            phaseAgeMinutes < 120 &&
            (phaseAgeMinutes < 0
              ? "This safe rollout will start " +
                relativeDate(safeRollout.startedAt ?? "") +
                ". Wait until it's been running for a little while and click the 'Update' button above to check again."
              : "It was just started " +
                ago(safeRollout.startedAt ?? "") +
                ". Give it a little longer and click the 'Update' button above to check again.")}
          {!snapshot &&
            datasource &&
            permissionsUtil.canRunExperimentQueries(datasource) &&
            `Click the "Update" button above.`}
          {snapshotLoading && <div> Snapshot loading...</div>}
        </Callout>
      )}

      {showCompactResults ? (
        <CompactResults
          editMetrics={editMetrics}
          variations={SAFE_ROLLOUT_VARIATIONS}
          multipleExposures={snapshot.multipleExposures || 0}
          results={analysis.results[0]}
          queryStatusData={queryStatusData}
          reportDate={snapshot.dateCreated}
          startDate={safeRollout.startedAt ?? ""} // TODO: investigate why its a string by this point
          isLatestPhase={true}
          status={safeRollout.status === "running" ? "running" : "stopped"}
          goalMetrics={[]}
          secondaryMetrics={[]}
          guardrailMetrics={safeRollout.guardrailMetrics}
          metricOverrides={[]}
          id={safeRollout.id}
          statsEngine={"frequentist"}
          pValueCorrection={pValueCorrection}
          regressionAdjustmentEnabled={analysis.settings?.regressionAdjusted}
          settingsForSnapshotMetrics={settingsForSnapshotMetrics}
          sequentialTestingEnabled={true}
          differenceType={"absolute"}
          metricFilter={metricFilter}
          setMetricFilter={setMetricFilter}
          isTabActive={isTabActive}
          setTab={setTab}
          experimentType={"standard"}
        />
      ) : null}
    </>
  );
};

export default SafeRolloutResults;

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
