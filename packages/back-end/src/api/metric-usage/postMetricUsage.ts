import { ApiMetricUsage, PostMetricUsageResponse } from "shared/types/openapi";
import { postMetricUsageValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentsUsingMetrics } from "back-end/src/models/ExperimentModel";

export const postMetricUsage = createApiRequestHandler(
  postMetricUsageValidator,
)(async (req): Promise<PostMetricUsageResponse> => {
  const context = req.context;

  const { metricIds } = req.body;

  if (!metricIds || metricIds.length === 0) {
    throw new Error("At least one metric ID is required");
  }

  // Fetch all metric groups once and build a map from metric ID to group IDs
  // This is needed to match experiments that use metric groups containing our metrics
  const metricToGroupIds = new Map<string, string[]>();
  for (const metricId of metricIds) {
    metricToGroupIds.set(metricId, []);
  }

  const allMetricGroups = await context.models.metricGroups.getAll();
  for (const group of allMetricGroups) {
    for (const metricId of group.metrics || []) {
      const groupIds = metricToGroupIds.get(metricId);
      if (groupIds) {
        groupIds.push(group.id);
      }
    }
  }

  // Fetch experiments for all metrics in a single batch query
  // Only select the fields we need for the response
  const experiments = await getExperimentsUsingMetrics({
    context,
    metricIds,
    allMetricGroups,
    limit: 10000,
  });

  // Build the response for each requested metric
  const metricUsage: ApiMetricUsage[] = metricIds.map((metricId) => {
    const groupIds = metricToGroupIds.get(metricId) || [];
    const searchIds = new Set([metricId, ...groupIds]);

    // Find experiments that use this metric (directly or via a metric group)
    const matchingExperiments = experiments.filter((exp) => {
      const expMetrics = [
        ...(exp.goalMetrics || []),
        ...(exp.guardrailMetrics || []),
        ...(exp.secondaryMetrics || []),
      ];
      if (exp.activationMetric) {
        expMetrics.push(exp.activationMetric);
      }
      return expMetrics.some((m) => searchIds.has(m));
    });

    // Build the experiments array for the response
    const experimentList = matchingExperiments.map((exp) => ({
      experimentId: exp.id,
      experimentStatus: exp.status as "draft" | "running" | "stopped",
      lastSnapshotAttempt: exp.lastSnapshotAttempt
        ? exp.lastSnapshotAttempt.toISOString()
        : null,
    }));

    // Calculate summary statistics
    const nRunningExperiments = experimentList.filter(
      (e) => e.experimentStatus === "running",
    ).length;
    const nTotalExperiments = experimentList.length;

    // Find the most recent snapshot attempt across all experiments
    const lastSnapshotAttempt = matchingExperiments.reduce<Date | null>(
      (latest, exp) => {
        if (!exp.lastSnapshotAttempt) return latest;
        if (!latest) return exp.lastSnapshotAttempt;
        return exp.lastSnapshotAttempt > latest
          ? exp.lastSnapshotAttempt
          : latest;
      },
      null,
    );

    return {
      metricId,
      experiments: experimentList,
      nRunningExperiments,
      nTotalExperiments,
      lastSnapshotAttempt: lastSnapshotAttempt
        ? lastSnapshotAttempt.toISOString()
        : null,
    };
  });

  return {
    metricUsage,
  };
});
