import React, { FC, useMemo } from "react";
import {
  ApiInterleavingInterface,
  InterleavingEstimator,
} from "shared/validators";
import type {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import type { SignificanceThresholds } from "shared/types/stats";
import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import ResultsTable from "@/components/Experiment/ResultsTable";
import { ExperimentTableRow } from "@/services/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";

type Props = {
  interleaving: ApiInterleavingInterface;
  results: ExperimentReportResultDimension[];
  metricEstimators: Record<string, InterleavingEstimator>;
  snapshotDate: Date;
};

const ESTIMATOR_TOOLTIP: Record<InterleavingEstimator, string> = {
  paired:
    "Paired analysis: engagement is joined to individual impressions via interleave_id and analyzed with a paired t-test on per-user credited-metric differences. The estimate is the absolute difference in credited rate per competitive exposure.",
  ownership:
    "Ownership analysis: without interleave_id, engagement is attributed by each user's item-ownership shares across all exposures, and users reduce to which ranker they preferred. The estimate is the net share of users preferring this ranker (sign test).",
};

/**
 * Renders interleaving results through the shared ResultsTable. Variation 0 is
 * the control ranker; variation 1 carries the estimate, CI, and p-value from
 * the paired or ownership estimator.
 */
export const InterleavingResults: FC<Props> = ({
  interleaving,
  results,
  metricEstimators,
  snapshotDate,
}) => {
  const { getExperimentMetricById } = useDefinitions();
  const bayesianConfidenceLevels = useConfidenceLevels(interleaving.project);
  const pValueThreshold = usePValueThreshold(interleaving.project);
  const significanceThresholds: SignificanceThresholds = {
    bayesianConfidenceLevels,
    pValueThreshold,
  };

  const variations: ExperimentReportVariation[] =
    interleaving.variationNames.map((name, index) => ({
      id: String(index),
      name,
      weight: 0.5,
      index,
    }));

  const dimension = results[0];

  const rows: ExperimentTableRow[] = useMemo(() => {
    if (!dimension) return [];
    return interleaving.metrics
      .map(({ id: metricId }) => {
        const metric = getExperimentMetricById(metricId);
        if (!metric) return null;
        const metricVariations: SnapshotMetric[] = dimension.variations.map(
          (v) =>
            v.metrics[metricId] ?? {
              value: 0,
              cr: 0,
              users: 0,
            },
        );
        const row: ExperimentTableRow = {
          label: metric.name,
          metric,
          metricOverrideFields: [],
          variations: metricVariations,
          resultGroup: "goal",
        };
        return row;
      })
      .filter((r): r is ExperimentTableRow => r !== null);
  }, [dimension, interleaving.metrics, getExperimentMetricById]);

  if (!dimension) {
    return (
      <Callout status="info">
        No results yet. Update results to run the analysis.
      </Callout>
    );
  }

  return (
    <ResultsTable
      id={interleaving.id}
      experimentId={interleaving.id}
      significanceThresholds={significanceThresholds}
      variations={variations}
      phase={0}
      isLatestPhase={true}
      status={interleaving.status === "running" ? "running" : "stopped"}
      startDate={interleaving.dateStarted || interleaving.dateCreated}
      endDate={interleaving.dateStopped || ""}
      rows={rows}
      tableRowAxis="metric"
      labelHeader="Metrics"
      renderLabelColumn={({ label, metric }) => {
        const estimator = metricEstimators[metric.id];
        return (
          <Flex align="center" gap="2">
            <span>{label}</span>
            {estimator ? (
              <Tooltip body={ESTIMATOR_TOOLTIP[estimator]}>
                <Badge
                  label={estimator === "paired" ? "Paired" : "Ownership"}
                  color={estimator === "paired" ? "green" : "violet"}
                  variant="soft"
                />
              </Tooltip>
            ) : null}
          </Flex>
        );
      }}
      dateCreated={snapshotDate}
      statsEngine="frequentist"
      differenceType="absolute"
      isTabActive={true}
      noTooltip={true}
      noStickyHeader={true}
    />
  );
};

export default InterleavingResults;
