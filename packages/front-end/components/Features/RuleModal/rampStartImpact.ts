import type { FeatureInterface, FeatureRule } from "shared/types/feature";

// What starting the ramp does to a rule that is already live. A ramp controls
// membership in the rule, so attaching one to a rule that currently serves
// traffic can silently move users onto the next rule or the default value.
export type RampStartImpact =
  | {
      kind: "coverage-drop";
      fromPct: number;
      toPct: number;
    }
  | {
      kind: "disabled-until-start";
      liveCoveragePct: number;
    }
  | null;

export function getRampStartImpact({
  liveRule,
  firstStepCoveragePct,
  hasDelayedStart,
}: {
  // The published version of the ramp's target rule; undefined when the rule
  // only exists in the draft (nothing live to disrupt).
  liveRule: FeatureRule | undefined;
  // The first coverage-controlling step's rollout % (0–100) as entered in the
  // UI; undefined when no step controls coverage.
  firstStepCoveragePct: number | undefined;
  // True when a future start date or a start approval keeps the rule disabled
  // until the ramp starts.
  hasDelayedStart: boolean;
}): RampStartImpact {
  if (!liveRule) return null;
  if (liveRule.enabled === false) return null;

  // A force rule serves 100% of matched traffic; a rollout serves its
  // coverage fraction (legacy docs may lack the field, meaning full coverage).
  // Other rule types can't be ramp targets.
  const liveCoverage =
    liveRule.type === "rollout"
      ? (liveRule.coverage ?? 1)
      : liveRule.type === "force"
        ? 1
        : null;
  if (liveCoverage === null || liveCoverage <= 0) return null;
  const liveCoveragePct = Math.round(liveCoverage * 100);

  if (hasDelayedStart) {
    return { kind: "disabled-until-start", liveCoveragePct };
  }

  if (firstStepCoveragePct === undefined) return null;
  if (firstStepCoveragePct < liveCoveragePct) {
    return {
      kind: "coverage-drop",
      fromPct: liveCoveragePct,
      toPct: firstStepCoveragePct,
    };
  }
  return null;
}

// Counts enabled rules below the target that share an environment with it —
// where traffic that misses the ramped rule could land. They may still not
// match a given user's targeting, so the default value stays the floor.
export function countRampFallthroughRules(
  // Partial: the template editor renders against a stub feature that lacks the
  // field at runtime despite its cast.
  feature: Partial<Pick<FeatureInterface, "rules">>,
  ruleId: string | undefined,
): number {
  const rules = feature.rules ?? [];
  const idx = ruleId ? rules.findIndex((r) => r.id === ruleId) : -1;
  const target = idx >= 0 ? rules[idx] : undefined;
  // null = all environments. Legacy rules with neither `allEnvironments` nor
  // `environments` are permissive, matching `ruleAppliesToEnv`'s contract.
  const envScope = (r: FeatureRule) =>
    r.allEnvironments === true || r.environments === undefined
      ? null
      : r.environments;
  const targetEnvs = target ? envScope(target) : null;
  const targetEnvSet = targetEnvs ? new Set(targetEnvs) : null;
  const rulesBelow = idx >= 0 ? rules.slice(idx + 1) : [];
  return rulesBelow.filter((r) => {
    if (r.enabled === false) return false;
    const envs = envScope(r);
    if (!targetEnvSet || !envs) return true;
    return envs.some((e) => targetEnvSet.has(e));
  }).length;
}
