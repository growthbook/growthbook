// Import the specific validator files, NOT the shared/validators barrel:
// the barrel evaluates safe-rollout-snapshot, which imports shared/enterprise
// back — a module-initialization cycle that leaves validators undefined.
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import {
  AIExperimentQualityCheckKey,
  ExperimentAIQualityResults,
  ExperimentProcessResults,
  ExperimentQualityScoreOverride,
  ProcessExperimentQualityCheckKey,
  aiExperimentQualityCheckKeys,
} from "../validators/experiments";
import {
  DeterministicExperimentQualityCheckKey,
  ExperimentQualityCheckKey,
  ExperimentQualityCheckParams,
  ExperimentQualityConfigBody,
  ExperimentQualitySectionKey,
  MAX_CUSTOM_QUALITY_CHECKS,
  experimentQualityCheckKeys,
  experimentQualitySectionKeys,
} from "../validators/experiment-quality-score";
import { canJudgeProcess, hasCurrentProcessResults } from "./experimentProcess";

// Process checks are judged from cached change-history results
export type ExperimentQualityCheckType = "deterministic" | "process" | "ai";

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
export const EXPERIMENT_QUALITY_PROMPT_VERSION = 8;

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface ExperimentQualitySectionDefinition {
  label: string;
  // When the section's checks apply, shown next to its label
  note?: string;
  // Raw cross-section share weight; defaults total 100 so raw weights read
  // as percentages, but only the normalized ratio matters
  defaultWeight: number;
}

export const EXPERIMENT_QUALITY_SECTIONS: Record<
  ExperimentQualitySectionKey,
  ExperimentQualitySectionDefinition
> = {
  documentation: { label: "Documentation", defaultWeight: 40 },
  process: {
    label: "Process",
    note: "stopped experiments only, from change history",
    defaultWeight: 30,
  },
  ai: {
    label: "AI checks",
    note: "judged by AI, cached until inputs change",
    defaultWeight: 30,
  },
};

export interface ExperimentQualityCheckDefinition {
  section: ExperimentQualitySectionKey;
  type: ExperimentQualityCheckType;
  label: string;
  // When the check applies, shown next to its label
  note?: string;
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
    defaultEnabled: true,
  },
  description: {
    section: "documentation",
    type: "deterministic",
    label: "Has a description",
    defaultEnabled: true,
  },
  screenshots: {
    section: "documentation",
    type: "deterministic",
    label: "Has screenshots",
    note: "all except Holdouts",
    defaultEnabled: false,
  },
  "tags-or-project": {
    section: "documentation",
    type: "deterministic",
    label: "Organized with tags or a Project",
    defaultEnabled: true,
  },
  "goal-metrics": {
    section: "documentation",
    type: "deterministic",
    label: "Has goal metrics",
    defaultEnabled: true,
    defaultParams: { maxGoalMetrics: 3 },
  },
  decision: {
    section: "documentation",
    type: "deterministic",
    label: "Decision recorded",
    note: "stopped experiments only",
    defaultEnabled: true,
  },
  "goal-metrics-locked": {
    section: "process",
    type: "process",
    label: "Goal metrics set before the start and unchanged",
    defaultEnabled: true,
  },
  "hypothesis-locked": {
    section: "process",
    type: "process",
    label: "Hypothesis written before the start and unchanged",
    defaultEnabled: true,
  },
  "stable-assignment": {
    section: "process",
    type: "process",
    label: "Traffic split and targeting unchanged within a phase",
    defaultEnabled: true,
  },
  "stable-analysis": {
    section: "process",
    type: "process",
    label: "Analysis settings unchanged while running",
    defaultEnabled: true,
  },
  "no-early-stop": {
    section: "process",
    type: "process",
    label: "Not stopped early",
    defaultEnabled: true,
    defaultParams: { minRuntimeDays: 14 },
  },
  "clean-restarts": {
    section: "process",
    type: "process",
    label: "New phases re-randomized users",
    defaultEnabled: true,
  },
  "planned-end": {
    section: "process",
    type: "process",
    label: "End date scheduled before the start",
    note: "any end action, including notify only",
    defaultEnabled: false,
  },
  "ai-hypothesis-quality": {
    section: "ai",
    type: "ai",
    label: "Hypothesis quality",
    defaultEnabled: true,
  },
  "ai-hypothesis-metric-alignment": {
    section: "ai",
    type: "ai",
    label: "Metrics align with hypothesis",
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
  // An equal share of the section across enabled checks; 0 when disabled
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
  // An equal share of the AI section alongside built-in AI checks
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
 * Expands a scope's stored checks (undefined for the built-in defaults) into
 * a fully-populated, normalized config. Missing fields fall back to catalog
 * defaults. The enabled gate is resolved separately via resolveQualityScope.
 */
export function resolveExperimentQualityScoreSettings(
  cfg?: ExperimentQualityConfigBody | null,
): ResolvedExperimentQualityScoreSettings {
  const aiChecksEnabled = cfg?.aiChecksEnabled ?? true;

  // Pass 1: check flags
  const checkEnabled = {} as Record<ExperimentQualityCheckKey, boolean>;
  for (const key of experimentQualityCheckKeys) {
    checkEnabled[key] =
      cfg?.checks?.[key]?.enabled ??
      EXPERIMENT_QUALITY_CHECKS[key].defaultEnabled;
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

  // Pass 4: fold section enablement into checks; enabled checks (and custom
  // AI rules) split their section equally
  const customAiChecks: ResolvedCustomQualityCheck[] = storedCustomChecks.map(
    (c) => ({
      id: c.id,
      key: customQualityCheckKey(c.id),
      name: c.name,
      rule: c.rule,
      enabled: (c.enabled ?? true) && sections.ai.enabled,
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
    const enabledCount = enabledChecks.length + enabledCustom.length;
    const splitFor = (enabled: boolean) => (enabled ? 1 / enabledCount : 0);
    for (const key of sectionChecks) {
      const def = EXPERIMENT_QUALITY_CHECKS[key];
      const isEnabled = checkEnabled[key] && sections[sectionKey].enabled;
      checks[key] = {
        key,
        section: sectionKey,
        type: def.type,
        label: def.label,
        enabled: isEnabled,
        split: splitFor(isEnabled),
        params: sanitizeParams(key, cfg?.checks?.[key]?.params),
        aiContext:
          def.type === "ai" ? cfg?.checks?.[key]?.aiContext : undefined,
      };
    }
    if (sectionKey === "ai") {
      for (const custom of customAiChecks) {
        custom.split = splitFor(custom.enabled);
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

// Whether an edit could change an AI verdict. The built-in AI checks read
// the hypothesis and goal metrics, and custom rules read the whole digest,
// which includes both.
export function haveAIQualityInputsChanged(
  before: ExperimentForQualityScore,
  after: ExperimentForQualityScore,
): boolean {
  return (
    getExperimentDigestForCustomRules(before, before.goalMetrics) !==
    getExperimentDigestForCustomRules(after, after.goalMetrics)
  );
}

export function computeAIQualityInputsHash({
  hypothesis,
  goalMetricNames,
  aiCheckContexts,
  experimentDigest = "",
}: {
  hypothesis?: string;
  goalMetricNames: string[];
  aiCheckContexts: Array<[string, string]>;
  experimentDigest?: string;
}): string {
  return cyrb53(
    JSON.stringify([
      EXPERIMENT_QUALITY_PROMPT_VERSION,
      hypothesis ?? "",
      [...goalMetricNames].sort(),
      aiCheckContexts,
      experimentDigest,
    ]),
  );
}

// Goal metric names as the AI judge sees them. Metrics that can't be found
// are dropped, the same way on the front-end and back-end, so both compute
// the same inputs hash.
export function getGoalMetricNames(
  goalMetricIds: string[],
  getName: (id: string) => string | undefined,
): string[] {
  return goalMetricIds
    .map((id) => getName(id))
    .filter((name): name is string => !!name);
}

// The current AI inputs hash for an experiment under the given settings
export function getAIQualityInputsHash(
  experiment: ExperimentForQualityScore,
  settings: ResolvedExperimentQualityScoreSettings,
  goalMetricNames: string[],
): string {
  const hasCustomRules = settings.customAiChecks.some((c) => c.enabled);
  return computeAIQualityInputsHash({
    hypothesis: experiment.hypothesis,
    goalMetricNames,
    aiCheckContexts: getAICheckHashInputs(settings),
    // Custom rules read the whole experiment, so any change to it must
    // invalidate their verdicts
    experimentDigest: hasCustomRules
      ? getExperimentDigestForCustomRules(experiment, goalMetricNames)
      : "",
  });
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
> & {
  processResults?: Pick<ExperimentProcessResults, "version"> & {
    rules: Array<
      Omit<ExperimentProcessResults["rules"][number], "date"> & {
        date?: Date | string;
      }
    >;
  };
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
  // Who made the change a process check failed on, and when
  evidence?: { user?: string; date?: Date | string };
  params?: ExperimentQualityCheckParams;
  // Points on the 0-100 scale, like the section's; both 0 when not scored
  earnedPoints: number;
  possiblePoints: number;
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
  params: ExperimentQualityCheckParams | undefined,
): CheckEvaluation {
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
    case "decision": {
      if (experiment.status !== "stopped") return { applicable: false };
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
  }
}

// Days from the first start to the end of the last phase (or now)
function getRuntimeDays(
  experiment: ExperimentForQualityScore,
  now: Date,
): number | null {
  const firstStart = experiment.phases[0]?.dateStarted;
  if (!firstStart) return null;
  const start = new Date(firstStart).getTime();
  if (!Number.isFinite(start)) return null;
  const lastEnd = experiment.phases[experiment.phases.length - 1]?.dateEnded;
  const end = lastEnd ? new Date(lastEnd).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

type CheckEvaluation = {
  applicable: boolean;
  score?: number;
  reason?: string;
  evidence?: ExperimentQualityCheckResult["evidence"];
};

function evaluateProcessCheck(
  key: ProcessExperimentQualityCheckKey,
  experiment: ExperimentForQualityScore,
  params: ExperimentQualityCheckParams | undefined,
  now: Date,
): CheckEvaluation & { calculating?: boolean } {
  if (!canJudgeProcess(experiment)) return { applicable: false };
  if (!experiment.processResults || !hasCurrentProcessResults(experiment)) {
    return { applicable: true, calculating: true };
  }
  const cached = experiment.processResults.rules.find((r) => r.key === key);

  // Without a scheduled end, an early stop is judged against the minimum
  // runtime instead
  if (key === "no-early-stop" && (!cached || cached.result === "na")) {
    const runtimeDays = getRuntimeDays(experiment, now);
    if (runtimeDays === null) return { applicable: false };
    const minDays = params?.minRuntimeDays ?? 14;
    const pass = runtimeDays >= minDays;
    return {
      applicable: true,
      score: pass ? 1 : 0,
      reason: pass
        ? undefined
        : `Stopped after ${runtimeDays} of the ${minDays} minimum days`,
    };
  }

  if (!cached || cached.result === "na") return { applicable: false };
  if (cached.result === "pass") return { applicable: true, score: 1 };
  return {
    applicable: true,
    score: 0,
    reason: cached.detail,
    evidence: { user: cached.user, date: cached.date },
  };
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
  }
}

export function getExperimentQualityScore({
  experiment,
  settings,
  goalMetricNames,
  now = new Date(),
}: {
  experiment: ExperimentForQualityScore;
  settings: ResolvedExperimentQualityScoreSettings;
  // Names of the experiment's goal metrics, used to detect stale cached AI
  // results (they are part of the AI inputs hash)
  goalMetricNames: string[];
  now?: Date;
}): ExperimentQualityScoreResult {
  const aiResults =
    experiment.aiQualityResults?.inputsHash ===
    getAIQualityInputsHash(experiment, settings, goalMetricNames)
      ? experiment.aiQualityResults
      : undefined;

  let pending = false;
  // A fresh cached AI verdict, or a pending reason when there isn't one
  const lookupAIVerdict = (key: string) => {
    const cached = aiResults?.checks.find((c) => c.key === key);
    if (cached) return { score: cached.score, reason: cached.reason };
    pending = true;
    return {
      score: null,
      reason: aiResults?.error
        ? `AI scoring failed: ${aiResults.error}`
        : "AI score not computed yet",
    };
  };
  let totalEnabledCheckCount = 0;
  let appliedCheckCount = 0;

  // Evaluate every enabled check; effW = section share × within-section split
  type Evaluated = {
    section: ExperimentQualitySectionKey;
    effW: number;
    result: Omit<
      ExperimentQualityCheckResult,
      "earnedPoints" | "possiblePoints"
    >;
  };
  const evaluated: Evaluated[] = [];
  for (const key of experimentQualityCheckKeys) {
    const check = settings.checks[key];
    if (!check.enabled) continue;
    totalEnabledCheckCount++;

    let applicable: boolean;
    let score: number | null = null;
    let reason: string | undefined;
    let evidence: ExperimentQualityCheckResult["evidence"];

    if (check.type === "process") {
      const res = evaluateProcessCheck(
        key as ProcessExperimentQualityCheckKey,
        experiment,
        check.params,
        now,
      );
      applicable = res.applicable;
      // Results still being calculated leave the denominator, like a
      // pending AI verdict
      score = res.applicable && !res.calculating ? (res.score ?? 0) : null;
      reason = res.calculating ? "Still being calculated" : res.reason;
      evidence = res.evidence;
    } else if (check.type === "deterministic") {
      const res = evaluateDeterministicCheck(
        key as DeterministicExperimentQualityCheckKey,
        experiment,
        check.params,
      );
      applicable = res.applicable;
      score = res.applicable ? (res.score ?? 0) : null;
      reason = res.reason;
    } else if (!experiment.hypothesis?.trim()) {
      // The built-in AI checks judge the hypothesis, so without one they fail
      applicable = true;
      score = 0;
      reason = NO_HYPOTHESIS_REASON;
    } else {
      applicable = isAICheckApplicable(
        key as AIExperimentQualityCheckKey,
        experiment,
      );
      if (applicable) ({ score, reason } = lookupAIVerdict(key));
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
        evidence,
        params: check.params,
      },
    });
  }

  // Custom AI rules: always applicable when enabled — the rule text itself
  // decides how to treat missing fields
  for (const custom of settings.customAiChecks.filter((c) => c.enabled)) {
    totalEnabledCheckCount++;
    appliedCheckCount++;
    evaluated.push({
      section: "ai",
      effW: settings.sections.ai.share * custom.split,
      result: {
        key: custom.key,
        type: "ai",
        label: custom.name,
        applicable: true,
        ...lookupAIVerdict(custom.key),
      },
    });
  }

  // Renormalize: N/A and pending checks leave the denominator
  const isScorable = (e: Evaluated) =>
    e.result.applicable && e.result.score !== null;
  const denominator = evaluated
    .filter(isScorable)
    .reduce((sum, e) => sum + e.effW, 0);
  // Points on the 0-100 scale: possible (score treated as 1) or earned
  const points = (list: Evaluated[], earned: boolean) =>
    denominator > EPS
      ? (100 *
          list
            .filter(isScorable)
            .reduce(
              (sum, e) => sum + e.effW * (earned ? (e.result.score ?? 0) : 1),
              0,
            )) /
        denominator
      : 0;
  const computedScore =
    denominator > EPS ? Math.round(points(evaluated, true)) : null;

  const sections: ExperimentQualitySectionResult[] =
    experimentQualitySectionKeys.map((sectionKey) => {
      const section = settings.sections[sectionKey];
      const sectionChecks = evaluated.filter((e) => e.section === sectionKey);
      return {
        key: sectionKey,
        label: section.label,
        enabled: section.enabled,
        applicable: sectionChecks.some((e) => e.result.applicable),
        sharePercent: section.share * 100,
        earnedPoints: points(sectionChecks, true),
        possiblePoints: points(sectionChecks, false),
        checks: sectionChecks.map((e) => ({
          ...e.result,
          earnedPoints: points([e], true),
          possiblePoints: points([e], false),
        })),
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

// Why the built-in AI checks fail when there's no hypothesis
export const NO_HYPOTHESIS_REASON = "No hypothesis";

// A check scoring at or above this passes; below it needs attention
export const QUALITY_CHECK_PASS_THRESHOLD = 0.5;

export type QualityImprovement = ExperimentQualityCheckResult & {
  // Points the score would gain if this check passed fully
  gain: number;
};

/**
 * What would raise the score most, largest gain first. Process checks are
 * left out: how an experiment was run can't be changed afterwards.
 */
export function getQualityImprovements(
  result: ExperimentQualityScoreResult,
): QualityImprovement[] {
  const all = result.sections
    .flatMap((section) => section.checks)
    .filter((check) => check.type !== "process")
    .map((check) => ({
      ...check,
      gain: check.possiblePoints - check.earnedPoints,
    }));
  // Writing the hypothesis also fixes the AI checks failing for lack of one
  const addHypothesis = all.find((c) => c.key === "hypothesis" && c.gain > 0);
  const improvements = addHypothesis
    ? all
        .filter((c) => c.reason !== NO_HYPOTHESIS_REASON)
        .map((c) =>
          c === addHypothesis
            ? {
                ...c,
                gain: all
                  .filter((o) => o === c || o.reason === NO_HYPOTHESIS_REASON)
                  .reduce((sum, o) => sum + o.gain, 0),
              }
            : c,
        )
    : all;
  return improvements
    .filter((check) => check.gain >= 0.5)
    .sort((a, b) => b.gain - a.gain);
}

// ---------------------------------------------------------------------------
// Share math for the settings editors
// ---------------------------------------------------------------------------

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

/**
 * Sets one share and re-flows the others in proportion so the integer
 * shares keep totalling `total` (others split evenly when all are 0).
 */
export function reflowShares(
  shares: number[],
  index: number,
  newShare: number,
  total = 100,
): number[] {
  if (shares.length <= 1) return shares.map(() => total);
  const clamped = Math.min(Math.max(Math.round(newShare), 0), total);
  const others = shares.filter((_, i) => i !== index);
  const otherSum = others.reduce((s, v) => s + v, 0);
  const redistributed = roundToTotal(
    otherSum > EPS ? others : others.map(() => 1),
    total - clamped,
  );
  let next = 0;
  return shares.map((_, i) => (i === index ? clamped : redistributed[next++]));
}
