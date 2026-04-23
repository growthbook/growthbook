import {
  getNamespaceMembershipsValidator,
  type ApiNamespaceExperimentMember,
} from "shared/validators";
import { experimentHasLinkedChanges, getNamespaceRanges } from "shared/util";
import { NamespaceValue } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";

export const getNamespaceMemberships = createApiRequestHandler(
  getNamespaceMembershipsValidator,
)(async (req) => {
  const { id } = req.params;
  const experiments: ApiNamespaceExperimentMember[] = [];

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

  return { experiments };
});
