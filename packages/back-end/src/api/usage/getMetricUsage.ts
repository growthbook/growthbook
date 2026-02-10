import { ApiMetricUsage, GetMetricUsageResponse } from "shared/types/openapi";
import { ExperimentStatus, getMetricUsageValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentsUsingMetrics } from "back-end/src/models/ExperimentModel";

export const getMetricUsage = createApiRequestHandler(getMetricUsageValidator)(
  async (req): Promise<GetMetricUsageResponse> => {
    const context = req.context;

    const metricIds = req.query.ids.split(",");

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
      metricToGroupIds,
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
        experimentStatus: exp.status as ExperimentStatus,
        lastSnapshotAttempt: exp.lastSnapshotAttempt
          ? exp.lastSnapshotAttempt.toISOString()
          : null,
      }));

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
        lastSnapshotAttempt: lastSnapshotAttempt
          ? lastSnapshotAttempt.toISOString()
          : null,
      };
    });

    return {
      metricUsage,
    };
  },
);
