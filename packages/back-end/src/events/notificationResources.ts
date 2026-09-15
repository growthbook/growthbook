import { z } from "zod";
import {
  expandMetricGroups,
  parseFunnelStepMetricId,
  parseSliceMetricId,
} from "shared/experiments";
import type { NotificationResourceFilters } from "shared/validators";
import type { EventInterface } from "shared/types/events/event";
import type { ReqContext } from "back-end/types/request";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";

const recordSchema = z.record(z.string(), z.unknown());
const record = (value: unknown): Record<string, unknown> =>
  recordSchema.safeParse(value).data ?? {};
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];

const metricIds = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(metricIds);
  const id = record(value).metricId;
  return typeof id === "string" ? [id] : [];
};

export const metricIdsFromConfig = (value: unknown): string[] => {
  const config = record(value);
  return [
    config.metricId,
    config.metricIds,
    config.metrics,
    config.goals,
    config.goalMetrics,
    config.secondaryMetrics,
    config.guardrails,
    config.guardrailMetrics,
    config.guardrailMetricIds,
    config.activationMetric,
  ].flatMap(metricIds);
};

function payloadRules(value: unknown): Record<string, unknown>[] {
  const object = record(value);
  const rules = object.rules;
  const lists = [
    ...(Array.isArray(rules) ? [rules] : Object.values(record(rules))),
    ...Object.values(record(object.environments)).map(
      (env) => record(env).rules,
    ),
  ];
  return lists.flatMap((list) => (Array.isArray(list) ? list.map(record) : []));
}

export function getNotificationEventResource(event: EventInterface) {
  const data = event.data.data;
  const object = record(
    "object" in data
      ? data.object
      : "current" in data
        ? data.current
        : "previous" in data
          ? data.previous
          : data,
  );
  const id =
    event.objectId ?? object.experimentId ?? object.featureId ?? object.id;
  return {
    resource: event.data.object,
    id: typeof id === "string" ? id : null,
    object,
  };
}

export const baseMetricId = (id: string) =>
  parseSliceMetricId(parseFunnelStepMetricId(id).baseMetricId).baseMetricId;

export async function getNotificationResources(
  context: ReqContext,
  event: EventInterface,
  filters: NotificationResourceFilters,
): Promise<Required<NotificationResourceFilters>> {
  const { resource, id, object } = getNotificationEventResource(event);
  const related = {
    experiments: resource === "experiment" && id ? [id] : [],
    features: resource === "feature" && id ? [id] : [],
    metrics: [
      ...metricIdsFromConfig(object),
      ...metricIdsFromConfig(object.settings),
    ],
  };
  if (
    resource === "experiment" &&
    id &&
    (filters.features?.length || filters.metrics?.length)
  ) {
    const experiments = await getExperimentsByIds(context, [id]);
    related.features = experiments.length
      ? experiments.flatMap((experiment) => experiment.linkedFeatures || [])
      : strings(object.linkedFeatures);
    if (filters.metrics?.length)
      related.metrics.push(...experiments.flatMap(metricIdsFromConfig));
  }
  if (
    resource === "feature" &&
    id &&
    (filters.experiments?.length || filters.metrics?.length)
  ) {
    const feature = await getFeature(context, id);
    const rules = feature ? feature.rules : payloadRules(object);
    related.experiments =
      feature?.linkedExperiments ??
      event.relatedResources?.experiments ??
      rules.flatMap((rule) =>
        rule.type === "experiment-ref" && typeof rule.experimentId === "string"
          ? [rule.experimentId]
          : [],
      );
    if (filters.metrics?.length) {
      const rollouts = await context.models.safeRollout.getAllByFeatureId(id);
      const experiments = related.experiments.length
        ? await getExperimentsByIds(context, related.experiments)
        : [];
      related.metrics.push(
        ...rules.flatMap(metricIdsFromConfig),
        ...rollouts.flatMap(metricIdsFromConfig),
        ...experiments.flatMap(metricIdsFromConfig),
      );
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
