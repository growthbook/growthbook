import type { FeatureInterface, FeatureRule } from "shared/types/feature";

// What starting the ramp does to a rule that is already live.
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
  // Published target rule; undefined when nothing live would be disrupted.
  liveRule: FeatureRule | undefined;
  // First coverage-controlling step's rollout % (0–100).
  firstStepCoveragePct: number | undefined;
  // A future start date or start approval disables the rule until start.
  hasDelayedStart: boolean;
}): RampStartImpact {
  if (!liveRule) return null;
  if (liveRule.enabled === false) return null;

  // Force rules serve 100%; legacy rollouts may lack coverage (means full).
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

// Enabled rules below the target sharing an environment with it — where
// traffic that misses the ramped rule could land.
export function countRampFallthroughRules(
  // Partial: the template editor passes a stub feature.
  feature: Partial<Pick<FeatureInterface, "rules">>,
  ruleId: string | undefined,
): number {
  const rules = feature.rules ?? [];
  const idx = ruleId ? rules.findIndex((r) => r.id === ruleId) : -1;
  const target = idx >= 0 ? rules[idx] : undefined;
  // null = all environments (legacy rules with neither field are permissive).
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
