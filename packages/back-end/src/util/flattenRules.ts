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

// True when no env carries a populated legacy `rules` array — the structural
// signal a document is v2. `rules: undefined` and `rules: []` count as scrubbed
// (pre-write artifacts left by `buildFeatureUpdate`). Any new write path that
// touches `environmentSettings` MUST route through `buildFeatureUpdate` to
// keep this check accurate.
export function hasNoV1EnvRules(
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

// Persist-chokepoint guard: suffixes duplicate ids (later occurrences get
// `<stem>__<envHint>__<n>` via `suffixRuleId`) and returns collisions for
// callers to log. All forms stem back to the original id so external lookups
// (ramps, SDK tracking keys, telemetry) continue to resolve.
export interface EnsureUniqueRuleIdsResult {
  rules: FeatureRule[];
  collisions: Array<{ originalId: string; assignedId: string }>;
}

export function ensureUniqueRuleIds(
  rules: FeatureRule[],
): EnsureUniqueRuleIdsResult {
  const seen = new Set<string>();
  const perStemCounter = new Map<string, number>();
  const out: FeatureRule[] = [];
  const collisions: Array<{ originalId: string; assignedId: string }> = [];

  for (const r of rules) {
    if (!r?.id) {
      out.push(r);
      continue;
    }
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
      continue;
    }

    const stem = stemRuleId(r.id);
    const envHint = r.allEnvironments
      ? "all"
      : r.environments?.length === 1
        ? r.environments[0]
        : "dup";

    let n = (perStemCounter.get(stem) ?? 1) + 1;
    let candidate = suffixRuleId(stem, envHint, n);
    while (seen.has(candidate)) {
      n += 1;
      candidate = suffixRuleId(stem, envHint, n);
    }
    perStemCounter.set(stem, n);
    seen.add(candidate);

    collisions.push({ originalId: r.id, assignedId: candidate });
    out.push({ ...r, id: candidate } as FeatureRule);
  }

  return { rules: out, collisions };
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

// Tolerate sparse/legacy storage. `rules` is Mongoose `Mixed`, and pre-v2 docs
// can survive with `null`/`undefined` array entries (partial imports, sparse
// arrays). Narrows downstream consumers off `unknown` so the shape of a
// migrated rule is honored everywhere we touch `.type`, `.id`, `.environments`.
// Arrays are explicitly excluded — `typeof [] === "object"` would otherwise
// pass the filter, and a corrupt array-in-array slot would slip through
// `upgradeFeatureRule` (which returns non-rule input unchanged) and crash
// downstream `.type` / `.environments` access.
export function isPlausibleFeatureRule(value: unknown): value is FeatureRule {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

// Strip a v2 rule's non-applicable envs. When every env is non-applicable
// (env removed from project, env deleted from org), collapse to the
// no-env "pending" state (`environments: []`, `allEnvironments: false`)
// rather than dropping the rule — preserves the rule body so a publish
// during the orphaned period doesn't silently delete it. The UI surfaces
// these as a red "No environments" badge.
//
// Mirrors `ruleFootprint` semantics. Used by the JIT migrators on both
// FeatureModel and FeatureRevisionModel so the live feature view and a
// revision view of the same data agree on which rules are visible.
export function narrowRuleToApplicableEnvs(
  rule: FeatureRule,
  applicableSet: Set<string>,
): FeatureRule {
  if (rule.allEnvironments) {
    if (applicableSet.size === 0) {
      return {
        ...rule,
        allEnvironments: false,
        environments: [],
      } as FeatureRule;
    }
    return rule;
  }
  if (rule.environments === undefined) {
    if (applicableSet.size === 0) {
      return { ...rule, environments: [] } as FeatureRule;
    }
    return rule;
  }
  if (rule.environments.length === 0) return rule;
  const filtered = rule.environments.filter((e) => applicableSet.has(e));
  if (filtered.length === rule.environments.length) return rule;
  return { ...rule, environments: filtered } as FeatureRule;
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
 * rules that cover every applicable env. Occurrences in non-applicable envs
 * are stripped from the footprint; rules left with no applicable envs are
 * preserved as `environments: []` (no-env "pending" state) instead of
 * dropped, so a publish during the orphaned period doesn't lose data.
 * Without `applicableEnvs`, `allEnvironments: true` is never emitted.
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

  // 3. Order conflicts. A merged rule emits exactly once, at its
  //    canonical-first env's iteration position. So in any other env where it
  //    appears, every rule that came before it on disk MUST also emit before
  //    its canonical position in v2 — otherwise `bucketRulesByEnv` will
  //    reorder rules within that env's bucket.
  //
  //    Concretely, X is safe to merge iff for every env E where X appears
  //    other than X's canonical-first env, every predecessor R of X in E
  //    is (a) also a predecessor of X in X's canonical-first env, AND
  //    (b) itself still mergeable (so R emits during R's own canonical-first
  //    iteration, at-or-before X's iteration).
  //
  //    This is iterated to a fixed point: removing one id from the merge
  //    set can render another unsafe (its previously-mergeable predecessor
  //    now emits per-env via suffixing).
  //
  //    Subsumes the looser pairwise (mergeable, mergeable) check: if X and
  //    Y conflict in their relative order across envs, the predecessor-set
  //    asymmetry surfaces here too.
  const splitFromOrderConflict = new Set<string>();

  function predecessorStems(env: string, position: number): string[] {
    const list = rulesByEnv[env] || [];
    const out: string[] = [];
    for (let i = 0; i < position; i++) {
      const r = list[i];
      if (r && typeof r === "object" && r.id) out.push(stemRuleId(r.id));
    }
    return out;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of contentMergeable) {
      if (splitFromOrderConflict.has(id)) continue;
      const occs = groups.get(id) ?? [];
      if (occs.length < 2) continue;

      // Canonical-first env: first env in `envs` order where id appears.
      const firstEnv = envs.find((e) => occs.some((o) => o.env === e));
      if (!firstEnv) continue;
      const firstOcc = occs.find((o) => o.env === firstEnv);
      if (!firstOcc) continue;

      const firstPredSet = new Set(
        predecessorStems(firstEnv, firstOcc.position),
      );

      let unsafe = false;
      for (const occ of occs) {
        if (occ.env === firstEnv) continue;
        const preds = predecessorStems(occ.env, occ.position);
        for (const predStem of preds) {
          const predStillMergeable =
            contentMergeable.has(predStem) &&
            !splitFromOrderConflict.has(predStem);
          if (!firstPredSet.has(predStem) || !predStillMergeable) {
            unsafe = true;
            break;
          }
        }
        if (unsafe) break;
      }

      if (unsafe) {
        splitFromOrderConflict.add(id);
        changed = true;
      }
    }
  }

  const finalMerged = new Set(
    [...contentMergeable].filter(
      (id) => !splitFromOrderConflict.has(id) && !dupInEnvIds.has(id),
    ),
  );

  // 4. Emit. Merged rules emit once with the full footprint; non-merged emit
  //    once per env with a suffixed id. `shapeRule` preserves orphan envs
  //    (env IDs in raw v1 buckets that aren't currently applicable) so the
  //    UI can flag them; consumers must filter via `ruleFootprint`.
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
  ): FeatureRule {
    const applicableSubset = applicableSet
      ? rawEnvList.filter((e) => applicableSet.has(e))
      : rawEnvList;
    const hasOrphans = applicableSet
      ? rawEnvList.length !== applicableSubset.length
      : false;

    // Collapse to allEnvironments only when the rule covers exactly the
    // applicable set with no orphans; orphans must round-trip so the UI can
    // surface them and an admin can decide whether to clean them up.
    const coversAllApplicable =
      applicableSet !== null &&
      !hasOrphans &&
      applicableSubset.length > 0 &&
      applicableSubset.length === applicableSet.size;

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
      environments: rawEnvList,
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
        output.push(shapeRule(rule, legacyId, envList));
      } else {
        // Lone occurrences keep their bare legacy id; suffix only on collision.
        const occs = groups.get(legacyId) ?? [];
        const needsSuffix = occs.length > 1 || dupInEnvIds.has(legacyId);
        const id = needsSuffix ? nextEnvSpecificId(legacyId, env) : legacyId;
        output.push(shapeRule(rule, id, [env]));
      }
    }
  }

  return output;
}
