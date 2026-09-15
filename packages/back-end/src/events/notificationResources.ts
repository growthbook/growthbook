import { z } from "zod";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  parseFunnelStepMetricId,
  parseSliceMetricId,
} from "shared/experiments";
import {
  ApiExperiment,
  ApiExperimentMetric,
  experimentAnalysisSettings,
  FeatureRule,
  NotificationResourceFilters,
} from "shared/validators";
import type { EventInterface } from "shared/types/events/event";
import type { ReqContext } from "back-end/types/request";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";

const experimentMetricIds = (
  config: Parameters<typeof getAllMetricIdsFromExperiment>[0],
) => getAllMetricIdsFromExperiment(config, true, []);

// Older API snapshots store metric IDs directly instead of metric objects.
const apiMetricId = (metric: Pick<ApiExperimentMetric, "metricId"> | string) =>
  typeof metric === "string" ? metric : metric.metricId;

function apiExperimentMetricIds(settings: ApiExperiment["settings"]) {
  return experimentMetricIds({
    goalMetrics: settings.goals?.map(apiMetricId),
    secondaryMetrics: settings.secondaryMetrics?.map(
      ({ metricId }) => metricId,
    ),
    guardrailMetrics: settings.guardrails?.map(apiMetricId),
    activationMetric: settings.activationMetric
      ? apiMetricId(settings.activationMetric)
      : null,
  });
}

const ruleMetricIds = (rule: FeatureRule) =>
  rule.type === "experiment" ? experimentMetricIds(rule) : [];

// Historical feature webhook schemas leave nested rules untyped. Parse only
// their relationship fields, preserving compatibility with older rule layouts.
const webhookRuleResources = experimentAnalysisSettings
  .pick({
    goalMetrics: true,
    secondaryMetrics: true,
    guardrailMetrics: true,
    activationMetric: true,
  })
  .partial()
  .strip()
  .extend({ type: z.string(), experimentId: z.string().optional() });
const webhookRules = z.union([
  z.array(webhookRuleResources),
  z
    .record(z.string(), z.array(webhookRuleResources))
    .transform((rules) => Object.values(rules).flat()),
]);
const webhookEnvironments = z.record(
  z.string(),
  z.object({ rules: z.array(webhookRuleResources).optional() }),
);

function notificationPayload(event: EventInterface) {
  if (event.version) return event.data;
  const legacy = event.data;
  switch (legacy.object) {
    case "experiment": {
      const data = legacy.data;
      return {
        object: legacy.object,
        data: {
          object:
            "current" in data
              ? data.current
              : "previous" in data
                ? data.previous
                : data,
        },
      };
    }
    case "feature": {
      const data = legacy.data;
      return {
        object: legacy.object,
        data: { object: "current" in data ? data.current : data.previous },
      };
    }
    case "user":
    case "webhook":
      return null;
  }
}

export const baseMetricId = (id: string) =>
  parseSliceMetricId(parseFunnelStepMetricId(id).baseMetricId).baseMetricId;

export async function getNotificationResources(
  context: ReqContext,
  event: EventInterface,
  filters: NotificationResourceFilters,
): Promise<Required<NotificationResourceFilters>> {
  const payload = notificationPayload(event);
  const related: Required<NotificationResourceFilters> = {
    experiments: [],
    features: [],
    metrics: [],
  };
  if (!payload) return related;
  if (payload.object === "experiment") {
    const object = payload.data.object;
    const id =
      event.objectId ?? ("id" in object ? object.id : object.experimentId);
    if (id) related.experiments = [id];
    if ("metricId" in object) related.metrics.push(object.metricId);
    if ("settings" in object)
      related.metrics.push(...apiExperimentMetricIds(object.settings));
    if (id && (filters.features?.length || filters.metrics?.length)) {
      const experiments = await getExperimentsByIds(context, [id]);
      related.features = experiments.length
        ? experiments.flatMap((experiment) => experiment.linkedFeatures || [])
        : "linkedFeatures" in object
          ? object.linkedFeatures || []
          : [];
      if (filters.metrics?.length)
        related.metrics.push(...experiments.flatMap(experimentMetricIds));
    }
  } else if (payload.object === "feature") {
    const object = payload.data.object;
    const id =
      event.objectId ??
      ("featureId" in object
        ? object.featureId
        : "id" in object
          ? object.id
          : null);
    if (id) related.features = [id];
    if (id && (filters.experiments?.length || filters.metrics?.length)) {
      const feature = await getFeature(context, id);
      const rules = feature
        ? feature.rules
        : "rules" in object
          ? webhookRules.parse(object.rules)
          : "environments" in object
            ? Object.values(
                webhookEnvironments.parse(object.environments),
              ).flatMap((env) => env.rules || [])
            : [];
      related.experiments =
        feature?.linkedExperiments ??
        event.relatedResources?.experiments ??
        rules.flatMap((rule) =>
          rule.type === "experiment-ref" && rule.experimentId
            ? [rule.experimentId]
            : [],
        );
      if (filters.metrics?.length) {
        const [rollouts, experiments] = await Promise.all([
          context.models.safeRollout.getAllByFeatureId(id),
          getExperimentsByIds(context, related.experiments),
        ]);
        related.metrics.push(
          ...(feature
            ? feature.rules.flatMap(ruleMetricIds)
            : rules.flatMap(experimentMetricIds)),
          ...rollouts.flatMap((rollout) => rollout.guardrailMetricIds),
          ...experiments.flatMap(experimentMetricIds),
        );
      }
    }
  }
  if (filters.metrics?.length) {
    const groups = related.metrics.some((id) => id.startsWith("mg_"))
      ? await context.models.metricGroups.getAll()
      : [];
    related.metrics = [
      ...new Set(
        [
          ...related.metrics,
          ...expandMetricGroups(related.metrics, groups),
        ].map(baseMetricId),
      ),
    ];
  }
  return related;
}
