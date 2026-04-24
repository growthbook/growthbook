import { v4 as uuidv4 } from "uuid";
import type { NamespaceFormat, Namespaces } from "shared/types/organization";

type BuildNamespaceInput = {
  name: string;
  label: string;
  description: string;
  status: "active" | "inactive";
  format: NamespaceFormat;
  hashAttribute?: string;
  existingSeed?: string;
  existingHashAttribute?: string;
};

/**
 * Construct a persisted namespace object from controller input.
 *
 * - For `multiRange`, requires a hashAttribute (from input or the existing
 *   record) and preserves the existing seed when updating; generates a new
 *   uuid seed only when one doesn't already exist.
 * - For `legacy`, strips `hashAttribute`/`seed` so they cannot leak onto a
 *   non-multiRange namespace and cause format drift.
 */
export function buildNamespace(input: BuildNamespaceInput): Namespaces {
  const base = {
    name: input.name,
    label: input.label,
    description: input.description,
    status: input.status,
  };

  if (input.format === "multiRange") {
    const hashAttribute = input.hashAttribute || input.existingHashAttribute;
    if (!hashAttribute) {
      throw new Error("Hash attribute is required for multi-range namespaces");
    }
    return {
      ...base,
      format: "multiRange",
      hashAttribute,
      seed: input.existingSeed || uuidv4(),
    };
  }

  return { ...base, format: "legacy" };
}
