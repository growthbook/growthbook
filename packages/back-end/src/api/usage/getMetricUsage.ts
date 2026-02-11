import { ApiMetricUsage, GetMetricUsageResponse } from "shared/types/openapi";
import { ExperimentStatus, getMetricUsageValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentMetricById } from "back-end/src/services/experiments";
import { getExperimentsUsingMetrics } from "back-end/src/models/ExperimentModel";

const METRIC_NOT_FOUND_OR_NO_PERMISSION =
  "Metric not found or no permission to read the metric.";

export const getMetricUsage = createApiRequestHandler(getMetricUsageValidator)(
  async (req): Promise<GetMetricUsageResponse> => {
    const context = req.context;

    const metricIds = req.query.ids
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);

    // Check which metrics exist and are readable
    const readableMetricIds = new Set<string>();
    for (const metricId of metricIds) {
      const metric = await getExperimentMetricById(context, metricId);
      if (metric) {
        readableMetricIds.add(metricId);
      }
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

    // Fetch experiments only for readable metrics
    const experiments = await getExperimentsUsingMetrics({
      context,
      metricIds: [...readableMetricIds],
      metricToGroupIds,
      limit: 10000,
    });

    // Build the response for each requested metric
    const metricUsage: ApiMetricUsage[] = metricIds.map((metricId: string) => {
      if (!readableMetricIds.has(metricId)) {
        return {
          metricId,
          error: METRIC_NOT_FOUND_OR_NO_PERMISSION,
        };
      }

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
