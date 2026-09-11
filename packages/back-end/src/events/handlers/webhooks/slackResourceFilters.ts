import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  getFeature,
  getFeatureIdsLinkedToExperiment,
  getFeatureLinkedExperimentIds,
} from "back-end/src/models/FeatureModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { ReqContext } from "back-end/types/request";
// Metric ids come in three flavors: classic (met_), fact (fact__), and metric
// groups (mg_). Collect all three so filtering by any of them works — the
// dropdown offers fact metrics, and scanning only met_ silently matched nothing.
const isMetricId = (s: string) =>
  s.startsWith("met_") || s.startsWith("fact__") || s.startsWith("mg_");

export const collectMetricIds = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    return isMetricId(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMetricIds(item, depth + 1));
  }
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const direct = [
    record.metricId,
    record.metricIds,
    record.metrics,
    record.goalMetrics,
    record.guardrailMetrics,
    record.secondaryMetrics,
  ].flatMap((item) => collectMetricIds(item, depth + 1));

  return Object.values(record)
    .flatMap((item) => collectMetricIds(item, depth + 1))
    .concat(direct);
};

// Metric ids configured on an experiment or an inline experiment rule (goal,
// secondary, guardrail, activation). Ids may be classic (met_), fact (fact__),
// or metric-group (mg_) — all pass through unchanged.
export const metricIdsFromMetricConfig = (c: {
  goalMetrics?: string[];
  secondaryMetrics?: string[];
  guardrailMetrics?: string[];
  guardrails?: string[];
  activationMetric?: string;
}): string[] => [
  ...(c.goalMetrics || []),
  ...(c.secondaryMetrics || []),
  ...(c.guardrailMetrics || []),
  ...(c.guardrails || []),
  ...(c.activationMetric ? [c.activationMetric] : []),
];

// Every metric a feature is "related to", so the cross-subject metric filter can
// match feature events. Covers the four association paths: (1) safe-rollout
// guardrail metrics, (2) metrics on inline experiment rules, and (4) metrics of
// experiments linked to the feature — which also subsumes (3) experiment-ref
// rules, since those experiments are in `linkedExperiments`. Resolved only when
// a channel filters by metric (this loads the feature and its experiments).
const getFeatureMetricIds = async (
  context: ReqContext,
  featureId: string,
): Promise<string[]> => {
  const ids: string[] = [];

  // (1) Safe-rollout guardrail metrics — metrics monitoring the rollout.
  const rollouts =
    await context.models.safeRollout.getAllByFeatureId(featureId);
  rollouts.forEach((r) => ids.push(...(r.guardrailMetricIds || [])));

  const feature = await getFeature(context, featureId);
  if (feature) {
    // (2) Inline experiment rules carry their own metric config.
    feature.rules.forEach((rule) => {
      if (rule.type === "experiment")
        ids.push(...metricIdsFromMetricConfig(rule));
    });
    // (4) Experiments linked to the feature (also covers experiment-ref rules).
    const linked = await getExperimentsByIds(
      context,
      feature.linkedExperiments || [],
    );
    linked.forEach((exp) => ids.push(...metricIdsFromMetricConfig(exp)));
  }

  return Array.from(new Set(ids));
};

export const matchesSlackResourceFilters = (
  webhook: Pick<EventWebHookInterface, "experiments" | "metrics" | "features">,
  related: { experiments: string[]; metrics: string[]; features: string[] },
) =>
  (["experiments", "metrics", "features"] as const).every(
    (key) =>
      !webhook[key]?.length ||
      webhook[key]?.some((id) => related[key].includes(id)),
  );

type ResourceFilterEvent = {
  organizationId: string;
  data: unknown;
  object?: string;
  objectId?: string;
};

// Supports both current event envelopes and pre-versioned legacy events.
export const getSlackEventResource = (event: ResourceFilterEvent) => {
  const envelope =
    event.data && typeof event.data === "object"
      ? (event.data as Record<string, unknown>)
      : {};
  const data = envelope.data;
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const value = record.object ?? record.current ?? record.previous ?? record;
  const object =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const id =
    event.objectId ??
    object.experimentId ??
    object.featureId ??
    object.id ??
    record.experimentId ??
    record.featureId;
  return {
    resource: event.object ?? envelope.object,
    id: typeof id === "string" ? id : null,
  };
};

export async function filterWebhooksByResources(
  event: ResourceFilterEvent,
  webhooks: EventWebHookInterface[],
): Promise<EventWebHookInterface[]> {
  const hasFilter = (key: "experiments" | "metrics" | "features") =>
    webhooks.some((w) => w[key]?.length);
  if (
    !["experiments", "metrics", "features"].some((key) =>
      hasFilter(key as "experiments" | "metrics" | "features"),
    )
  )
    return webhooks;
  const { resource, id } = getSlackEventResource(event);
  const related = {
    experiments: resource === "experiment" ? (id ? [id] : []) : [],
    features: resource === "feature" ? (id ? [id] : []) : [],
    metrics: Array.from(new Set(collectMetricIds(event.data))),
  };
  const context = await getContextForAgendaJobByOrgId(event.organizationId);
  if (resource === "experiment" && id) {
    if (hasFilter("features"))
      related.features = await getFeatureIdsLinkedToExperiment(context, id);
    if (hasFilter("metrics")) {
      const experiments = await getExperimentsByIds(context, id ? [id] : []);
      related.metrics.push(...experiments.flatMap(metricIdsFromMetricConfig));
    }
  }
  if (resource === "feature" && id) {
    if (hasFilter("experiments"))
      related.experiments = await getFeatureLinkedExperimentIds(context, id);
    if (hasFilter("metrics"))
      related.metrics.push(...(await getFeatureMetricIds(context, id)));
  }
  return webhooks.filter((w) => matchesSlackResourceFilters(w, related));
}
