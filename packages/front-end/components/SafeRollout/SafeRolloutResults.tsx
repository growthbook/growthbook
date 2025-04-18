import React, { FC, useState } from "react";
import dynamic from "next/dynamic";
import { Box, Flex, Text } from "@radix-ui/themes";
import { getValidDate, ago, relativeDate } from "shared/dates";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricSnapshotSettings } from "back-end/types/report";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";
import Link from "@/components/Radix/Link";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/components/Radix/Callout";
import { useSafeRolloutSnapshot } from "./SnapshotProvider";
import SafeRolloutAnalysisSettingsSummary from "./AnalysisSettingsSummary";

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
  safeRollout: SafeRolloutInterface;
  draftMode?: boolean;
}> = ({ safeRollout, draftMode = false }) => {
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
  } = useSafeRolloutSnapshot();

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

  const showCompactResults = !draftMode && hasData && snapshot && analysis;

  const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(false);

  if (error) {
    return (
      <Callout status="error" mx="3" my="4">
        {error.message}
      </Callout>
    );
  }

  const datasource = getDatasourceById(safeRollout.datasourceId);

  const hasMetrics = safeRollout?.guardrailMetricIds?.length > 0;

  // TODO: how to integrate this and experiment status indicator?
  // const statusIndicatorData: StatusIndicatorData = (() => {
  //   switch (safeRollout.status) {
  //     case "running":
  //       return {
  //         color: "indigo",
  //         status: "Running",
  //         sortOrder: 1,
  //       };
  //     case "released":
  //       return {
  //         color: "green",
  //         status: "Stopped",
  //         detailedStatus: "Released",
  //         sortOrder: 1,
  //       };
  //     case "rolled-back":
  //       return {
  //         color: "red",
  //         status: "Stopped",
  //         detailedStatus: "Rolled Back",
  //         sortOrder: 1,
  //       };
  //     case "completed":
  //       return {
  //         color: "gold",
  //         status: "Stopped",
  //         detailedStatus: "Completed",
  //         sortOrder: 1,
  //       };
  //     case "draft":
  //       return {
  //         color: "gray",
  //         status: "Draft",
  //         sortOrder: 1,
  //       };
  //   }
  // })();

  return (
    <>
      <Flex align="center" justify="between">
        <Text weight="medium" size="3">
          Analysis
        </Text>
        <Link
          weight="medium"
          onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
        >
          Show {isAnalysisExpanded ? "less" : "more"}
        </Link>
      </Flex>
      {/* <Box mt="3">
        <RawExperimentStatusIndicator
          statusIndicatorData={statusIndicatorData}
        />
      </Box> */}
      {isAnalysisExpanded ? (
        <Box
          mt="3"
          style={{
            border: "1px solid var(--slate-a4)",
            borderRadius: "var(--radius-2)",
          }}
        >
          <SafeRolloutAnalysisSettingsSummary
            safeRollout={safeRollout}
            mutate={mutate}
          />

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
              variations={SAFE_ROLLOUT_VARIATIONS}
              results={analysis.results[0]}
              queryStatusData={queryStatusData}
              reportDate={snapshot.dateCreated}
              startDate={safeRollout.startedAt?.toDateString() ?? ""}
              isLatestPhase={true}
              status={safeRollout.status === "running" ? "running" : "stopped"}
              goalMetrics={[]}
              secondaryMetrics={[]}
              guardrailMetrics={safeRollout.guardrailMetricIds}
              metricOverrides={[]}
              id={safeRollout.id}
              statsEngine={"frequentist"}
              pValueCorrection={pValueCorrection}
              regressionAdjustmentEnabled={
                analysis.settings?.regressionAdjusted
              }
              settingsForSnapshotMetrics={settingsForSnapshotMetrics}
              experimentType={"standard"}
            />
          ) : null}
        </Box>
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
