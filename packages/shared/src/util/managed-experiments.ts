import type { FeatureInterface, FeatureValueType } from "shared/types/feature";

// Managed mode: the experiment owns one Feature Flag holding one experiment-ref
// rule, edited only from the experiment page while the marker is set.

/** Characters a feature id may contain (see `postFeatures`). */
const FEATURE_KEY_ALLOWED = /[^a-zA-Z0-9_.:|-]+/g;

export function isManagedFeature(
  feature: Pick<FeatureInterface, "managedBy">,
): boolean {
  return feature.managedBy?.type === "experiment";
}

export function isManagedByExperiment(
  feature: Pick<FeatureInterface, "managedBy">,
  experimentId: string,
): boolean {
  return (
    feature.managedBy?.type === "experiment" &&
    feature.managedBy.experimentId === experimentId
  );
}

/** The experiment that manages this flag, or null when nothing does. */
export function managedByExperimentId(
  feature: Pick<FeatureInterface, "managedBy">,
): string | null {
  return feature.managedBy?.type === "experiment"
    ? feature.managedBy.experimentId
    : null;
}

/**
 * A candidate id, not a reservation: uniqueness belongs to the
 * `{id, organization}` index, so callers bump `attempt` on duplicate-key errors
 * rather than probing for a free id and racing.
 */
export function managedFeatureKeyCandidate({
  trackingKey,
  experimentId,
  attempt = 0,
}: {
  trackingKey: string;
  experimentId: string;
  attempt?: number;
}): string {
  const sanitized = trackingKey
    .trim()
    .replace(FEATURE_KEY_ALLOWED, "-")
    .replace(/^-+|-+$/g, "");
  const base = sanitized || experimentId;
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

/** Creation collects no values, so each variation starts with a type-appropriate seed. */
export function seedManagedVariationValues(
  variations: { id: string; key?: string }[],
  valueType: FeatureValueType = "string",
): { variationId: string; value: string }[] {
  return variations.map((v, i) => ({
    variationId: v.id,
    value: seedValueForType(valueType, v.key, i),
  }));
}

/**
 * A starting value the flag's field will accept for the chosen type. Boolean
 * seeds control off and everything else on — a truthiness test on the variation
 * key would make every value true and serve one value to everyone.
 */
function seedValueForType(
  valueType: FeatureValueType,
  key: string | undefined,
  index: number,
): string {
  switch (valueType) {
    case "boolean":
      return index === 0 ? "false" : "true";
    case "number":
      return String(index);
    case "json":
      return `{\n  "value": ${JSON.stringify(key || String(index))}\n}`;
    case "string":
      return key || String(index);
  }
}

/**
 * By position, not by variation id — a duplicate gets fresh ids, so an id match
 * would fall back to the seed for every variation. Uncovered positions seed.
 */
export function copyManagedVariationValues({
  sourceValues,
  sourceVariations,
  targetVariations,
  valueType = "string",
}: {
  sourceValues: { variationId: string; value: string }[];
  sourceVariations: { id: string }[];
  targetVariations: { id: string; key?: string }[];
  /** The type being copied, so an uncovered position seeds to match it. */
  valueType?: FeatureValueType;
}): { variationId: string; value: string }[] {
  const byIndex = sourceVariations.map(
    (sv) => sourceValues.find((v) => v.variationId === sv.id)?.value,
  );
  const seeded = seedManagedVariationValues(targetVariations, valueType);
  return targetVariations.map((v, i) => ({
    variationId: v.id,
    value: byIndex[i] ?? seeded[i].value,
  }));
}
