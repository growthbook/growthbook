import type { Namespaces } from "shared/types/organization";
import type { ApiNamespace } from "shared/validators";

export function toApiNamespace(ns: Namespaces): ApiNamespace {
  return {
    id: ns.name,
    displayName: ns.label,
    description: ns.description,
    status: ns.status,
    format: ns.format ?? "legacy",
    ...(ns.format === "multiRange"
      ? { hashAttribute: ns.hashAttribute, seed: ns.seed }
      : {}),
  };
}
