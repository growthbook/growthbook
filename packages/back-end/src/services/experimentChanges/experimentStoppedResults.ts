import { getSnapshotAnalysis } from "shared/util";
import { expandMetricGroups, isMetricGroupId } from "shared/experiments";
import type { ExperimentInterface } from "shared/types/experiment";
import type { SnapshotMetric } from "shared/types/experiment-snapshot";
import type { ExperimentStoppedGoalMetric } from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import { getSignificanceSettingsForProject } from "back-end/src/services/organizations";
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
    const [goalId] = await getExpandedGoalMetricIds(context, experiment);
    if (!goalId) return undefined;
    const snapshot = await getLatestSuccessfulSnapshot({
      context,
      experiment: experiment.id,
      phase: experiment.phases.length - 1,
      type: "standard",
    });
    const analysis = snapshot ? getSnapshotAnalysis(snapshot) : null;
    const dim = analysis?.results?.[0];
    if (!snapshot || !analysis || !dim) return undefined;
    const controlStats = dim.variations[0]?.metrics?.[goalId];
    if (!controlStats) return undefined;
    const [[metric], significance] = await Promise.all([
      getExperimentMetricsByIds(context, [goalId]),
      getSignificanceSettingsForProject(context, experiment.project),
    ]);
    const control = experiment.variations[0];
    if (!control) return undefined;

    // Same rule the results table colors by: chance to win outside the
    // configured bounds, or a p-value under the threshold the analysis ran with.
    const frequentist = analysis.settings.statsEngine === "frequentist";
    const pValueThreshold =
      analysis.settings.pValueThreshold ?? significance.pValueThreshold;
    const isSignificant = (stats: SnapshotMetric): boolean | undefined => {
      if (frequentist) {
        const pValue = stats.pValueAdjusted ?? stats.pValue;
        return pValue === undefined ? undefined : pValue < pValueThreshold;
      }
      return stats.chanceToWin === undefined
        ? undefined
        : stats.chanceToWin >= significance.ciUpper ||
            stats.chanceToWin <= significance.ciLower;
    };

    const variations: ExperimentStoppedGoalMetric["variations"] = [];
    for (let i = 1; i < experiment.variations.length; i++) {
      const variation = experiment.variations[i];
      const stats = dim.variations[i]?.metrics?.[goalId];
      if (!variation || !stats) continue;
      const ci = stats.ciAdjusted ?? stats.ci;
      const pValue = stats.pValueAdjusted ?? stats.pValue;
      const significant = isSignificant(stats);
      variations.push({
        variationId: variation.id,
        variationName: variation.name,
        variationIndex: i,
        users: stats.users,
        value: metricMean(stats),
        ...(stats.expected !== undefined ? { uplift: stats.expected } : {}),
        ...(stats.uplift?.stddev !== undefined
          ? { upliftStddev: stats.uplift.stddev }
          : {}),
        ...(ci ? { ci: [ci[0], ci[1]] as [number, number] } : {}),
        ...(stats.chanceToWin !== undefined
          ? { chanceToWin: stats.chanceToWin }
          : {}),
        ...(pValue !== undefined ? { pValue } : {}),
        ...(significant !== undefined ? { significant } : {}),
      });
    }
    if (!variations.length) return undefined;

    const traffic = snapshot.health?.traffic?.overall?.variationUnits;
    const totalUsers = traffic?.length
      ? traffic.reduce((sum, n) => sum + n, 0)
      : dim.variations.reduce((sum, v) => sum + (v.users || 0), 0) || undefined;

    return {
      totalUsers,
      goalMetric: {
        metricId: goalId,
        metricName: metric?.name ?? goalId,
        snapshotId: snapshot.id,
        statsEngine: analysis.settings.statsEngine,
        differenceType: analysis.settings.differenceType,
        control: {
          variationId: control.id,
          variationName: control.name,
          users: controlStats.users,
          value: metricMean(controlStats),
        },
        variations,
      },
    };
  } catch (error) {
    logger.warn(error, "Failed to capture goal metric results for stop event");
    return undefined;
  }
}
