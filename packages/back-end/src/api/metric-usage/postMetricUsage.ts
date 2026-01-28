import {
  ApiMetricUsage,
  PostMetricUsageResponse,
} from "shared/types/openapi";
import { postMetricUsageValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ExperimentModel } from "back-end/src/models/ExperimentModel";

interface ExperimentMetricFields {
  id: string;
  project?: string;
  status: string;
  lastSnapshotAttempt?: Date;
  metrics?: string[];
  goalMetrics?: string[];
  guardrails?: string[];
  guardrailMetrics?: string[];
  secondaryMetrics?: string[];
  activationMetric?: string;
}

export const postMetricUsage = createApiRequestHandler(postMetricUsageValidator)(
  async (req): Promise<PostMetricUsageResponse> => {
    const context = req.context;

    const { metricIds } = req.body;

    if (!metricIds || metricIds.length === 0) {
      throw new Error("At least one metric ID is required");
    }

    // Fetch all metric groups once and build a map from metric ID to group IDs
    // This avoids repeated DB calls for each metric
    const allMetricGroups = await context.models.metricGroups.getAll();
    const metricToGroupIds = new Map<string, string[]>();

    // Initialize the map for all requested metrics
    for (const metricId of metricIds) {
      metricToGroupIds.set(metricId, []);
    }

    // Populate the map by iterating through all metric groups
    for (const group of allMetricGroups) {
      for (const metricId of group.metrics || []) {
        const groupIds = metricToGroupIds.get(metricId);
        if (groupIds) {
          groupIds.push(group.id);
        }
      }
    }

    // Build the search criteria: for each metric, search for the metric itself
    // and any metric groups that contain it
    const allSearchIds: string[] = [];
    for (const metricId of metricIds) {
      const groupIds = metricToGroupIds.get(metricId) || [];
      allSearchIds.push(metricId, ...groupIds);
    }

    // Deduplicate search IDs
    const uniqueSearchIds = [...new Set(allSearchIds)];

    // Query all experiments that use any of these metrics/groups in a single query
    const experiments = (await ExperimentModel.find({
      organization: context.org.id,
      $or: [
        { metrics: { $in: uniqueSearchIds } },
        { goalMetrics: { $in: uniqueSearchIds } },
        { guardrails: { $in: uniqueSearchIds } },
        { guardrailMetrics: { $in: uniqueSearchIds } },
        { secondaryMetrics: { $in: uniqueSearchIds } },
        { activationMetric: { $in: uniqueSearchIds } },
      ],
    })
      .select({
        id: 1,
        project: 1,
        status: 1,
        lastSnapshotAttempt: 1,
        metrics: 1,
        goalMetrics: 1,
        guardrails: 1,
        guardrailMetrics: 1,
        secondaryMetrics: 1,
        activationMetric: 1,
      })
      .limit(10000)
      .lean()) as ExperimentMetricFields[];

    // Filter experiments by project permissions
    const filteredExperiments = experiments.filter((exp) =>
      context.permissions.canReadSingleProjectResource(exp.project)
    );

    // Build the response for each requested metric
    const metricUsage: ApiMetricUsage[] = metricIds.map((metricId) => {
      const groupIds = metricToGroupIds.get(metricId) || [];
      const searchIds = new Set([metricId, ...groupIds]);

      // Find experiments that use this metric (directly or via a metric group)
      const matchingExperiments = filteredExperiments.filter((exp) => {
        const expMetrics = [
          ...(exp.metrics || []),
          ...(exp.goalMetrics || []),
          ...(exp.guardrails || []),
          ...(exp.guardrailMetrics || []),
          ...(exp.secondaryMetrics || []),
        ];
        if (exp.activationMetric) {
          expMetrics.push(exp.activationMetric);
        }

        return expMetrics.some((m) => searchIds.has(m));
      });

      // Build the experiments array for the response
      const experimentUsage: ApiMetricUsage["experiments"] =
        matchingExperiments.map((exp) => ({
          experimentId: exp.id,
          experimentStatus: exp.status as "draft" | "running" | "stopped",
          lastSnapshotAttempt: exp.lastSnapshotAttempt
            ? exp.lastSnapshotAttempt.toISOString()
            : null,
        }));

      // Calculate summary statistics
      const nRunningExperiments = experimentUsage.filter(
        (e) => e.experimentStatus === "running"
      ).length;
      const nTotalExperiments = experimentUsage.length;

      // Find the most recent snapshot attempt across all experiments
      const lastSnapshotAttempt = matchingExperiments.reduce<Date | null>(
        (latest, exp) => {
          if (!exp.lastSnapshotAttempt) return latest;
          if (!latest) return exp.lastSnapshotAttempt;
          return exp.lastSnapshotAttempt > latest
            ? exp.lastSnapshotAttempt
            : latest;
        },
        null
      );

      return {
        metricId,
        experiments: experimentUsage,
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
  }
);
