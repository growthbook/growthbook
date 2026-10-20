import { v4 as uuidv4 } from "uuid";
import { experimentHasLinkedChanges } from "shared/util";
import type { NamespaceFormat, Namespaces } from "shared/types/organization";
import type { ExperimentInterface } from "shared/types/experiment";

/**
 * The subset of an experiment that namespace-usage checks read. Kept looser
 * than `ExperimentInterface` so projected/raw Mongo docs (which carry only
 * these fields, and may predate the `releasedVariationId` migration) can be
 * passed straight in.
 */
export type NamespaceUsageExperiment = {
  archived?: boolean;
  status: ExperimentInterface["status"];
  hasVisualChangesets?: boolean;
  hasURLRedirects?: boolean;
  linkedFeatures?: string[];
  excludeFromPayload?: boolean;
  releasedVariationId?: string;
  results?: ExperimentInterface["results"];
  winner?: number;
  variations?: { id?: string }[];
  phases?: { namespace?: ExperimentInterface["phases"][number]["namespace"] }[];
};

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

/**
 * Mirror of `upgradeExperimentDoc`'s `releasedVariationId` backfill, so a
 * caller reading raw/projected experiment docs agrees with one reading
 * migrated ones. On an already-migrated experiment the field is always
 * present, making this a no-op. Keep in sync with that migration.
 */
function getReleasedVariationId(experiment: NamespaceUsageExperiment): string {
  if ("releasedVariationId" in experiment) {
    return experiment.releasedVariationId ?? "";
  }
  if (experiment.status !== "stopped") return "";

  // The migration backfills missing variation ids to their index before
  // deriving releasedVariationId, so do the same here — otherwise a legacy doc
  // without stored variation ids yields "" and is wrongly treated as absent
  // from the payload.
  const variationIdAt = (index: number): string => {
    const variation = experiment.variations?.[index];
    if (!variation) return "";
    return variation.id || `${index}`;
  };

  if (experiment.results === "lost") return variationIdAt(0);
  if (experiment.results === "won")
    return variationIdAt(experiment.winner ?? 1);
  return "";
}

/**
 * Whether an experiment currently allocates traffic inside `namespaceId`: not
 * archived, still contributing to SDK payloads (linked changes; if stopped,
 * still rolling out a winner), and with the namespace enabled on its LATEST
 * phase.
 *
 * This is the single definition of namespace "usage" for experiments — the
 * namespaces settings page listing and the delete / re-hash integrity guards
 * both go through it, so a namespace can never be removed or re-hashed out
 * from under traffic the settings page reports.
 */
export function experimentAllocatesTrafficInNamespace(
  experiment: NamespaceUsageExperiment,
  namespaceId: string,
): boolean {
  if (experiment.archived) return false;
  if (!experimentHasLinkedChanges(experiment)) return false;
  if (experiment.status === "stopped") {
    if (experiment.excludeFromPayload) return false;
    if (!getReleasedVariationId(experiment)) return false;
  }

  const phases = experiment.phases ?? [];
  const phase = phases[phases.length - 1];
  return !!phase?.namespace?.enabled && phase.namespace.name === namespaceId;
}
