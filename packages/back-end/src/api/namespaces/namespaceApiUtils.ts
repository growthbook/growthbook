import type { Namespaces } from "shared/types/organization";
import type { ApiNamespace } from "shared/validators";
import { getNamespaceRanges } from "shared/util";
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

export function getLastPhaseNamespaceRanges(e: ExperimentInterface) {
  const phase = e.phases![e.phases!.length - 1];
  return getNamespaceRanges(phase.namespace as NamespaceValue);
}
