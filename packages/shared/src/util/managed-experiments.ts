import type { FeatureInterface, FeatureValueType } from "shared/types/feature";
import type { LinkedFeatureInfo } from "shared/types/experiment";
import { validateFeatureValue } from "./features";

// Managed mode: the experiment owns one Feature Flag holding one experiment-ref
// rule, edited only from the experiment page while the marker is set.

/** Characters a feature id may contain (see `postFeatures`). */
const FEATURE_KEY_ALLOWED = /[^a-zA-Z0-9_.:|-]+/g;

/** Start-checklist item key prefix for a linked flag's outstanding approval; the one hard blocker an admin may bypass. */
export const PENDING_APPROVAL_ITEM_PREFIX = "pendingApproval:";

export type ManagedFlagKeyPlan = {
  /** The id the tracking key sanitizes to — what gets created if it is free. */
  derivedId: string;
  derivedIdAvailable: boolean;
  /** True when sanitizing changed the key, so the two cannot match exactly. */
  sanitized: boolean;
  /** Offered only when `derivedId` is taken; adopting it renames the tracking key so the two match. */
  suggestedPair: { trackingKey: string; featureId: string } | null;
  /** Set when the org's feature key format rejects `derivedId`. */
  regexError: string | null;
};

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

// A managed flag publishes when the experiment starts, so its draft is as good
// as a live linked change for the start gates.
export function hasStartReadyManagedFlag(
  experimentId: string,
  linkedFeatures: Pick<LinkedFeatureInfo, "feature" | "state">[],
): boolean {
  return linkedFeatures.some(
    (f) =>
      isManagedByExperiment(f.feature, experimentId) &&
      (f.state === "live" || f.state === "draft"),
  );
}

export type ManagedValueProblem = {
  variationId: string;
  variationName: string;
  problem: "missing" | "malformed";
  detail?: string;
};

// Every arm of a managed flag has to carry a value that parses as the type the
// draft lands as, or the publish at start fails.
export function getManagedValueProblems({
  variations,
  values,
  valueType,
}: {
  variations: { id: string; name: string }[];
  values: { variationId: string; value: string }[];
  valueType: FeatureValueType;
}): ManagedValueProblem[] {
  const byId = new Map(values.map((v) => [v.variationId, v.value]));
  const problems: ManagedValueProblem[] = [];
  variations.forEach((v, i) => {
    const value = byId.get(v.id);
    const variationName = v.name || `Variation ${i}`;
    if (value === undefined) {
      problems.push({ variationId: v.id, variationName, problem: "missing" });
      return;
    }
    if (valueType === "boolean" && value !== "true" && value !== "false") {
      problems.push({
        variationId: v.id,
        variationName,
        problem: "malformed",
        detail: "Must be true or false",
      });
      return;
    }
    // Strict, not the lenient repair `validateFeatureValue` applies on save:
    // the SDK parses what is stored.
    if (valueType === "json") {
      try {
        JSON.parse(value);
      } catch {
        problems.push({
          variationId: v.id,
          variationName,
          problem: "malformed",
          detail: "Must be valid JSON",
        });
      }
      return;
    }
    try {
      validateFeatureValue({ valueType }, value);
    } catch (e) {
      problems.push({
        variationId: v.id,
        variationName,
        problem: "malformed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
  return problems;
}

/** The experiment that manages this flag, or null when nothing does. */
export function managedByExperimentId(
  feature: Pick<FeatureInterface, "managedBy">,
): string | null {
  return feature.managedBy?.type === "experiment"
    ? feature.managedBy.experimentId
    : null;
}

// A candidate, not a reservation: callers bump `attempt` on duplicate-key
// errors rather than probing for a free id and racing.
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

// Boolean seeds control off and the rest on; a truthiness test on the key
// would make every value true.
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

// By position, not id: a duplicate gets fresh ids, so an id match would seed
// every variation.
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

// The experiment's own lifecycle writes move a managed flag's live version, so
// under approvals an approval must stand against current live regardless of org setting.
export function requireFreshBaseForPublish({
  feature,
  reviewRequired,
  orgSetting,
}: {
  feature: Parameters<typeof isManagedFeature>[0];
  reviewRequired: boolean;
  orgSetting: boolean;
}): boolean {
  return orgSetting || (reviewRequired && isManagedFeature(feature));
}
