import type {
  InterleavingAnalysis,
  InterleavingInterface,
  InterleavingVariationRole,
} from "../validators/interleaving";
import {
  INTERLEAVING_ITEM_ID_COLUMN,
  INTERLEAVING_RANKING_ID_COLUMN,
} from "../validators/interleaving-exposure-query";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "../../types/fact-table";
import {
  entityTargetsProject,
  getValidation,
  validateJSONFeatureValue,
} from "./features";

// Variations are stored by role; the SDK (and anything positional, like
// results tables) gets them as [control, treatment].
export function interleavingVariationsList<T>(
  variations: Record<InterleavingVariationRole, T>,
): [T, T] {
  return [variations.control, variations.treatment];
}

export function mapInterleavingVariations<T, U>(
  variations: Record<InterleavingVariationRole, T>,
  fn: (variation: T, role: InterleavingVariationRole) => U,
): Record<InterleavingVariationRole, U> {
  return {
    control: fn(variations.control, "control"),
    treatment: fn(variations.treatment, "treatment"),
  };
}

// Key of the pseudo feature generated into SDK payloads for an interleaving.
export function getInterleavingFeatureDefId(key: string): string {
  return `$interleave:${key}`;
}

export function interleavingTargetingServes(il: {
  status: string;
  archived: boolean;
}): boolean {
  return il.status !== "stopped" && !il.archived;
}

export function interleavingInSDKPayload(il: {
  status: string;
  archived: boolean;
}): boolean {
  return il.status === "running" && !il.archived;
}

export function interleavingInPayloadScope(
  il: InterleavingInterface,
  environment: string,
  projects: string[],
): boolean {
  if (!interleavingInSDKPayload(il)) return false;
  if (!il.environmentSettings[environment]?.enabled) return false;
  return (
    projects.length === 0 || projects.some((p) => entityTargetsProject(il, p))
  );
}

export function interleavingPrerequisiteIds(
  interleavings: InterleavingInterface[],
  environment: string,
  projects: string[],
): string[] {
  return [
    ...new Set(
      interleavings
        .filter((il) => interleavingInPayloadScope(il, environment, projects))
        .flatMap((il) => (il.prerequisites ?? []).map((p) => p.id)),
    ),
  ];
}

// `getValidation` turns an unparseable schema into "validation disabled", so an
// enabled schema that doesn't parse would silently accept every config.
export function assertUsableRankerSchema(
  jsonSchema?: InterleavingInterface["jsonSchema"],
): void {
  if (!jsonSchema?.enabled) return;
  if (!getValidation({ jsonSchema }).validationEnabled) {
    throw new Error(
      "Ranker config schema is invalid, so ranker configs cannot be validated.",
    );
  }
}

export function parseInterleavingRankerConfig(
  config: string,
  jsonSchema?: InterleavingInterface["jsonSchema"],
): Record<string, unknown> {
  assertUsableRankerSchema(jsonSchema);
  let parsed: unknown;
  try {
    parsed = JSON.parse(config);
  } catch (e) {
    throw new Error(
      `Ranker config must be valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ranker config must be a JSON object");
  }
  // Not validateFeatureValue: it also resolves `$extends`/`@config:`, which
  // nothing on the interleaving payload path reads.
  const { valid, errors } = validateJSONFeatureValue(parsed, {
    jsonSchema: jsonSchema ?? undefined,
  });
  if (!valid) {
    throw new Error(errors.join(", "));
  }
  return parsed as Record<string, unknown>;
}

const UNSUPPORTED_INTERLEAVING_AGGREGATIONS = new Set([
  "count distinct",
  "hll merge",
  "kll merge",
]);

export function getInterleavingMetricIssue({
  metric,
  factTable,
  userIdType,
  analyses,
}: {
  metric: Pick<FactMetricInterface, "name" | "metricType" | "numerator">;
  factTable: Pick<FactTableInterface, "userIdTypes" | "columns"> | undefined;
  userIdType: string;
  analyses: InterleavingAnalysis[];
}): string | null {
  const ref = `Interleaving metric "${metric.name}"`;

  // Funnel metrics have no numerator
  if (!metric.numerator) return `${ref} must read from a fact table`;
  if (!factTable) return `Fact table not found for ${ref}`;

  if (!factTable.userIdTypes.includes(userIdType)) {
    return `${ref} requires the '${userIdType}' identifier type on its fact table`;
  }

  const hasColumn = (column: string) =>
    factTable.columns.some((c) => c.column === column && !c.deleted);

  if (!hasColumn(INTERLEAVING_ITEM_ID_COLUMN)) {
    return `${ref} requires an '${INTERLEAVING_ITEM_ID_COLUMN}' column on its fact table`;
  }

  // Paired analysis joins engagement per impression
  if (
    analyses.some((a) => a.type === "paired") &&
    !hasColumn(INTERLEAVING_RANKING_ID_COLUMN)
  ) {
    return `${ref} needs an '${INTERLEAVING_RANKING_ID_COLUMN}' column on its fact table to be joined per impression`;
  }

  const { metricType, numerator } = metric;
  if (metricType !== "mean" && metricType !== "proportion") {
    return `Interleaving metrics must be mean or proportion metrics: "${metric.name}" is a ${metricType} metric`;
  }
  if (
    numerator.column === "$$distinctDates" ||
    UNSUPPORTED_INTERLEAVING_AGGREGATIONS.has(numerator.aggregation ?? "")
  ) {
    return `Interleaving metrics must use sum, max, or count aggregations: "${metric.name}"`;
  }
  // An aggregate filter thresholds a per-user total, but interleaving
  // aggregates per item, so there is no grain that preserves the metric's
  // meaning. Accepting one would silently report a sum where the metric
  // defines an indicator.
  if (numerator.aggregateFilter && numerator.aggregateFilterColumn) {
    return `Interleaving metrics cannot use a user filter yet: "${metric.name}"`;
  }

  return null;
}

// Tracking keys must be unique per Data Source, so a later experiment reusing a
// code key gets a suffix. Loops rather than counting collisions, so a manually
// set `key_v1` is skipped rather than clobbered.
export function nextAvailableTrackingKey(
  key: string,
  taken: Set<string>,
): string {
  if (!taken.has(key)) return key;
  let i = 1;
  while (taken.has(`${key}_v${i}`)) i++;
  return `${key}_v${i}`;
}
