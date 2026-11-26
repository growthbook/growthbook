import { addDays } from "date-fns";
import { FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS } from "shared/constants";
import { daysBetween } from "shared/dates";
import { analyzeExperimentPower } from "shared/enterprise";
import { tabulateCovariateImbalance } from "shared/health";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotHealth,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentClusterHealthQueryResponseRows,
} from "shared/types/integrations";
import { QueryInterface } from "shared/types/query";
import {
  analyzeExperimentClusterHealth,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";

/**
 * A snapshot's health checks, from its traffic queries and analyzed results.
 * Undefined when the snapshot ran no traffic query.
 */
export function summarizeHealth({
  trafficQuery,
  clusterTrafficQuery,
  clusterHealthQuery,
  settings,
  analyses,
  experimentMaxLengthDays,
}: {
  trafficQuery: QueryInterface | undefined;
  clusterTrafficQuery: QueryInterface | undefined;
  clusterHealthQuery: QueryInterface | undefined;
  settings: ExperimentSnapshotSettings;
  analyses: ExperimentSnapshotAnalysis[];
  experimentMaxLengthDays: number | undefined;
}):
  | { health: ExperimentSnapshotHealth; multipleExposures: number | undefined }
  | undefined {
  if (!trafficQuery) return undefined;

  const rows = trafficQuery.result as ExperimentAggregateUnitsQueryResponseRows;
  const trafficHealth = analyzeExperimentTraffic({
    rows,
    error: trafficQuery.error,
    variations: settings.variations,
  });
  const health: ExperimentSnapshotHealth = { traffic: trafficHealth };
  let multipleExposures = trafficHealth.multipleExposures;

  if (clusterTrafficQuery) {
    health.clusterTraffic = analyzeExperimentTraffic({
      rows: clusterTrafficQuery.result as ExperimentAggregateUnitsQueryResponseRows,
      error: clusterTrafficQuery.error,
      variations: settings.variations,
    });
  }

  if (clusterHealthQuery) {
    const clusterHealth = analyzeExperimentClusterHealth({
      rows: clusterHealthQuery.result as ExperimentClusterHealthQueryResponseRows,
      error: clusterHealthQuery.error,
      variations: settings.variations,
    });
    health.clusterUnits = clusterHealth.clusterUnits;
    health.clusterAssignment = clusterHealth.clusterAssignment;
    health.clusterSubUnitMapping = clusterHealth.clusterSubUnitMapping;
    health.subUnitMultipleExposures = clusterHealth.subUnitMultipleExposures;
    // The traffic query drops any cluster containing a multi-exposed
    // sub-unit, so its count is always 0 here; use the pre-filter count.
    if (!clusterHealth.subUnitMultipleExposures.error) {
      multipleExposures =
        clusterHealth.subUnitMultipleExposures.multipleExposedSubUnits;
    }
  }

  const relativeAnalysis = analyses.find(
    (a) => a.settings.differenceType === "relative",
  );
  if (
    relativeAnalysis &&
    settings.banditSettings === undefined &&
    rows &&
    rows.length
  ) {
    const experimentTargetEndDate = addDays(
      settings.startDate,
      experimentMaxLengthDays && experimentMaxLengthDays > 0
        ? experimentMaxLengthDays
        : FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS,
    );
    health.power = analyzeExperimentPower({
      trafficHealth,
      targetDaysRemaining: daysBetween(new Date(), experimentTargetEndDate),
      analysis: relativeAnalysis,
      goalMetrics: settings.goalMetrics,
      variationsSettings: settings.variations,
    });
  }

  const covariateAnalysis = analyses.find(
    (a) => a.settings.useCovariateAsResponse === true,
  );
  if (covariateAnalysis) {
    health.covariateImbalance = tabulateCovariateImbalance(
      covariateAnalysis,
      settings.goalMetrics,
      settings.guardrailMetrics,
      settings.secondaryMetrics,
      settings.metricSettings,
    );
  }

  return { health, multipleExposures };
}
