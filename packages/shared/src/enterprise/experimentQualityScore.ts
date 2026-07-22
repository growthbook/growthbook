import {
  AIExperimentQualityCheckKey,
  ExperimentAIQualityResults,
} from "shared/validators";
import {
  ExperimentHealthSettings,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import {
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
} from "../constants";
import { getMultipleExposureHealthData, getSRMHealthData } from "../health";

export const deterministicExperimentQualityCheckKeys = [
  "hypothesis",
  "description",
  "screenshots",
  "tags-or-project",
  "goal-metrics",
  "decision",
  "learnings",
  "health-no-issues",
  "health-powered",
] as const;
export type DeterministicExperimentQualityCheckKey =
  (typeof deterministicExperimentQualityCheckKeys)[number];

export type ExperimentQualityCheckKey =
  | DeterministicExperimentQualityCheckKey
  | AIExperimentQualityCheckKey;

export type ExperimentQualityCheckType = "deterministic" | "ai";

// Bump when the quality prompt or verdict schema changes so cached AI
// results are recomputed with the new prompt.
export const EXPERIMENT_QUALITY_PROMPT_VERSION = 1;

export interface ExperimentQualityCheckDefinition {
  type: ExperimentQualityCheckType;
  weight: number;
  label: string;
}

export const DEFAULT_EXPERIMENT_QUALITY_CHECKS: Record<
  ExperimentQualityCheckKey,
  ExperimentQualityCheckDefinition
> = {
  hypothesis: { type: "deterministic", weight: 1, label: "Has a hypothesis" },
  description: { type: "deterministic", weight: 1, label: "Has a description" },
  screenshots: { type: "deterministic", weight: 1, label: "Has screenshots" },
  "tags-or-project": {
    type: "deterministic",
    weight: 1,
    label: "Organized with tags or a project",
  },
  "goal-metrics": {
    type: "deterministic",
    weight: 1,
    label: "Has goal metrics",
  },
  decision: { type: "deterministic", weight: 1, label: "Decision recorded" },
  learnings: {
    type: "deterministic",
    weight: 1,
    label: "Learnings documented",
  },
  "health-no-issues": {
    type: "deterministic",
    weight: 1,
    label: "No major health issues",
  },
  "health-powered": {
    type: "deterministic",
    weight: 1,
    label: "Well powered",
  },
  "ai-hypothesis-quality": {
    type: "ai",
    weight: 1,
    label: "Hypothesis quality (AI)",
  },
  "ai-hypothesis-metric-alignment": {
    type: "ai",
    weight: 1,
    label: "Metrics align with hypothesis (AI)",
  },
  "ai-learnings-quality": {
    type: "ai",
    weight: 1,
    label: "Learnings quality (AI)",
  },
};

export const experimentQualityCheckKeys = Object.keys(
  DEFAULT_EXPERIMENT_QUALITY_CHECKS,
) as ExperimentQualityCheckKey[];

export interface ExperimentQualityScoreSettings {
  enabled: boolean;
  aiChecksEnabled: boolean;
  aiContext?: string;
  checks?: Partial<
    Record<ExperimentQualityCheckKey, { enabled: boolean; weight?: number }>
  >;
}

export interface ResolvedExperimentQualityScoreSettings {
  enabled: boolean;
  aiChecksEnabled: boolean;
  aiContext: string;
  checks: Record<
    ExperimentQualityCheckKey,
    ExperimentQualityCheckDefinition & { enabled: boolean }
  >;
}

export function resolveExperimentQualityScoreSettings(
  settings?: ExperimentQualityScoreSettings,
): ResolvedExperimentQualityScoreSettings {
  const checks = {} as ResolvedExperimentQualityScoreSettings["checks"];
  for (const key of experimentQualityCheckKeys) {
    const def = DEFAULT_EXPERIMENT_QUALITY_CHECKS[key];
    const override = settings?.checks?.[key];
    checks[key] = {
      ...def,
      enabled: override?.enabled ?? true,
      weight: override?.weight ?? def.weight,
    };
  }
  return {
    enabled: settings?.enabled ?? false,
    aiChecksEnabled: settings?.aiChecksEnabled ?? true,
    aiContext: settings?.aiContext ?? "",
    checks,
  };
}

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

export function computeAIQualityInputsHash({
  hypothesis,
  analysis,
  goalMetricNames,
  aiContext,
}: {
  hypothesis?: string;
  analysis?: string;
  goalMetricNames: string[];
  aiContext: string;
}): string {
  return cyrb53(
    JSON.stringify([
      EXPERIMENT_QUALITY_PROMPT_VERSION,
      hypothesis ?? "",
      analysis ?? "",
      [...goalMetricNames].sort(),
      aiContext,
    ]),
  );
}

export type ExperimentForQualityScore = Pick<
  ExperimentInterface | ExperimentInterfaceStringDates,
  | "type"
  | "status"
  | "hypothesis"
  | "description"
  | "tags"
  | "project"
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
};

export interface ExperimentQualityCheckResult {
  key: ExperimentQualityCheckKey;
  type: ExperimentQualityCheckType;
  label: string;
  applicable: boolean;
  weight: number;
  // 0-1 for evaluated checks; null when an applicable AI check has no
  // (fresh) cached result yet. Inapplicable checks are always null.
  score: number | null;
  reason?: string;
}

export interface ExperimentQualityScoreResult {
  // 0-100 over applicable, enabled, evaluated checks; null when nothing
  // is scorable (e.g. every check disabled).
  score: number | null;
  // True when at least one applicable AI check has no fresh result yet
  pending: boolean;
  checks: ExperimentQualityCheckResult[];
}

function evaluateDeterministicCheck(
  key: DeterministicExperimentQualityCheckKey,
  experiment: ExperimentForQualityScore,
  healthSettings: ExperimentHealthSettings,
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
    case "goal-metrics":
      return { applicable: true, score: experiment.goalMetrics.length ? 1 : 0 };
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
}: {
  experiment: ExperimentForQualityScore;
  settings: ResolvedExperimentQualityScoreSettings;
  healthSettings: ExperimentHealthSettings;
  // Names of the experiment's goal metrics, used to detect stale cached AI
  // results (they are part of the AI inputs hash)
  goalMetricNames: string[];
}): ExperimentQualityScoreResult {
  const currentHash = computeAIQualityInputsHash({
    hypothesis: experiment.hypothesis,
    analysis: experiment.analysis,
    goalMetricNames,
    aiContext: settings.aiContext,
  });
  const aiResults =
    experiment.aiQualityResults?.inputsHash === currentHash
      ? experiment.aiQualityResults
      : undefined;

  const checks: ExperimentQualityCheckResult[] = [];
  let pending = false;

  for (const key of experimentQualityCheckKeys) {
    const config = settings.checks[key];
    const base = {
      key,
      type: config.type,
      label: config.label,
      weight: config.weight,
    };
    if (!config.enabled) {
      checks.push({ ...base, applicable: false, score: null });
      continue;
    }
    if (config.type === "deterministic") {
      const result = evaluateDeterministicCheck(
        key as DeterministicExperimentQualityCheckKey,
        experiment,
        healthSettings,
      );
      checks.push({
        ...base,
        applicable: result.applicable,
        score: result.applicable ? (result.score ?? 0) : null,
        reason: result.reason,
      });
      continue;
    }
    // AI checks
    const aiKey = key as AIExperimentQualityCheckKey;
    const applicable =
      settings.aiChecksEnabled && isAICheckApplicable(aiKey, experiment);
    if (!applicable) {
      checks.push({ ...base, applicable: false, score: null });
      continue;
    }
    const cached = aiResults?.checks.find((c) => c.key === aiKey);
    if (cached) {
      checks.push({
        ...base,
        applicable: true,
        score: cached.score,
        reason: cached.reason,
      });
    } else {
      pending = true;
      checks.push({
        ...base,
        applicable: true,
        score: null,
        reason: aiResults?.error
          ? `AI scoring failed: ${aiResults.error}`
          : "AI score not computed yet",
      });
    }
  }

  const scorable = checks.filter((c) => c.applicable && c.score !== null);
  const totalWeight = scorable.reduce((sum, c) => sum + c.weight, 0);
  const score =
    totalWeight > 0
      ? Math.round(
          (100 *
            scorable.reduce((sum, c) => sum + c.weight * (c.score ?? 0), 0)) /
            totalWeight,
        )
      : null;

  return { score, pending, checks };
}
