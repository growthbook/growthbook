import { getSnapshotAnalysis } from "shared/util";
import {
  expandMetricGroups,
  getMetricResultStatus,
  isFactMetric,
  isMetricGroupId,
  resolveSnapshotMetricIds,
  resolveSnapshotVariation,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { getExperimentVariationUnitsFromHealth } from "shared/health";
import cloneDeep from "lodash/cloneDeep";
import type { ExperimentInterface } from "shared/types/experiment";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import type { ExperimentStoppedGoalMetric } from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import {
  getMetricDefaultsForOrg,
  getSignificanceSettingsForProject,
} from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

const metricMean = (m: SnapshotMetric): number =>
  Number.isFinite(m.cr) ? m.cr : m.value / (m.users || 1);

// Expanded goal metric ids for an experiment (metric groups resolved).
export async function getExpandedGoalMetricIds(
  context: Context,
  experiment: ExperimentInterface,
): Promise<string[]> {
  const metricGroups = experiment.goalMetrics.some(isMetricGroupId)
    ? await context.models.metricGroups.getAll()
    : [];
  return expandMetricGroups(experiment.goalMetrics, metricGroups);
}

// Resolve the goal metric names in experiment order, dropping ids that no
// longer resolve. Returns [] when nothing can be resolved.
export async function getGoalMetricNames(
  context: Context,
  experiment: ExperimentInterface,
): Promise<string[]> {
  try {
    const ids = await getExpandedGoalMetricIds(context, experiment);
    if (!ids.length) return [];
    const metrics = await getExperimentMetricsByIds(context, ids);
    const byId = new Map(metrics.map((m) => [m.id, m.name]));
    return ids.map((id) => byId.get(id)).filter((n): n is string => !!n);
  } catch (error) {
    logger.warn(error, "Failed to resolve goal metric names for notification");
    return [];
  }
}

// Capture the top goal metric's results from the latest successful snapshot
// so the stop notification carries immutable evidence. Returns undefined when
// there is no usable snapshot; the notification then falls back to text.
export async function getStoppedGoalMetricResults(
  context: Context,
  experiment: ExperimentInterface,
): Promise<
  | { goalMetric: ExperimentStoppedGoalMetric; totalUsers: number | undefined }
  | undefined
> {
  try {
    const goalIds = await getExpandedGoalMetricIds(context, experiment);
    if (!goalIds.length) return undefined;
    const [goalMetrics, significance] = await Promise.all([
      getExperimentMetricsByIds(context, goalIds),
      getSignificanceSettingsForProject(context, experiment.project),
    ]);
    const metricsById = new Map(goalMetrics.map((m) => [m.id, m]));
    const getMetric = (id: string) => metricsById.get(id) ?? null;
    // A snapshot from before a goal metric was swapped for its replacement
    // still holds results under the old id, so load those chunks too.
    const replacedIds = goalMetrics.flatMap((m) =>
      isFactMetric(m) ? (m.replaces ?? []) : [],
    );
    const snapshot = await getLatestSuccessfulSnapshot({
      context,
      experiment: experiment.id,
      phase: experiment.phases.length - 1,
      type: "standard",
      // The p-value correction spans every goal metric, so load them all
      // (but not secondaries or guardrails).
      metricIds: [...goalIds, ...replacedIds],
    });
    const analysis = snapshot ? getSnapshotAnalysis(snapshot) : null;
    if (!snapshot || !analysis?.results?.length) return undefined;

    // The same substitution the results table makes for replaced metrics.
    const resolvedGoalIds = resolveSnapshotMetricIds({
      metricIds: goalIds,
      getExperimentMetricById: getMetric,
      results: analysis.results,
    });
    const [goalId] = goalIds;
    const [resultId] = resolvedGoalIds;
    const metric = getMetric(goalId);

    // Judge significance the way the results table does: correct the
    // p-values across the goal metrics and widen the CIs before comparing.
    const results = cloneDeep(analysis.results);
    const pValueThreshold =
      analysis.settings.pValueThreshold ?? significance.pValueThreshold;
    setAdjustedPValuesOnResults(
      results,
      resolvedGoalIds,
      significance.pValueCorrection,
    );
    setAdjustedCIs(results, pValueThreshold);
    const dim = results[0];

    // Result columns follow the snapshot's variation keys, not the
    // experiment's current order.
    const variationAt = (column: number) =>
      resolveSnapshotVariation(
        experiment.variations,
        snapshot.settings.variations,
        column,
      );
    const control = variationAt(0)?.variation;
    const controlStats = dim?.variations[0]?.metrics?.[resultId];
    if (!dim || !control || !controlStats) return undefined;

    const metricDefaults = getMetricDefaultsForOrg(context);
    const isSignificant = (stats: SnapshotMetric): boolean | undefined =>
      metric
        ? getMetricResultStatus({
            metric,
            metricDefaults,
            baseline: controlStats,
            stats,
            ciLower: significance.ciLower,
            ciUpper: significance.ciUpper,
            pValueThreshold,
            statsEngine: analysis.settings.statsEngine,
            differenceType: analysis.settings.differenceType,
          }).significant
        : undefined;

    // Open CI bounds and saturated p-values come through as +-Infinity, which
    // the payload schema rejects; leave those fields out.
    const finite = (n: number | undefined): number | undefined =>
      n !== undefined && Number.isFinite(n) ? n : undefined;
    const captured: ExperimentStoppedGoalMetric["variations"] = [];
    for (let j = 1; j < dim.variations.length; j++) {
      const resolved = variationAt(j);
      const stats = dim.variations[j]?.metrics?.[resultId];
      if (!resolved || !stats) continue;
      const ci = stats.ciAdjusted ?? stats.ci;
      const uplift = finite(stats.expected);
      const upliftStddev = finite(stats.uplift?.stddev);
      const chanceToWin = finite(stats.chanceToWin);
      const pValue = finite(stats.pValueAdjusted ?? stats.pValue);
      const significant = isSignificant(stats);
      captured.push({
        variationId: resolved.variation.id,
        variationName: resolved.variation.name,
        // Position in experiment.variations, matching experiment.winner.
        variationIndex: resolved.index,
        users: stats.users,
        value: metricMean(stats),
        ...(uplift !== undefined ? { uplift } : {}),
        ...(upliftStddev !== undefined ? { upliftStddev } : {}),
        ...(ci && ci.every(Number.isFinite)
          ? { ci: [ci[0], ci[1]] as [number, number] }
          : {}),
        ...(chanceToWin !== undefined ? { chanceToWin } : {}),
        ...(pValue !== undefined ? { pValue } : {}),
        ...(significant !== undefined ? { significant } : {}),
      });
    }
    if (!captured.length) return undefined;

    const units = getExperimentVariationUnitsFromHealth(snapshot);
    const totalUsers = units?.length
      ? units.reduce((sum, n) => sum + n, 0)
      : undefined;

    return {
      totalUsers,
      goalMetric: {
        metricId: goalId,
        metricName: metric?.name ?? goalId,
        ...(metric?.inverse ? { inverse: true } : {}),
        snapshotId: snapshot.id,
        statsEngine: analysis.settings.statsEngine,
        differenceType: analysis.settings.differenceType,
        control: {
          variationId: control.id,
          variationName: control.name,
          users: controlStats.users,
          value: metricMean(controlStats),
        },
        variations: captured,
      },
    };
  } catch (error) {
    logger.warn(error, "Failed to capture goal metric results for stop event");
    return undefined;
  }
}
