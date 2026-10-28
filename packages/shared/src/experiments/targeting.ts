import omit from "lodash/omit";
import type {
  ExperimentChangesFields,
  ExperimentInterface,
  ExperimentPhase,
  FeaturePrerequisite,
  MetricOverride,
  SavedGroupTargeting,
} from "shared/validators";
import type { ExperimentTargetingData } from "shared/types/experiment";
import { sameCanonicalValue } from "../util/sortObjectKeys";
import { getEqualWeights } from "./experiments";
import { getLatestPhaseVariations } from "./variations";

/**
 * An empty attribute-targeting condition is stored as the string "{}".
 * Returns true only when a non-empty condition is configured.
 */
export function hasAttributeCondition(condition?: string): boolean {
  return !!condition && condition !== "{}";
}

/**
 * Whether an experiment phase (or feature rule) has any targeting configured:
 * an attribute condition, saved group targeting, or prerequisites.
 */
export function hasTargetingConfigured(target?: {
  condition?: string;
  savedGroups?: SavedGroupTargeting[];
  prerequisites?: FeaturePrerequisite[];
}): boolean {
  if (!target) return false;
  return (
    hasAttributeCondition(target.condition) ||
    !!target.savedGroups?.length ||
    !!target.prerequisites?.length
  );
}

// Set on the experiment's latest phase rather than on the experiment.
const PHASE_FIELDS = [
  "coverage",
  "variationWeights",
  "condition",
  "savedGroups",
  "prerequisites",
  "namespace",
  "seed",
] as const;
export type PhaseField = (typeof PHASE_FIELDS)[number];

export function isPhaseField(key: string): key is PhaseField {
  return (PHASE_FIELDS as readonly string[]).includes(key);
}

// Changing only these leaves who is in the experiment, and how they're
// bucketed, as it was: a running bandit keeps learning.
const TRAFFIC_FIELDS = ["coverage", "variationWeights"];
export function onlyTrafficFields(keys: string[]): boolean {
  return keys.every((key) => TRAFFIC_FIELDS.includes(key));
}

type TargetingPhase = Pick<ExperimentPhase, PhaseField | "variations">;

// Off the latest phase for a phase field, else off the experiment.
export function experimentFieldValue(
  experiment: { phases: Partial<TargetingPhase>[] },
  key: string,
): unknown {
  const source: object | undefined = isPhaseField(key)
    ? experiment.phases[experiment.phases.length - 1]
    : experiment;
  return (source as Record<string, unknown> | undefined)?.[key] ?? null;
}

// An override's "" window type is the "None" window, where a missing one
// follows the metric; the canonical value would read them as the same.
const noneWindowKept = (overrides: unknown) =>
  Array.isArray(overrides)
    ? overrides.map((o: Partial<MetricOverride> | null) =>
        o?.windowType === "" ? { ...o, windowType: "none" } : o,
      )
    : overrides;

export function sameFieldValue(key: string, a: unknown, b: unknown): boolean {
  if (key === "condition") {
    const condition = (v: unknown) =>
      hasAttributeCondition(v as string | undefined) ? v : "";
    return condition(a) === condition(b);
  }
  if (key === "metricOverrides") {
    return sameCanonicalValue(noneWindowKept(a), noneWindowKept(b));
  }
  return sameCanonicalValue(a, b);
}

// As the experiment page names each field a save can change, cased to sit
// mid-sentence: only named resources and acronyms keep their capitals.
const FIELD_LABELS: Record<keyof ExperimentChangesFields, string> = {
  name: "name",
  description: "description",
  hypothesis: "hypothesis",
  variations: "variations",
  holdoutId: "holdout",
  condition: "attribute targeting",
  savedGroups: "Saved Group targeting",
  prerequisites: "prerequisite targeting",
  seed: "seed",
  coverage: "traffic percent",
  variationWeights: "variation weights",
  namespace: "namespace targeting",
  hashAttribute: "assignment attribute",
  fallbackAttribute: "fallback attribute",
  attributeScopeAllProjects: "attribute scope",
  hashVersion: "hashing algorithm",
  disableStickyBucketing: "sticky bucketing",
  bucketVersion: "bucket version",
  minBucketVersion: "minimum bucket version",
  statusUpdateSchedule: "schedule",
  trackingKey: "experiment key",
  datasource: "Data Source",
  exposureQueryId: "assignment query",
  exposureQueryIdentifierType: "identifier type",
  goalMetrics: "goal metrics",
  secondaryMetrics: "secondary metrics",
  guardrailMetrics: "guardrail metrics",
  activationMetric: "activation metric",
  metricOverrides: "metric overrides",
  lookbackOverride: "metric windows",
  decisionFrameworkSettings: "decision framework",
  segment: "segment",
  queryFilter: "custom SQL filter",
  skipPartialData: "conversion windows",
  attributionModel: "conversion windows",
  regressionAdjustmentEnabled: "CUPED",
  postStratificationEnabled: "post-stratification",
  sequentialTestingEnabled: "sequential testing",
  sequentialTestingTuningParameter: "sequential testing",
  statsEngine: "stats engine",
  customMetricSlices: "custom Metric Slices",
  precomputedUnitDimensionIds: "unit dimensions",
};

// Each field once, by its name on the page.
export function experimentFieldLabels(keys: string[]): string[] {
  return [
    ...new Set(
      keys.map(
        (key) => FIELD_LABELS[key as keyof ExperimentChangesFields] ?? key,
      ),
    ),
  ];
}

// Fields someone saved since `base` was loaded, to something other than the
// change itself.
export function conflictingFields(
  experiment: { phases: Partial<TargetingPhase>[] },
  share:
    | { changes: Record<string, unknown>; base: Record<string, unknown> }
    | undefined,
): string[] {
  if (!share) return [];
  return Object.keys(share.changes).filter((key) => {
    const current = experimentFieldValue(experiment, key);
    return (
      !sameFieldValue(key, current, share.base[key]) &&
      !sameFieldValue(key, current, share.changes[key])
    );
  });
}

export type TargetingChanges = Partial<
  Omit<ExperimentTargetingData, "newPhase" | "reseed" | "variations">
>;

// The release plan sets a new phase, and the experiment's own variations set
// the phase's, so neither is a targeting change.
export function changedTargeting(
  staged: Partial<ExperimentTargetingData>,
  loaded: Partial<ExperimentTargetingData>,
): TargetingChanges {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(staged)) {
    // Unset isn't a value a save can send.
    if (
      value === undefined ||
      key === "newPhase" ||
      key === "reseed" ||
      key === "variations"
    ) {
      continue;
    }
    if (!sameFieldValue(key, value, loaded[key as keyof typeof loaded])) {
      changes[key] = value;
    }
  }
  return changes;
}

export function getTargetingDefaults(
  experiment: Pick<
    ExperimentInterface,
    | "variations"
    | "hashAttribute"
    | "fallbackAttribute"
    | "attributeScopeAllProjects"
    | "hashVersion"
    | "disableStickyBucketing"
    | "bucketVersion"
    | "minBucketVersion"
    | "trackingKey"
  > & { phases: TargetingPhase[] },
  hashVersionFallback: 1 | 2,
): ExperimentTargetingData {
  const lastPhase: TargetingPhase | undefined =
    experiment.phases[experiment.phases.length - 1];
  const lastPhaseVariations = getLatestPhaseVariations(experiment);

  return {
    condition: lastPhase?.condition ?? "",
    savedGroups: lastPhase?.savedGroups ?? [],
    prerequisites: lastPhase?.prerequisites ?? [],
    coverage: lastPhase?.coverage ?? 1,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute || "",
    attributeScopeAllProjects: experiment.attributeScopeAllProjects ?? false,
    hashVersion: experiment.hashVersion || hashVersionFallback,
    disableStickyBucketing: experiment.disableStickyBucketing ?? false,
    // Unset reads as 0, as the SDK reads it.
    bucketVersion: experiment.bucketVersion ?? 0,
    minBucketVersion: experiment.minBucketVersion || 0,
    namespace: (() => {
      const saved = lastPhase?.namespace;
      if (!saved) {
        // Canonical blank shape; matches what NamespaceSelector writes so
        // `isEqual(watched, defaults)` can't misfire from shape drift.
        return {
          enabled: false,
          name: "",
          format: "legacy" as const,
          ranges: [] as [number, number][],
        };
      }
      // Fold legacy `range` → `ranges` so defaults line up with the shape
      // NamespaceSelector produces immediately on mount.
      if ("range" in saved && !("ranges" in saved)) {
        return { ...omit(saved, "range"), ranges: [saved.range] };
      }
      return saved;
    })() as ExperimentTargetingData["namespace"],
    seed: lastPhase?.seed ?? "",
    trackingKey: experiment.trackingKey || "",
    variationWeights:
      lastPhase?.variationWeights ??
      getEqualWeights(lastPhaseVariations.length, 4),
    variations:
      lastPhase?.variations ??
      lastPhaseVariations.map((v) => ({
        id: v.id,
        status: "active" as const,
      })),
    newPhase: false,
    reseed: true,
  };
}
