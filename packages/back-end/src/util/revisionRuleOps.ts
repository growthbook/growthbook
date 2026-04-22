import { FeatureRule } from "shared/types/feature";
import { ruleAppliesToEnv } from "shared/util";

/**
 * Env-scoped CRUD helpers for the v2 flat `FeatureRule[]` array.
 *
 * The legacy UI addresses rules per-environment ("rule 2 in production"), so
 * these helpers project the flat array down to one env, mutate by position,
 * then fold the edit back preserving order of other-env rules.
 *
 * Delete narrowing: `allEnvironments: true` → narrow to `applicableEnvs \ {env}`
 * (or delete globally when empty); multi-env rule → drop `env` from the list;
 * single-env rule → delete globally.
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

// Update a rule by its stable id. Works for all-env, single-env, and
// pending rules (`environments: []`) that don't project into any env.
export function updateRuleById(
  rules: FeatureRule[],
  ruleId: string,
  updater: (existing: FeatureRule) => FeatureRule,
): { rules: FeatureRule[]; updated: FeatureRule; existing: FeatureRule } {
  const idx = rules.findIndex((r) => r.id === ruleId);
  if (idx === -1) throw new Error("Unknown rule");
  const existing = rules[idx];
  const updated = updater(existing);
  const next = [...rules.slice(0, idx), updated, ...rules.slice(idx + 1)];
  return { rules: next, updated, existing };
}

// Update by flat (unfiltered) index. Fallback when no `ruleId` is available.
export function updateRuleAtFlatIndex(
  rules: FeatureRule[],
  i: number,
  updater: (existing: FeatureRule) => FeatureRule,
): { rules: FeatureRule[]; updated: FeatureRule; existing: FeatureRule } {
  const existing = rules[i];
  if (!existing) throw new Error("Unknown rule");
  const updated = updater(existing);
  const next = [...rules.slice(0, i), updated, ...rules.slice(i + 1)];
  return { rules: next, updated, existing };
}

// Remove the rule at env-position `i` (see `narrowRuleForEnvRemoval` for
// narrowing rules). v2 callers should always pass `applicableEnvs`; omitting
// it triggers legacy behavior (all-env rules delete globally).
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
    // Legacy fallback: no applicableEnvs supplied → delete globally.
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

// Remove a rule by its stable id. Removes globally regardless of scope,
// including pending rules (`environments: []`).
export function removeRuleById(
  rules: FeatureRule[],
  ruleId: string,
): { rules: FeatureRule[]; removed: FeatureRule } {
  const idx = rules.findIndex((r) => r.id === ruleId);
  if (idx === -1) throw new Error("Unknown rule");
  const removed = rules[idx];
  const next = [...rules.slice(0, idx), ...rules.slice(idx + 1)];
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

// Reorder the flat array directly (no env projection). Used by the
// "All environments" view where flat order is canonical.
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

// Stamp a rule with an explicit env list (forces `allEnvironments: false`).
export function stampRuleForEnvs<T extends FeatureRule>(
  rule: T,
  environments: string[],
): T {
  return {
    ...rule,
    allEnvironments: false,
    environments,
  };
}
