import isEqual from "lodash/isEqual";
import { FeatureRule, V1FeatureRule } from "shared/validators";
import { Environment } from "shared/types/organization";
import {
  isMigrationSuffixedRuleId,
  parseRuleId,
  stemRuleId,
  suffixRuleId,
} from "shared/util";

// Re-exported for back-end callers; new code should import from shared/validators.
export type { V1FeatureRule };

// Schema generations (v0 / v1 / v2) are documented in `shared/types/feature.d.ts`.
// Rule-id `__<env>` suffix convention lives in `shared/src/util/ruleId.ts`.

export type V1RulesByEnv = Record<string, V1FeatureRule[]>;

export function isV2RevisionRules(rules: unknown): rules is FeatureRule[] {
  return Array.isArray(rules);
}

// v2 has no populated `env.rules`. Relies on `buildFeatureUpdate` scrubbing
// `env.rules` from every $set payload — any new write path that touches
// `environmentSettings` MUST route through it.
export function isV2FeatureEnvSettings(
  envSettings: Record<string, { rules?: unknown } | undefined>,
): boolean {
  for (const env of Object.values(envSettings)) {
    if (!env || typeof env !== "object") continue;
    if (!("rules" in env)) continue;
    const rules = (env as { rules?: unknown }).rules;
    if (rules === undefined) continue;
    if (Array.isArray(rules) && rules.length === 0) continue;
    return false;
  }
  return true;
}

// Called at persist chokepoints to turn silent id collisions into loud failures.
export function assertUniqueRuleIds(rules: FeatureRule[], ctx: string): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rules) {
    if (!r?.id) continue;
    if (seen.has(r.id)) dupes.add(r.id);
    seen.add(r.id);
  }
  if (dupes.size > 0) {
    throw new Error(
      `Duplicate rule id(s) in ${ctx}: ${Array.from(dupes).join(", ")}. ` +
        `Each v2 rule must have a unique id; per-env scope is encoded via allEnvironments/environments.`,
    );
  }
}

export function getApplicableEnvIds(
  orgEnvs: Environment[],
  featureProject?: string,
): string[] {
  return orgEnvs
    .filter((env) => {
      if (!featureProject) return true;
      if (!env.projects?.length) return true;
      return env.projects.includes(featureProject);
    })
    .map((env) => env.id);
}

// Footprint of a v2 rule, intersected with `applicableEnvs`. Must stay in sync
// with shared `ruleAppliesToEnv`.
//   allEnvironments:true            → every applicable env
//   environments:[list]             → list ∩ applicable
//   environments:[]                 → [] (pending)
//   neither field declared (legacy) → every applicable env
export function ruleFootprint(
  rule: FeatureRule,
  applicableEnvs: string[],
): string[] {
  if (rule.allEnvironments) return applicableEnvs;
  if (rule.environments === undefined) return applicableEnvs;
  const applicableSet = new Set(applicableEnvs);
  return rule.environments.filter((e) => applicableSet.has(e));
}

// Remove `environment` from a rule's footprint (the v1 REST DELETE contract).
// Returns `{action: "delete"}` when the footprint becomes empty — callers are
// responsible for side-effect cleanup (ramp actions, SafeRollout). Pure.
export type NarrowRuleDecision =
  | { action: "delete" }
  | { action: "narrow"; rule: FeatureRule };

export function narrowRuleForEnvRemoval(
  rule: FeatureRule,
  environment: string,
  applicableEnvs: string[],
): NarrowRuleDecision {
  const currentFootprint = ruleFootprint(rule, applicableEnvs);
  const newFootprint = currentFootprint.filter((e) => e !== environment);
  if (newFootprint.length === 0) return { action: "delete" };
  return {
    action: "narrow",
    rule: {
      ...rule,
      allEnvironments: false,
      environments: newFootprint,
    } as FeatureRule,
  };
}

export interface RampTargetQuery {
  ruleId?: string | null;
  environment?: string | null;
}

// Resolve a ramp target to every matching unified rule. Semantics by
// (ruleId shape, environment?):
//   (bare, env)      → match stem or stem__env, filtered by rule scope
//   (suffixed, env)  → stemmed; falls through to (bare, env)
//   (bare, no env)   → stem fan-out across all env siblings
//   (suffixed, no env) → exact id match
// `target.environment` is retained for pre-migration stored ramps.
export function resolveRampTargets(
  target: RampTargetQuery,
  unifiedRules: FeatureRule[],
): FeatureRule[] {
  if (!target.ruleId) return [];
  const stem = stemRuleId(target.ruleId);

  if (target.environment) {
    const env = target.environment;
    const suffixed = suffixRuleId(stem, env);
    return unifiedRules.filter((r) => {
      if (r.id !== stem && r.id !== suffixed) return false;
      if (r.allEnvironments) return true;
      return r.environments?.includes(env) ?? false;
    });
  }

  // No env supplied.
  if (isMigrationSuffixedRuleId(target.ruleId)) {
    // Caller explicitly disambiguated with a suffix — exact match only.
    const exact = target.ruleId;
    return unifiedRules.filter((r) => r.id === exact);
  }
  // Bare id, no env — stem fan-out.
  return unifiedRules.filter((r) => stemRuleId(r.id) === stem);
}

// First (or only) match. Execution paths (e.g. the ramp poller applying
// patches) MUST use `resolveRampTargets` and iterate every match.
export function resolveRampTarget(
  target: RampTargetQuery,
  unifiedRules: FeatureRule[],
): FeatureRule | undefined {
  return resolveRampTargets(target, unifiedRules)[0];
}

// Same stem AND same effective env (explicit `environment` → suffix-derived env
// → wildcard). A wildcard on either side matches any env.
export function rampTargetsEquivalent(
  a: RampTargetQuery,
  b: RampTargetQuery,
): boolean {
  if (!a.ruleId || !b.ruleId) return false;
  const pa = parseRuleId(a.ruleId);
  const pb = parseRuleId(b.ruleId);
  if (pa.stem !== pb.stem) return false;
  const aEnv = a.environment || pa.env || null;
  const bEnv = b.environment || pb.env || null;
  if (!aEnv || !bEnv) return true;
  return aEnv === bEnv;
}

// ---- internal helpers ----

// Ignored when testing merge-eligibility: scoping fields + `id` (stem-grouped
// upstream; a sibling may carry a migration suffix).
const UNIFICATION_SCOPE_FIELDS = new Set([
  "allEnvironments",
  "environments",
  "id",
]);

function contentEquivalent(a: V1FeatureRule, b: V1FeatureRule): boolean {
  const aCore: Record<string, unknown> = {};
  const bCore: Record<string, unknown> = {};
  for (const k of Object.keys(a)) {
    if (!UNIFICATION_SCOPE_FIELDS.has(k)) {
      aCore[k] = (a as unknown as Record<string, unknown>)[k];
    }
  }
  for (const k of Object.keys(b)) {
    if (!UNIFICATION_SCOPE_FIELDS.has(k)) {
      bCore[k] = (b as unknown as Record<string, unknown>)[k];
    }
  }
  return isEqual(aCore, bCore);
}

// Deterministic ordering: caller-supplied order first (e.g. org env order),
// then alphabetical for anything unknown.
function canonicalEnvOrder(envs: string[], envOrder?: string[]): string[] {
  const envSet = new Set(envs);
  if (envOrder && envOrder.length) {
    const orderSet = new Set(envOrder);
    const known: string[] = [];
    const seen = new Set<string>();
    for (const e of envOrder) {
      if (envSet.has(e) && !seen.has(e)) {
        known.push(e);
        seen.add(e);
      }
    }
    const unknown = [...envSet].filter((e) => !orderSet.has(e)).sort();
    return [...known, ...unknown];
  }
  return [...envSet].sort();
}

type Occurrence = {
  env: string;
  rule: V1FeatureRule;
  position: number;
};

/**
 * Flatten v1 `Record<env, FeatureRule[]>` into v2 `FeatureRule[]`.
 *
 * Rules are grouped by legacy `id` across envs. A group merges into one unified
 * rule iff every occurrence is content-identical, no relative ordering conflict
 * exists with another mergeable group, and no env contains the id twice.
 * Non-mergeable groups emit one env-specific rule per occurrence, id suffixed
 * via `suffixRuleId`.
 *
 * Pass `opts.applicableEnvs` to enable `allEnvironments: true` collapse for
 * rules that cover every applicable env (occurrences in non-applicable envs
 * are dropped). Without it, `allEnvironments: true` is never emitted.
 *
 * Deterministic: same input → byte-identical output.
 */
export function flattenV1ToV2Rules(
  rulesByEnv: V1RulesByEnv,
  opts?: { envOrder?: string[]; applicableEnvs?: string[] },
): FeatureRule[] {
  const envs = canonicalEnvOrder(Object.keys(rulesByEnv), opts?.envOrder);
  if (envs.length === 0) return [];

  // 1. Collect occurrences by legacy id. Within-env duplicates are ambiguous
  //    and are never merged.
  const groups = new Map<string, Occurrence[]>();
  const dupInEnvIds = new Set<string>();
  for (const env of envs) {
    const list = rulesByEnv[env] || [];
    const seenInEnv = new Set<string>();
    list.forEach((rule, position) => {
      if (!rule || typeof rule !== "object" || !rule.id) return;
      // Stem so round-tripped ids group with bare siblings.
      const legacyId = stemRuleId(rule.id);
      if (seenInEnv.has(legacyId)) dupInEnvIds.add(legacyId);
      seenInEnv.add(legacyId);
      const existing = groups.get(legacyId) ?? [];
      existing.push({ env, rule, position });
      groups.set(legacyId, existing);
    });
  }

  // 2. Merge-eligibility: >=2 envs AND content-identical everywhere.
  const contentMergeable = new Set<string>();
  for (const [legacyId, occs] of groups) {
    if (occs.length < 2) continue;
    const first = occs[0].rule;
    const allSame = occs.every((o) => contentEquivalent(o.rule, first));
    if (allSame) contentMergeable.add(legacyId);
  }

  // 3. Order conflicts: if mergeable ids X,Y coexist in >=2 envs with
  //    disagreeing relative order, split both.
  const splitFromOrderConflict = new Set<string>();
  const mergeableIds = [...contentMergeable];
  for (let i = 0; i < mergeableIds.length; i++) {
    for (let j = i + 1; j < mergeableIds.length; j++) {
      const X = mergeableIds[i];
      const Y = mergeableIds[j];
      const xOccs = groups.get(X) ?? [];
      const yOccs = groups.get(Y) ?? [];
      let prevDirection: "x-before-y" | "y-before-x" | null = null;
      for (const env of envs) {
        const xOcc = xOccs.find((o) => o.env === env);
        const yOcc = yOccs.find((o) => o.env === env);
        if (!xOcc || !yOcc) continue;
        const dir = xOcc.position < yOcc.position ? "x-before-y" : "y-before-x";
        if (prevDirection === null) {
          prevDirection = dir;
        } else if (prevDirection !== dir) {
          splitFromOrderConflict.add(X);
          splitFromOrderConflict.add(Y);
          break;
        }
      }
    }
  }

  const finalMerged = new Set(
    [...contentMergeable].filter(
      (id) => !splitFromOrderConflict.has(id) && !dupInEnvIds.has(id),
    ),
  );

  // 4. Emit. Merged rules emit once with the full footprint; non-merged emit
  //    once per env with a suffixed id. `shapeRule` returns null when filtered
  //    to an empty footprint.
  const applicable = opts?.applicableEnvs;
  const applicableSet = applicable ? new Set(applicable) : null;

  const emittedMergedIds = new Set<string>();
  const output: FeatureRule[] = [];

  const envOccCounter = new Map<string, number>();
  function nextEnvSpecificId(legacyId: string, env: string): string {
    const key = `${legacyId}::${env}`;
    const n = envOccCounter.get(key) ?? 0;
    envOccCounter.set(key, n + 1);
    return suffixRuleId(legacyId, env, n + 1);
  }

  function shapeRule(
    rule: V1FeatureRule,
    id: string,
    rawEnvList: string[],
  ): FeatureRule | null {
    const filtered = applicableSet
      ? rawEnvList.filter((e) => applicableSet.has(e))
      : rawEnvList;
    if (filtered.length === 0) return null;

    const coversAllApplicable =
      applicableSet !== null && filtered.length === applicableSet.size;

    const base = {
      ...(rule as unknown as FeatureRule),
      id,
    } as FeatureRule;

    if (coversAllApplicable) {
      const out = { ...base, allEnvironments: true } as FeatureRule;
      delete (out as { environments?: string[] }).environments;
      return out;
    }
    return {
      ...base,
      allEnvironments: false,
      environments: filtered,
    } as FeatureRule;
  }

  for (const env of envs) {
    const list = rulesByEnv[env] || [];
    for (const rule of list) {
      if (!rule || !rule.id) continue;
      const legacyId = stemRuleId(rule.id);

      if (finalMerged.has(legacyId)) {
        if (emittedMergedIds.has(legacyId)) continue;
        emittedMergedIds.add(legacyId);
        const occs = groups.get(legacyId) ?? [];
        const occEnvSet = new Set(occs.map((o) => o.env));
        const envList = envs.filter((e) => occEnvSet.has(e));
        const shaped = shapeRule(rule, legacyId, envList);
        if (shaped) output.push(shaped);
      } else {
        // Lone occurrences keep their bare legacy id; suffix only on collision.
        const occs = groups.get(legacyId) ?? [];
        const needsSuffix = occs.length > 1 || dupInEnvIds.has(legacyId);
        const id = needsSuffix ? nextEnvSpecificId(legacyId, env) : legacyId;
        const shaped = shapeRule(rule, id, [env]);
        if (shaped) output.push(shaped);
      }
    }
  }

  return output;
}
