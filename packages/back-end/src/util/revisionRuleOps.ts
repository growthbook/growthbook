import { FeatureRule } from "shared/types/feature";
import { ruleAppliesToEnv } from "shared/util";

/**
 * Env-scoped CRUD helpers for the v2 flat `FeatureRule[]` array.
 *
 * In v2, rules live on a single top-level array (either `feature.rules` or
 * `revision.rules`). Each rule carries a scope (`allEnvironments: true` OR
 * `environments: [...]`). The legacy UI still operates in per-environment
 * terms ("delete rule 2 in production"), so these helpers project the flat
 * array down to the env the caller asked about, let them mutate by
 * position, and fold the edit back into the flat array preserving order of
 * rules scoped to other envs.
 *
 * Scope decisions (matching the cutover UX):
 *   - Update at env-position `i` mutates the underlying rule in place,
 *     keeping its original scope. A rule with `allEnvironments: true` stays
 *     all-env; a single-env rule stays single-env.
 *   - Delete at env-position `i` removes the rule globally unless the rule
 *     is explicitly multi-env scoped (`environments: [X, Y]`), in which case
 *     we narrow the scope to the remaining envs. Multi-env scope is not
 *     produced by any current write path but the helper is defensive.
 *   - Move at env-position reorders the env-projected slice and re-anchors
 *     the flat array so other-env rules keep their relative positions.
 */

export interface EnvProjection {
  envRules: FeatureRule[];
  parentIndices: number[];
}

export function projectRulesForEnv(
  rules: FeatureRule[],
  environment: string,
): EnvProjection {
  const envRules: FeatureRule[] = [];
  const parentIndices: number[] = [];
  rules.forEach((r, idx) => {
    if (ruleAppliesToEnv(r, environment)) {
      envRules.push(r);
      parentIndices.push(idx);
    }
  });
  return { envRules, parentIndices };
}

export function updateRuleAtEnvIndex(
  rules: FeatureRule[],
  environment: string,
  i: number,
  updater: (existing: FeatureRule) => FeatureRule,
): { rules: FeatureRule[]; updated: FeatureRule; existing: FeatureRule } {
  const { envRules, parentIndices } = projectRulesForEnv(rules, environment);
  const existing = envRules[i];
  if (!existing) {
    throw new Error("Unknown rule");
  }
  const parentIdx = parentIndices[i];
  const updated = updater(existing);
  const next = [
    ...rules.slice(0, parentIdx),
    updated,
    ...rules.slice(parentIdx + 1),
  ];
  return { rules: next, updated, existing };
}

/**
 * Remove the rule projected at env-position `i` from the flat array.
 *
 * Narrowing semantics (aligned with `narrowRuleForEnvRemoval`):
 *   - `allEnvironments: true`                       → narrow to `applicableEnvs \ {env}`
 *                                                    (deletes globally only if that set is empty)
 *   - `environments: [a, b, …]` with size > 1       → drop `env` from the list
 *   - `environments: [env]` (single-env)            → delete globally
 *   - `environments: []` (pending)                  → delete globally (already no footprint)
 *   - `environments: undefined` (permissive)        → treat as allEnvironments
 *
 * The optional `applicableEnvs` arg is the org's applicable env id list
 * (project-filtered). When omitted we fall back to the legacy single-env
 * narrowing: `allEnvironments: true` rules are deleted globally. Callers
 * that hit the v2 contract (controllers, API routes) should always supply
 * `applicableEnvs` so allEnvironments rules narrow correctly.
 */
export function removeRuleAtEnvIndex(
  rules: FeatureRule[],
  environment: string,
  i: number,
  applicableEnvs?: string[],
): { rules: FeatureRule[]; removed: FeatureRule } {
  const { envRules, parentIndices } = projectRulesForEnv(rules, environment);
  const removed = envRules[i];
  if (!removed) {
    throw new Error("Invalid rule index");
  }
  const parentIdx = parentIndices[i];

  const isAllEnvs =
    removed.allEnvironments || removed.environments === undefined;

  if (isAllEnvs) {
    if (applicableEnvs && applicableEnvs.length > 0) {
      const newEnvs = applicableEnvs.filter((e) => e !== environment);
      if (newEnvs.length === 0) {
        const next = [
          ...rules.slice(0, parentIdx),
          ...rules.slice(parentIdx + 1),
        ];
        return { rules: next, removed };
      }
      const narrowed: FeatureRule = {
        ...removed,
        allEnvironments: false,
        environments: newEnvs,
      };
      const next = [
        ...rules.slice(0, parentIdx),
        narrowed,
        ...rules.slice(parentIdx + 1),
      ];
      return { rules: next, removed };
    }
    // Legacy fallback path: no applicableEnvs supplied — delete globally to
    // match pre-v2 single-env behavior.
    const next = [...rules.slice(0, parentIdx), ...rules.slice(parentIdx + 1)];
    return { rules: next, removed };
  }

  if (Array.isArray(removed.environments) && removed.environments.length > 1) {
    const narrowed: FeatureRule = {
      ...removed,
      environments: removed.environments.filter((e) => e !== environment),
    };
    const next = [
      ...rules.slice(0, parentIdx),
      narrowed,
      ...rules.slice(parentIdx + 1),
    ];
    return { rules: next, removed };
  }

  const next = [...rules.slice(0, parentIdx), ...rules.slice(parentIdx + 1)];
  return { rules: next, removed };
}

export function moveRuleInEnv(
  rules: FeatureRule[],
  environment: string,
  from: number,
  to: number,
): { rules: FeatureRule[]; moved: FeatureRule } {
  const { envRules, parentIndices } = projectRulesForEnv(rules, environment);
  if (!envRules[from] || !envRules[to]) {
    throw new Error("Invalid rule index");
  }
  const moved = envRules[from];

  const reorderedEnvRules = [...envRules];
  reorderedEnvRules.splice(from, 1);
  reorderedEnvRules.splice(to, 0, moved);

  const parentIdxSet = new Set(parentIndices);
  const result: FeatureRule[] = [];
  let envCursor = 0;
  rules.forEach((r, idx) => {
    if (parentIdxSet.has(idx)) {
      result.push(reorderedEnvRules[envCursor]);
      envCursor++;
    } else {
      result.push(r);
    }
  });
  return { rules: result, moved };
}

/**
 * Reorder the flat `feature.rules[]` array directly (no env projection).
 * Used when the caller is operating on the "All environments" view where
 * the canonical order of the underlying flat array is unambiguous.
 */
export function moveFlatRule(
  rules: FeatureRule[],
  from: number,
  to: number,
): { rules: FeatureRule[]; moved: FeatureRule } {
  if (!rules[from] || !rules[to]) {
    throw new Error("Invalid rule index");
  }
  const moved = rules[from];
  const reordered = [...rules];
  reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return { rules: reordered, moved };
}

/**
 * Build a v2 rule for the selected env scope. Callers pass the per-request
 * raw rule plus the list of envs the rule should apply to.
 *
 * If the caller marks the inbound rule as `allEnvironments: true`, preserve
 * that semantic (future envs auto-include) and strip the explicit env list.
 * Otherwise stamp an explicit env list and force `allEnvironments: false`.
 */
export function stampRuleForEnvs<T extends FeatureRule>(
  rule: T,
  environments: string[],
): T {
  if (rule.allEnvironments === true) {
    const { environments: _drop, ...rest } = rule;
    return { ...rest, allEnvironments: true } as T;
  }
  return {
    ...rule,
    allEnvironments: false,
    environments,
  };
}
