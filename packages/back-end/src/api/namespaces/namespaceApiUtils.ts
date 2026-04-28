import type { Namespaces } from "shared/types/organization";
import type { ApiNamespace } from "shared/validators";
import { experimentHasLinkedChanges, getNamespaceRanges } from "shared/util";
import type { NamespaceValue } from "shared/types/feature";
import type { ExperimentInterface } from "shared/types/experiment";

export function orgNamespaceToApi(ns: Namespaces): ApiNamespace {
  return {
    id: ns.name,
    displayName: ns.label,
    description: ns.description ?? "",
    status: ns.status,
    format: ns.format ?? "legacy",
    ...(ns.format === "multiRange"
      ? { hashAttribute: ns.hashAttribute, seed: ns.seed }
      : {}),
  };
}

// Returns all experiments whose latest phase references the given namespace (any status).
// Used by getNamespaceMemberships to show full membership.
export function filterAllNamespaceExperiments(
  experiments: ExperimentInterface[],
  namespaceId: string,
) {
  return experiments.filter((e) => {
    if (!e.phases?.length) return false;
    const phase = e.phases[e.phases.length - 1];
    return phase?.namespace?.enabled && phase.namespace.name === namespaceId;
  });
}

// Returns experiments that are actively sending namespace traffic to the SDK payload.
// Used by the deleteNamespace guard to block deletion of in-use namespaces.
export function filterActiveNamespaceExperiments(
  experiments: ExperimentInterface[],
  namespaceId: string,
) {
  return experiments.filter((e) => {
    if (e.archived) return false;
    if (!experimentHasLinkedChanges(e)) return false;
    if (
      e.status === "stopped" &&
      (e.excludeFromPayload || !e.releasedVariationId)
    )
      return false;
    if (!e.phases?.length) return false;
    const phase = e.phases[e.phases.length - 1];
    return phase?.namespace?.enabled && phase.namespace.name === namespaceId;
  });
}

export function getLastPhaseNamespaceRanges(e: ExperimentInterface) {
  const phase = e.phases![e.phases!.length - 1];
  return getNamespaceRanges(phase.namespace as NamespaceValue);
}
