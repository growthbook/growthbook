import {
  getNamespaceMembershipsValidator,
  type ApiNamespaceExperimentMember,
  type ApiNamespaceFeatureRuleMember,
} from "shared/validators";
import { experimentHasLinkedChanges, getNamespaceRanges } from "shared/util";
import { ExperimentRule, NamespaceValue } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";

export const getNamespaceMemberships = createApiRequestHandler(
  getNamespaceMembershipsValidator,
)(async (req) => {
  const { id } = req.params;
  const { environments } = req.context;

  const experiments: ApiNamespaceExperimentMember[] = [];
  const featureRules: ApiNamespaceFeatureRuleMember[] = [];

  const allFeatures = await getAllFeatures(req.context);
  allFeatures.forEach((f) => {
    if (f.archived) return;
    environments.forEach((env) => {
      if (!f.environmentSettings?.[env]?.enabled) return;
      const rules = f.environmentSettings?.[env]?.rules ?? [];
      rules
        .filter(
          (r) =>
            r.enabled &&
            r.type === "experiment" &&
            r.namespace?.enabled &&
            r.namespace.name === id,
        )
        .forEach((r) => {
          const expRule = r as ExperimentRule;
          const ns = expRule.namespace as NamespaceValue;
          featureRules.push({
            featureId: f.id,
            environment: env,
            trackingKey: expRule.trackingKey || f.id,
            ranges: getNamespaceRanges(ns),
          });
        });
    });
  });

  const allExperiments = await getAllExperiments(req.context);
  allExperiments.forEach((e) => {
    if (e.archived) return;
    if (!experimentHasLinkedChanges(e)) return;
    if (
      e.status === "stopped" &&
      (e.excludeFromPayload || !e.releasedVariationId)
    ) {
      return;
    }
    if (!e.phases?.length) return;
    const phase = e.phases[e.phases.length - 1];
    if (!phase?.namespace?.enabled || phase.namespace.name !== id) return;

    const ns = phase.namespace as NamespaceValue;
    experiments.push({
      id: e.id,
      name: e.name,
      trackingKey: e.trackingKey,
      ranges: getNamespaceRanges(ns),
    });
  });

  return { experiments, featureRules };
});
