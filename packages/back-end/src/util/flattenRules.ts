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

// ---------------------------------------------------------------------------
// Feature document generations
// ---------------------------------------------------------------------------
// v0 — top-level rules + environments arrays. Upgraded to v1 by `upgradeV0Feature`.
// v1 — `environmentSettings[env].rules`. Rules addressed by legacy `id`,
//      which can collide across envs.
// v2 — canonical. Top-level `rules: FeatureRule[]` with `allEnvironments` and
//      an optional `environments` list per rule. `environmentSettings[env]`
//      has NO `rules` key.
//
// Identifier contract:
//   - `rule.id` is the only rule identifier and is PUBLIC (SDK, REST, ramp).
//   - When v1 data collides across envs the flattener appends `__<env>` to
//     each occurrence's id:
//       * REST (v1 + v2) emits the full qualified id; clients must echo it
//         back on PUT/DELETE.
//       * SDK payload stem-strips so telemetry ids stay stable across the
//         unification boundary.
//     Split/join lives in `shared/src/util/ruleId.ts`.
//   - New rules use `generateRuleId()` (`fr_<uniqid>`), which never contains
//     `__` — so "any id with `__` is a migration artifact" holds.
//
// Structural discriminators:
//   - `isV2FeatureEnvSettings(envSettings)`: no env carries `rules`.
//   - `isV2RevisionRules(rules)`: `rules` is an array.
// ---------------------------------------------------------------------------

export type V1RulesByEnv = Record<string, V1FeatureRule[]>;

// v2 stores rules as FeatureRule[]; v1 stores them as Record<env, FeatureRule[]>.
export function isV2RevisionRules(rules: unknown): rules is FeatureRule[] {
  return Array.isArray(rules);
}

/**
 * True if `environmentSettings` is v2-shaped. Relies on the invariant that
 * every rules-touching write goes through `buildFeatureUpdate`, which scrubs
 * `env.rules` from the $set payload — so no on-disk doc has BOTH
 * `feature.rules` and `envSettings[env].rules` populated. Any new write path
 * that touches `environmentSettings` MUST route through `buildFeatureUpdate`.
 */
export function isV2FeatureEnvSettings(
  envSettings: Record<string, { rules?: unknown } | undefined>,
): boolean {
  // A populated rules array is the only v1 signal; undefined/[] means v2.
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

// Called at persist chokepoints (updateFeature, updateRevision, createFeature)
// to turn silent rule-id collisions into loud failures.
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

// An env applies when it has no `projects` list, or its list includes the
// feature's project. If the feature has no project, all envs apply.
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

/**
 * Per-env footprint of a v2 rule, filtered to `applicableEnvs`. Must stay in
 * sync with shared `ruleAppliesToEnv` / `ruleFootprint`:
 *   - `allEnvironments: true`     → every applicable env
 *   - `environments: [list]`      → intersection with applicable set
 *   - `environments: []`          → [] (explicit "pending" state)
 *   - neither field declared      → every applicable env (legacy fallback)
 */
export function ruleFootprint(
  rule: FeatureRule,
  applicableEnvs: string[],
): string[] {
  if (rule.allEnvironments) return applicableEnvs;
  if (rule.environments === undefined) return applicableEnvs;
  const applicableSet = new Set(applicableEnvs);
  return rule.environments.filter((e) => applicableSet.has(e));
}

/**
 * Remove a single env from a rule's footprint (the v1 REST DELETE contract).
 * If the rule's footprint becomes empty, returns `{action: "delete"}` —
 * callers must handle side-effect cleanup (ramp actions, SafeRollout).
 * Otherwise narrows to the remaining applicable envs (expanding
 * `allEnvironments: true` first). Pure; does not mutate `rule`.
 */
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

/**
 * Resolve a ramp target to every matching unified FeatureRule. Semantics by
 * `(ruleId form, environment set?)`:
 *   1. (bare id, env)      → match on `stem` or `stem__env`, filtered by rule scope
 *   2. (suffixed id, env)  → stem-stripped; falls through to (1)
 *   3. (bare id, no env)   → stem fan-out across all env siblings
 *   4. (suffixed id, no env) → exact id match
 *
 * `target.environment` is retained for pre-migration stored ramps; v2 ids
 * are globally unique so env is redundant in the common case.
 */
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

// First (or only) match. Execution paths (e.g. the ramp poller that applies
// patches) MUST use `resolveRampTargets` and iterate over every match.
export function resolveRampTarget(
  target: RampTargetQuery,
  unifiedRules: FeatureRule[],
): FeatureRule | undefined {
  return resolveRampTargets(target, unifiedRules)[0];
}

/**
 * True iff two ramp targets resolve to the same logical rule. Equivalence:
 *   1. Same stem (via `stemRuleId`).
 *   2. Same effective env — explicit `environment`, else suffix-derived env,
 *      else wildcard. Wildcard matches any env.
 */
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

// Fields ignored when checking whether two rules can merge: scoping fields
// plus `id` (grouped by stem upstream; a sibling may carry a migration suffix).
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

// Deterministic env ordering — alphabetical, with optional caller-supplied
// canonical order (e.g. the org's configured env order).
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
 * Merging: rules are grouped by legacy `id` across envs. A group merges into
 * one unified rule iff every occurrence is content-identical, no relative
 * ordering conflict exists with another mergeable group, and no env contains
 * the id twice. Non-mergeable groups emit one env-specific rule per
 * occurrence with id `"<legacyId>__<env>"` (`__<env>__<n>` for in-env dupes).
 *
 * `allEnvironments` collapse (requires `opts.applicableEnvs`):
 *   - A rule covering every applicable env emits `allEnvironments: true` and
 *     omits `environments`.
 *   - Occurrences in non-applicable envs are dropped.
 *   - If `applicableEnvs` is omitted, `allEnvironments: true` is never emitted.
 *
 * Output is deterministic — same input yields byte-identical output.
 */
export function flattenV1ToV2Rules(
  rulesByEnv: V1RulesByEnv,
  opts?: { envOrder?: string[]; applicableEnvs?: string[] },
): FeatureRule[] {
  const envs = canonicalEnvOrder(Object.keys(rulesByEnv), opts?.envOrder);
  if (envs.length === 0) return [];

  // 1. Collect occurrences by legacy id. Ids duplicated within a single env
  //    are considered irrecoverably ambiguous and are never merged.
  const groups = new Map<string, Occurrence[]>();
  const dupInEnvIds = new Set<string>();
  for (const env of envs) {
    const list = rulesByEnv[env] || [];
    const seenInEnv = new Set<string>();
    list.forEach((rule, position) => {
      if (!rule || typeof rule !== "object" || !rule.id) return;
      // Stem first so v2→v1→v2 round-tripped ids group with bare siblings.
      const legacyId = stemRuleId(rule.id);
      if (seenInEnv.has(legacyId)) dupInEnvIds.add(legacyId);
      seenInEnv.add(legacyId);
      const existing = groups.get(legacyId) ?? [];
      existing.push({ env, rule, position });
      groups.set(legacyId, existing);
    });
  }

  // 2. Merge-eligibility: appears in >=2 envs AND content-identical everywhere.
  const contentMergeable = new Set<string>();
  for (const [legacyId, occs] of groups) {
    if (occs.length < 2) continue;
    const first = occs[0].rule;
    const allSame = occs.every((o) => contentEquivalent(o.rule, first));
    if (allSame) contentMergeable.add(legacyId);
  }

  // 3. Order conflicts: if two mergeable ids X,Y appear together in two or
  //    more envs with disagreeing relative order, split both.
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

  // 4. Emit output. Walk envs in canonical order; for each rule, emit merged
  //    rules once with the full footprint, non-merged rules once per env with
  //    a suffixed id. shapeRule returns null for zero-footprint rules.
  const applicable = opts?.applicableEnvs;
  const applicableSet = applicable ? new Set(applicable) : null;

  const emittedMergedIds = new Set<string>();
  const output: FeatureRule[] = [];

  // Counter used to disambiguate the same legacy id repeated in one env.
  const envOccCounter = new Map<string, number>();
  function nextEnvSpecificId(legacyId: string, env: string): string {
    const key = `${legacyId}::${env}`;
    const n = envOccCounter.get(key) ?? 0;
    envOccCounter.set(key, n + 1);
    return suffixRuleId(legacyId, env, n + 1);
  }

  // Collapses to `allEnvironments: true` if the footprint covers every
  // applicable env. Returns null when nothing is applicable.
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
        // Only suffix when there's a real collision; lone occurrences keep
        // their bare legacy id.
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
