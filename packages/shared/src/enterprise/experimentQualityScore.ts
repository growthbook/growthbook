// Import the specific validator files, NOT the shared/validators barrel:
// the barrel evaluates safe-rollout-snapshot, which imports shared/enterprise
// back — a module-initialization cycle that leaves validators undefined.
import {
  ExperimentHealthSettings,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import {
  AIExperimentQualityCheckKey,
  ExperimentAIQualityResults,
  ExperimentQualityScoreOverride,
  aiExperimentQualityCheckKeys,
} from "../validators/experiments";
import {
  CustomQualityCheck,
  DeterministicExperimentQualityCheckKey,
  ExperimentQualityCheckKey,
  ExperimentQualityCheckParams,
  ExperimentQualityConfigBody,
  ExperimentQualityConfigInterface,
  ExperimentQualitySectionKey,
  MAX_CUSTOM_QUALITY_CHECKS,
  OrganizationExperimentQualityPointer,
  ProjectExperimentQualityPointer,
  deterministicExperimentQualityCheckKeys,
  experimentQualityCheckKeys,
  experimentQualitySectionKeys,
} from "../validators/experiment-quality-score";
import {
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
} from "../constants";
import { getMultipleExposureHealthData, getSRMHealthData } from "../health";

// Re-export the key sets so existing `shared/enterprise` imports keep working
export type {
  CustomQualityCheck,
  ExperimentQualityCheckKey,
  ExperimentQualitySectionKey,
  DeterministicExperimentQualityCheckKey,
  ExperimentQualityCheckParams,
  ExperimentQualityConfigBody,
  ExperimentQualityConfigInterface,
  OrganizationExperimentQualityPointer,
  ProjectExperimentQualityPointer,
};
export {
  MAX_CUSTOM_QUALITY_CHECKS,
  experimentQualityCheckKeys,
  experimentQualitySectionKeys,
  deterministicExperimentQualityCheckKeys,
};

/**
 * Whether quality scoring is on for an experiment's scope: the project
 * pointer's tri-state `enabled` wins, else the org gate.
 */
export function resolveQualityEnabled(
  orgPointer?: OrganizationExperimentQualityPointer,
  projectPointer?: ProjectExperimentQualityPointer | null,
): boolean {
  return projectPointer?.enabled ?? orgPointer?.enabled ?? false;
}

export type ExperimentQualityCheckType = "deterministic" | "ai";

// Result key for a user-defined AI rule
export type CustomQualityCheckKey = `custom:${string}`;
// Any key that can appear on a score result: built-in or custom
export type ExperimentQualityResultCheckKey =
  | ExperimentQualityCheckKey
  | CustomQualityCheckKey;

export function customQualityCheckKey(id: string): CustomQualityCheckKey {
  return `custom:${id}`;
}

// Bump when the quality prompt or verdict schema changes so cached AI
// results are recomputed with the new prompt.
export const EXPERIMENT_QUALITY_PROMPT_VERSION = 6;

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface ExperimentQualitySectionDefinition {
  label: string;
  // Raw cross-section share weight; the design defaults total 100 so raw
  // weights read as percentages, but only the normalized ratio matters
  defaultWeight: number;
}

export const EXPERIMENT_QUALITY_SECTIONS: Record<
  ExperimentQualitySectionKey,
  ExperimentQualitySectionDefinition
> = {
  documentation: { label: "Documentation", defaultWeight: 35 },
  results: { label: "Results", defaultWeight: 25 },
  health: { label: "Health", defaultWeight: 20 },
  ai: { label: "AI checks", defaultWeight: 20 },
};

export interface ExperimentQualityCheckDefinition {
  section: ExperimentQualitySectionKey;
  type: ExperimentQualityCheckType;
  label: string;
  defaultWeight: number;
  defaultEnabled: boolean;
  defaultParams?: ExperimentQualityCheckParams;
}

export const EXPERIMENT_QUALITY_CHECKS: Record<
  ExperimentQualityCheckKey,
  ExperimentQualityCheckDefinition
> = {
  hypothesis: {
    section: "documentation",
    type: "deterministic",
    label: "Has a hypothesis",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  description: {
    section: "documentation",
    type: "deterministic",
    label: "Has a description",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  screenshots: {
    section: "documentation",
    type: "deterministic",
    label: "Has screenshots",
    defaultWeight: 1,
    defaultEnabled: false,
  },
  "tags-or-project": {
    section: "documentation",
    type: "deterministic",
    label: "Organized with tags or a project",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  "goal-metrics": {
    section: "documentation",
    type: "deterministic",
    label: "Has goal metrics",
    defaultWeight: 1,
    defaultEnabled: true,
    defaultParams: { maxGoalMetrics: 3 },
  },
  owner: {
    section: "documentation",
    type: "deterministic",
    label: "Has an owner",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  decision: {
    section: "results",
    type: "deterministic",
    label: "Decision recorded",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  learnings: {
    section: "results",
    type: "deterministic",
    label: "Learnings documented",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  "health-no-issues": {
    section: "health",
    type: "deterministic",
    label: "No major health issues",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  "health-powered": {
    section: "health",
    type: "deterministic",
    label: "Well powered",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  "min-runtime": {
    section: "health",
    type: "deterministic",
    label: "Minimum runtime met",
    defaultWeight: 1,
    defaultEnabled: false,
    defaultParams: { minRuntimeDays: 14 },
  },
  "ai-hypothesis-quality": {
    section: "ai",
    type: "ai",
    label: "Hypothesis quality",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  "ai-hypothesis-metric-alignment": {
    section: "ai",
    type: "ai",
    label: "Metrics align with hypothesis",
    defaultWeight: 1,
    defaultEnabled: true,
  },
  "ai-learnings-quality": {
    section: "ai",
    type: "ai",
    label: "Learnings quality",
    defaultWeight: 1,
    defaultEnabled: true,
  },
};

export function getChecksForSection(
  section: ExperimentQualitySectionKey,
): ExperimentQualityCheckKey[] {
  return experimentQualityCheckKeys.filter(
    (key) => EXPERIMENT_QUALITY_CHECKS[key].section === section,
  );
}

// ---------------------------------------------------------------------------
// Settings resolution + normalization
// ---------------------------------------------------------------------------

export interface ResolvedExperimentQualitySection {
  key: ExperimentQualitySectionKey;
  label: string;
  // Stored flag AND has >=1 enabled check; the ai section additionally
  // requires aiChecksEnabled
  enabled: boolean;
  rawWeight: number;
  // Normalized 0-1 across enabled sections; 0 when disabled
  share: number;
}

export interface ResolvedExperimentQualityCheck {
  key: ExperimentQualityCheckKey;
  section: ExperimentQualitySectionKey;
  type: ExperimentQualityCheckType;
  label: string;
  // Own flag AND section effectively enabled
  enabled: boolean;
  rawWeight: number;
  // Normalized 0-1 within the section across enabled checks; 0 when disabled
  split: number;
  params?: ExperimentQualityCheckParams;
  aiContext?: string;
}

export interface ResolvedCustomQualityCheck {
  id: string;
  key: CustomQualityCheckKey;
  name: string;
  rule: string;
  // Own flag AND the AI section is enabled
  enabled: boolean;
  rawWeight: number;
  // Normalized 0-1 within the AI section (shared pool with built-in AI
  // checks); 0 when disabled
  split: number;
}

export interface ResolvedExperimentQualityScoreSettings {
  aiChecksEnabled: boolean;
  sections: Record<
    ExperimentQualitySectionKey,
    ResolvedExperimentQualitySection
  >;
  checks: Record<ExperimentQualityCheckKey, ResolvedExperimentQualityCheck>;
  customAiChecks: ResolvedCustomQualityCheck[];
}

function sanitizeWeight(w: number | undefined, fallback: number): number {
  if (w === undefined) return fallback;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

function sanitizeParams(
  key: ExperimentQualityCheckKey,
  params?: ExperimentQualityCheckParams,
): ExperimentQualityCheckParams | undefined {
  const defaults = EXPERIMENT_QUALITY_CHECKS[key].defaultParams;
  if (!defaults) return undefined;
  const merged = { ...defaults, ...params };
  if (
    merged.maxGoalMetrics !== undefined &&
    (!Number.isInteger(merged.maxGoalMetrics) || merged.maxGoalMetrics < 2)
  ) {
    merged.maxGoalMetrics = defaults.maxGoalMetrics;
  }
  if (
    merged.minRuntimeDays !== undefined &&
    (!Number.isInteger(merged.minRuntimeDays) || merged.minRuntimeDays < 1)
  ) {
    merged.minRuntimeDays = defaults.minRuntimeDays;
  }
  return merged;
}

/**
 * Expands a config body (from an ExperimentQualityConfig doc, or undefined
 * for the built-in GrowthBook default — including when a referenced config
 * has been deleted) into a fully-populated, normalized config. Missing
 * fields fall back to catalog defaults. The enabled gate is resolved
 * separately via resolveQualityEnabled.
 */
export function resolveExperimentQualityScoreSettings(
  cfg?: ExperimentQualityConfigBody | null,
): ResolvedExperimentQualityScoreSettings {
  const aiChecksEnabled = cfg?.aiChecksEnabled ?? true;

  // Pass 1: raw check flags/weights
  const checkEnabled = {} as Record<ExperimentQualityCheckKey, boolean>;
  const checkWeight = {} as Record<ExperimentQualityCheckKey, number>;
  for (const key of experimentQualityCheckKeys) {
    const def = EXPERIMENT_QUALITY_CHECKS[key];
    const stored = cfg?.checks?.[key];
    checkEnabled[key] = stored?.enabled ?? def.defaultEnabled;
    checkWeight[key] = sanitizeWeight(stored?.weight, def.defaultWeight);
  }
  const storedCustomChecks = (cfg?.customAiChecks ?? []).slice(
    0,
    MAX_CUSTOM_QUALITY_CHECKS,
  );

  // Pass 2: section enablement. A section with no enabled checks is dead
  // weight — treat it as disabled so its share redistributes.
  const sections = {} as ResolvedExperimentQualityScoreSettings["sections"];
  for (const key of experimentQualitySectionKeys) {
    const def = EXPERIMENT_QUALITY_SECTIONS[key];
    const storedEnabled =
      key === "ai" ? aiChecksEnabled : (cfg?.sections?.[key]?.enabled ?? true);
    const hasEnabledCheck =
      getChecksForSection(key).some((c) => checkEnabled[c]) ||
      (key === "ai" && storedCustomChecks.some((c) => c.enabled !== false));
    sections[key] = {
      key,
      label: def.label,
      enabled: storedEnabled && hasEnabledCheck,
      rawWeight: sanitizeWeight(
        cfg?.sections?.[key]?.weight,
        def.defaultWeight,
      ),
      share: 0,
    };
  }

  // Pass 3: normalize section shares over enabled sections
  const enabledSections = experimentQualitySectionKeys.filter(
    (key) => sections[key].enabled,
  );
  const sectionWeightSum = enabledSections.reduce(
    (sum, key) => sum + sections[key].rawWeight,
    0,
  );
  for (const key of enabledSections) {
    sections[key].share =
      sectionWeightSum > EPS
        ? sections[key].rawWeight / sectionWeightSum
        : 1 / enabledSections.length;
  }

  // Pass 4: fold section enablement into checks and normalize splits.
  // Custom AI rules share the AI section's split pool with the built-in
  // AI checks.
  const customAiChecks: ResolvedCustomQualityCheck[] = storedCustomChecks.map(
    (c) => ({
      id: c.id,
      key: customQualityCheckKey(c.id),
      name: c.name,
      rule: c.rule,
      enabled: (c.enabled ?? true) && sections.ai.enabled,
      rawWeight: sanitizeWeight(c.weight, 1),
      split: 0,
    }),
  );
  const checks = {} as ResolvedExperimentQualityScoreSettings["checks"];
  for (const sectionKey of experimentQualitySectionKeys) {
    const sectionChecks = getChecksForSection(sectionKey);
    const enabledChecks = sectionChecks.filter(
      (c) => checkEnabled[c] && sections[sectionKey].enabled,
    );
    const enabledCustom =
      sectionKey === "ai" ? customAiChecks.filter((c) => c.enabled) : [];
    const splitSum =
      enabledChecks.reduce((sum, c) => sum + checkWeight[c], 0) +
      enabledCustom.reduce((sum, c) => sum + c.rawWeight, 0);
    const enabledCount = enabledChecks.length + enabledCustom.length;
    for (const key of sectionChecks) {
      const def = EXPERIMENT_QUALITY_CHECKS[key];
      const isEnabled = checkEnabled[key] && sections[sectionKey].enabled;
      checks[key] = {
        key,
        section: sectionKey,
        type: def.type,
        label: def.label,
        enabled: isEnabled,
        rawWeight: checkWeight[key],
        split: !isEnabled
          ? 0
          : splitSum > EPS
            ? checkWeight[key] / splitSum
            : 1 / enabledCount,
        params: sanitizeParams(key, cfg?.checks?.[key]?.params),
        aiContext:
          def.type === "ai" ? cfg?.checks?.[key]?.aiContext : undefined,
      };
    }
    if (sectionKey === "ai") {
      for (const custom of customAiChecks) {
        custom.split = !custom.enabled
          ? 0
          : splitSum > EPS
            ? custom.rawWeight / splitSum
            : 1 / enabledCount;
      }
    }
  }

  return {
    aiChecksEnabled,
    sections,
    checks,
    customAiChecks,
  };
}

// ---------------------------------------------------------------------------
// AI inputs hash
// ---------------------------------------------------------------------------

// cyrb53 — small, fast, isomorphic 53-bit hash. Used only for cache
// invalidation of an experiment's own AI results, so collision risk is
// acceptable (a stale result survives only if old and new inputs collide).
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h1 >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Sorted [key, context] pairs for the enabled AI checks — built-in checks
 * carry their per-check context, custom rules carry their rule text.
 * Including the enabled key SET (not just contexts) in the hash means
 * enabling an AI check after verdicts were cached invalidates them, so the
 * new check gets computed instead of staying pending forever. Custom rule
 * names are excluded (cosmetic; renaming shouldn't re-run the judge).
 */
export function getAICheckHashInputs(
  settings: ResolvedExperimentQualityScoreSettings,
): Array<[string, string]> {
  const builtin: Array<[string, string]> = [...aiExperimentQualityCheckKeys]
    .filter((key) => settings.checks[key].enabled)
    .map((key) => [key, settings.checks[key].aiContext ?? ""]);
  const custom: Array<[string, string]> = settings.customAiChecks
    .filter((c) => c.enabled)
    .map((c) => [c.key, c.rule]);
  return [...builtin, ...custom].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Trimmed JSON projection of the experiment handed to the AI judge for
 * custom rules, and hashed so any change to it re-runs them. Built
 * identically on the front-end (staleness detection) and back-end (prompt
 * + stored hash), so it must stay deterministic and isomorphic.
 */
export function getExperimentDigestForCustomRules(
  experiment: ExperimentForQualityScore,
  goalMetricNames: string[],
): string {
  const toISO = (d: Date | string | undefined) => {
    if (!d) return null;
    const t = new Date(d);
    return Number.isFinite(t.getTime()) ? t.toISOString() : null;
  };
  return JSON.stringify({
    status: experiment.status,
    type: experiment.type ?? "standard",
    hypothesis: experiment.hypothesis ?? "",
    description: experiment.description ?? "",
    tags: [...experiment.tags].sort(),
    project: experiment.project ?? "",
    hasOwner: !!experiment.owner?.trim(),
    goalMetricNames: [...goalMetricNames].sort(),
    goalMetricCount: experiment.goalMetrics.length,
    variations: experiment.variations.map((v) => ({
      name: v.name,
      screenshotCount: v.screenshots.length,
    })),
    phases: experiment.phases.map((p) => ({
      dateStarted: toISO(p.dateStarted),
      dateEnded: toISO(p.dateEnded),
    })),
    results: experiment.results ?? null,
    releasedVariationId: experiment.releasedVariationId || null,
    learnings: experiment.analysis ?? "",
  });
}

export function computeAIQualityInputsHash({
  hypothesis,
  analysis,
  goalMetricNames,
  aiCheckContexts,
  experimentDigest = "",
}: {
  hypothesis?: string;
  analysis?: string;
  goalMetricNames: string[];
  aiCheckContexts: Array<[string, string]>;
  // Set (via getExperimentDigestForCustomRules) when any custom rule is
  // enabled — custom rules read the whole experiment, so any change to it
  // must invalidate their verdicts
  experimentDigest?: string;
}): string {
  return cyrb53(
    JSON.stringify([
      EXPERIMENT_QUALITY_PROMPT_VERSION,
      hypothesis ?? "",
      analysis ?? "",
      [...goalMetricNames].sort(),
      aiCheckContexts,
      experimentDigest,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ExperimentForQualityScore = Pick<
  ExperimentInterface | ExperimentInterfaceStringDates,
  | "type"
  | "status"
  | "hypothesis"
  | "description"
  | "tags"
  | "project"
  | "owner"
  | "phases"
  | "variations"
  | "goalMetrics"
  | "results"
  | "releasedVariationId"
  | "analysis"
  | "analysisSummary"
  | "dismissedWarnings"
> & {
  aiQualityResults?: Pick<
    ExperimentAIQualityResults,
    "inputsHash" | "checks" | "error"
  >;
  qualityScoreOverride?:
    | (Pick<
        ExperimentQualityScoreOverride,
        "score" | "userId" | "userName" | "reason"
      > & { dateOverridden: Date | string })
    | null;
};

export interface ExperimentQualityCheckResult {
  key: ExperimentQualityResultCheckKey;
  type: ExperimentQualityCheckType;
  label: string;
  // False when N/A for this experiment (disabled checks are omitted from
  // results entirely)
  applicable: boolean;
  // 0-1; null when inapplicable or when an applicable AI check has no
  // fresh cached verdict yet (pending)
  score: number | null;
  reason?: string;
  params?: ExperimentQualityCheckParams;
}

export interface ExperimentQualitySectionResult {
  key: ExperimentQualitySectionKey;
  label: string;
  enabled: boolean;
  // Any check in the section is applicable
  applicable: boolean;
  // Configured share × 100 (for "35%" chips); 0 when disabled
  sharePercent: number;
  // Post-renormalization points on the 0-100 scale. Unrounded floats;
  // possiblePoints sums to 100 across sections whenever anything is
  // scorable. Both 0 for disabled or fully-N/A sections.
  earnedPoints: number;
  possiblePoints: number;
  checks: ExperimentQualityCheckResult[];
}

export interface ExperimentQualityScoreResult {
  // Effective score: the manual override when set, else the computed score
  score: number | null;
  computedScore: number | null;
  override: ExperimentForQualityScore["qualityScoreOverride"] | null;
  // True when at least one applicable AI check has no fresh verdict yet
  pending: boolean;
  // "10 of 13 checks apply" — enabled && applicable vs enabled
  appliedCheckCount: number;
  totalEnabledCheckCount: number;
  sections: ExperimentQualitySectionResult[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function evaluateDeterministicCheck(
  key: DeterministicExperimentQualityCheckKey,
  experiment: ExperimentForQualityScore,
  healthSettings: ExperimentHealthSettings,
  params: ExperimentQualityCheckParams | undefined,
  now: Date,
): { applicable: boolean; score?: number; reason?: string } {
  const stopped = experiment.status === "stopped";
  const health = experiment.analysisSummary?.health;

  switch (key) {
    case "hypothesis":
      return { applicable: true, score: experiment.hypothesis?.trim() ? 1 : 0 };
    case "description":
      return {
        applicable: true,
        score: experiment.description?.trim() ? 1 : 0,
      };
    case "screenshots": {
      if (experiment.type === "holdout") return { applicable: false };
      const hasScreenshots = experiment.variations.some(
        (v) => v.screenshots.length > 0,
      );
      return { applicable: true, score: hasScreenshots ? 1 : 0 };
    }
    case "tags-or-project":
      return {
        applicable: true,
        score: experiment.tags.length > 0 || experiment.project ? 1 : 0,
      };
    case "goal-metrics": {
      const n = experiment.goalMetrics.length;
      const max = params?.maxGoalMetrics ?? 3;
      if (n === 0) {
        return {
          applicable: true,
          score: 0,
          reason: "No goal metrics selected",
        };
      }
      if (n >= max) {
        return {
          applicable: true,
          score: 0,
          reason: `Has ${n} goal metrics (best practice is fewer than ${max})`,
        };
      }
      return { applicable: true, score: 1 };
    }
    case "owner":
      return { applicable: true, score: experiment.owner?.trim() ? 1 : 0 };
    case "decision": {
      if (!stopped) return { applicable: false };
      const hasDecision =
        !!experiment.results &&
        (experiment.results !== "won" || !!experiment.releasedVariationId);
      return {
        applicable: true,
        score: hasDecision ? 1 : 0,
        reason:
          experiment.results === "won" && !experiment.releasedVariationId
            ? "Marked as won but no winning variation was released"
            : undefined,
      };
    }
    case "learnings":
      if (!stopped) return { applicable: false };
      return { applicable: true, score: experiment.analysis?.trim() ? 1 : 0 };
    case "health-no-issues": {
      if (!health || !health.totalUsers) return { applicable: false };
      const issues: string[] = [];
      const srmHealth = getSRMHealthData({
        srm: health.srm,
        srmThreshold: healthSettings.srmThreshold,
        totalUsersCount: health.totalUsers,
        numOfVariations: experiment.variations.length,
        minUsersPerVariation:
          experiment.type === "multi-armed-bandit"
            ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
            : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
      });
      if (srmHealth === "unhealthy") {
        issues.push("Sample ratio mismatch (SRM) detected");
      }
      const multipleExposures = getMultipleExposureHealthData({
        multipleExposuresCount: health.multipleExposures,
        totalUsersCount: health.totalUsers,
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
        minPercentThreshold: healthSettings.multipleExposureMinPercent,
      });
      if (multipleExposures.status === "unhealthy") {
        issues.push("High rate of users exposed to multiple variations");
      }
      if (health.covariateImbalance?.isImbalanced) {
        issues.push("Covariate imbalance detected");
      }
      return {
        applicable: true,
        score: issues.length ? 0 : 1,
        reason: issues.length ? issues.join("; ") : undefined,
      };
    }
    case "health-powered": {
      const power = health?.power;
      if (!power || power.type !== "success") return { applicable: false };
      const dismissed = experiment.dismissedWarnings?.includes("low-power");
      const isPowered = !power.isLowPowered || !!dismissed;
      return {
        applicable: true,
        score: isPowered ? 1 : 0,
        reason: !isPowered
          ? `Experiment is under-powered (needs ~${power.additionalDaysNeeded} more days)`
          : undefined,
      };
    }
    case "min-runtime": {
      if (experiment.status === "draft" || !experiment.phases.length) {
        return { applicable: false };
      }
      const firstPhase = experiment.phases[0];
      const lastPhase = experiment.phases[experiment.phases.length - 1];
      if (!firstPhase.dateStarted) return { applicable: false };
      const start = new Date(firstPhase.dateStarted).getTime();
      if (!Number.isFinite(start)) return { applicable: false };
      const end = lastPhase.dateEnded
        ? new Date(lastPhase.dateEnded).getTime()
        : now.getTime();
      const runtimeDays = Math.max(0, Math.floor((end - start) / MS_PER_DAY));
      const minDays = params?.minRuntimeDays ?? 14;
      const pass = runtimeDays >= minDays;
      return {
        applicable: true,
        score: pass ? 1 : 0,
        reason: pass
          ? undefined
          : `Ran ${runtimeDays} of ${minDays} minimum days`,
      };
    }
  }
}

export function isAICheckApplicable(
  key: AIExperimentQualityCheckKey,
  experiment: ExperimentForQualityScore,
): boolean {
  const hasHypothesis = !!experiment.hypothesis?.trim();
  switch (key) {
    case "ai-hypothesis-quality":
      return hasHypothesis;
    case "ai-hypothesis-metric-alignment":
      return hasHypothesis && experiment.goalMetrics.length > 0;
    case "ai-learnings-quality":
      return experiment.status === "stopped" && !!experiment.analysis?.trim();
  }
}

export function getExperimentQualityScore({
  experiment,
  settings,
  healthSettings,
  goalMetricNames,
  now = new Date(),
}: {
  experiment: ExperimentForQualityScore;
  settings: ResolvedExperimentQualityScoreSettings;
  healthSettings: ExperimentHealthSettings;
  // Names of the experiment's goal metrics, used to detect stale cached AI
  // results (they are part of the AI inputs hash)
  goalMetricNames: string[];
  now?: Date;
}): ExperimentQualityScoreResult {
  const enabledCustomChecks = settings.customAiChecks.filter((c) => c.enabled);
  const currentHash = computeAIQualityInputsHash({
    hypothesis: experiment.hypothesis,
    analysis: experiment.analysis,
    goalMetricNames,
    aiCheckContexts: getAICheckHashInputs(settings),
    experimentDigest: enabledCustomChecks.length
      ? getExperimentDigestForCustomRules(experiment, goalMetricNames)
      : "",
  });
  const aiResults =
    experiment.aiQualityResults?.inputsHash === currentHash
      ? experiment.aiQualityResults
      : undefined;

  let pending = false;
  let totalEnabledCheckCount = 0;
  let appliedCheckCount = 0;

  // Evaluate every enabled check; effW = section share × within-section split
  type Evaluated = {
    section: ExperimentQualitySectionKey;
    effW: number;
    result: ExperimentQualityCheckResult;
  };
  const evaluated: Evaluated[] = [];
  for (const key of experimentQualityCheckKeys) {
    const check = settings.checks[key];
    if (!check.enabled) continue;
    totalEnabledCheckCount++;

    let applicable: boolean;
    let score: number | null = null;
    let reason: string | undefined;

    if (check.type === "deterministic") {
      const res = evaluateDeterministicCheck(
        key as DeterministicExperimentQualityCheckKey,
        experiment,
        healthSettings,
        check.params,
        now,
      );
      applicable = res.applicable;
      score = res.applicable ? (res.score ?? 0) : null;
      reason = res.reason;
    } else {
      const aiKey = key as AIExperimentQualityCheckKey;
      applicable = isAICheckApplicable(aiKey, experiment);
      if (applicable) {
        const cached = aiResults?.checks.find((c) => c.key === aiKey);
        if (cached) {
          score = cached.score;
          reason = cached.reason;
        } else {
          pending = true;
          reason = aiResults?.error
            ? `AI scoring failed: ${aiResults.error}`
            : "AI score not computed yet";
        }
      }
    }

    if (applicable) appliedCheckCount++;

    evaluated.push({
      section: check.section,
      effW: settings.sections[check.section].share * check.split,
      result: {
        key,
        type: check.type,
        label: check.label,
        applicable,
        score,
        reason,
        params: check.params,
      },
    });
  }

  // Custom AI rules: always applicable when enabled — the rule text itself
  // decides how to treat missing fields
  for (const custom of enabledCustomChecks) {
    totalEnabledCheckCount++;
    appliedCheckCount++;
    const cached = aiResults?.checks.find((c) => c.key === custom.key);
    if (!cached) pending = true;
    evaluated.push({
      section: "ai",
      effW: settings.sections.ai.share * custom.split,
      result: {
        key: custom.key,
        type: "ai",
        label: custom.name,
        applicable: true,
        score: cached ? cached.score : null,
        reason: cached
          ? cached.reason
          : aiResults?.error
            ? `AI scoring failed: ${aiResults.error}`
            : "AI score not computed yet",
      },
    });
  }

  // Renormalize: N/A and pending checks leave the denominator
  const scorable = evaluated.filter(
    (e) => e.result.applicable && e.result.score !== null,
  );
  const denominator = scorable.reduce((sum, e) => sum + e.effW, 0);
  const computedScore =
    denominator > EPS
      ? Math.round(
          (100 *
            scorable.reduce(
              (sum, e) => sum + e.effW * (e.result.score ?? 0),
              0,
            )) /
            denominator,
        )
      : null;

  const sections: ExperimentQualitySectionResult[] =
    experimentQualitySectionKeys.map((sectionKey) => {
      const section = settings.sections[sectionKey];
      const sectionChecks = evaluated.filter((e) => e.section === sectionKey);
      const sectionScorable = sectionChecks.filter(
        (e) => e.result.applicable && e.result.score !== null,
      );
      const possiblePoints =
        denominator > EPS
          ? (100 * sectionScorable.reduce((sum, e) => sum + e.effW, 0)) /
            denominator
          : 0;
      const earnedPoints =
        denominator > EPS
          ? (100 *
              sectionScorable.reduce(
                (sum, e) => sum + e.effW * (e.result.score ?? 0),
                0,
              )) /
            denominator
          : 0;
      return {
        key: sectionKey,
        label: section.label,
        enabled: section.enabled,
        applicable: sectionChecks.some((e) => e.result.applicable),
        sharePercent: section.share * 100,
        earnedPoints,
        possiblePoints,
        checks: sectionChecks.map((e) => e.result),
      };
    });

  const override = experiment.qualityScoreOverride ?? null;

  return {
    score: override ? override.score : computedScore,
    computedScore,
    override,
    pending,
    appliedCheckCount,
    totalEnabledCheckCount,
    sections,
  };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

export const QUALITY_CHECK_ATTENTION_THRESHOLD = 0.5;

// Failing checks worth calling out. Exactly 0.5 is the design's amber
// "partial" — not "needs attention". Pending AI checks are excluded.
export function getQualityChecksNeedingAttention(
  result: ExperimentQualityScoreResult,
): ExperimentQualityCheckResult[] {
  return result.sections.flatMap((section) =>
    section.checks.filter(
      (c) =>
        c.applicable &&
        c.score !== null &&
        c.score < QUALITY_CHECK_ATTENTION_THRESHOLD,
    ),
  );
}

/**
 * Largest-remainder rounding: integer values guaranteed to sum to `total`.
 * Used for displayed share percentages so they always total 100.
 */
export function roundToTotal(values: number[], total = 100): number[] {
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum <= EPS) return values.map(() => 0);
  const scaled = values.map((v) => (v / sum) * total);
  const floors = scaled.map(Math.floor);
  let remainder = total - floors.reduce((s, v) => s + v, 0);
  const byRemainder = scaled
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of byRemainder) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type ExperimentQualityScorePresetKey = "default";

export interface ExperimentQualityScorePreset {
  key: ExperimentQualityScorePresetKey;
  label: string;
  description: string;
  config: ExperimentQualityConfigBody;
}

// A single "Default" preset (the catalog defaults); anything else reads as
// "Custom" in the UI
export const EXPERIMENT_QUALITY_PRESETS: ExperimentQualityScorePreset[] = [
  {
    key: "default",
    label: "Default",
    description:
      "The recommended checks and weights: documentation, results, and health checks plus AI review, balanced 35/25/20/20.",
    config: {},
  },
];

// Tolerance for share/split comparison when matching presets. Stored
// weights are integer percentages (e.g. three equal checks become
// 34/33/33), so exact equality against a preset's 1/3 splits never holds —
// anything within a rounding percentage point counts as the same share.
const PRESET_SHARE_TOLERANCE = 0.01;

/**
 * Detects whether a stored config is equivalent to a preset, comparing the
 * RESOLVED, normalized forms (so 35/25/20/20 matches 7/5/4/4, explicit
 * defaults match omitted fields, and integer-rounded shares like 34/33/33
 * match exact thirds). Ignores AI context fields and `enabled`. Returns
 * null when no preset matches ("Custom").
 */
export function configMatchesPreset(
  config?: ExperimentQualityConfigBody | null,
): ExperimentQualityScorePresetKey | null {
  const resolvedCandidate = resolveExperimentQualityScoreSettings(config);
  for (const preset of EXPERIMENT_QUALITY_PRESETS) {
    const resolvedPreset = resolveExperimentQualityScoreSettings(preset.config);
    const sectionsMatch = experimentQualitySectionKeys.every((key) => {
      const a = resolvedCandidate.sections[key];
      const b = resolvedPreset.sections[key];
      return (
        a.enabled === b.enabled &&
        Math.abs(a.share - b.share) < PRESET_SHARE_TOLERANCE
      );
    });
    const checksMatch = experimentQualityCheckKeys.every((key) => {
      const a = resolvedCandidate.checks[key];
      const b = resolvedPreset.checks[key];
      return (
        a.enabled === b.enabled &&
        Math.abs(a.split - b.split) < PRESET_SHARE_TOLERANCE &&
        JSON.stringify(a.params ?? null) === JSON.stringify(b.params ?? null)
      );
    });
    // No preset ships custom AI rules, so any enabled custom rule reads as
    // a custom config
    const customMatch =
      resolvedCandidate.customAiChecks.filter((c) => c.enabled).length ===
      resolvedPreset.customAiChecks.filter((c) => c.enabled).length;
    if (
      sectionsMatch &&
      checksMatch &&
      customMatch &&
      resolvedCandidate.aiChecksEnabled === resolvedPreset.aiChecksEnabled
    ) {
      return preset.key;
    }
  }
  return null;
}
