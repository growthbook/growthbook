import crypto from "crypto";
import isEqual from "lodash/isEqual";
import { FeatureRule } from "shared/validators";
import { Environment } from "shared/types/organization";

// ---------------------------------------------------------------------------
// Feature document schema generations (see also shared/types/feature.d.ts)
// ---------------------------------------------------------------------------
// v0 — Pre-environmentSettings. Top-level `rules` + `environments` arrays on
//      the feature, no per-env settings. Upgraded to v1 by `upgradeV0Feature`.
//
// v1 — Pre-unification. `environmentSettings[env].rules` per environment. Rules
//      lack `uid`, `allEnvironments`, and `environments` fields. This module's
//      flattener converts v1 -> v2 on read (see `flattenV1ToV2Rules`).
//
// v2 — Unified (canonical). Top-level `rules: FeatureRule[]` with stable
//      `uid`s, `allEnvironments: boolean`, and an optional `environments` list
//      per rule. `environmentSettings[env]` has NO `rules` key. This is the
//      shape of `FeatureInterface` itself.
//
// Structural discriminators:
//   - `isV2FeatureEnvSettings(envSettings)`: returns true iff NO env object
//     carries a `rules` key (v2). Returning false means the doc is v1 and
//     must be flattened.
//   - `isV2RevisionRules(rules)`: returns true iff `rules` is an array (v2).
//     Returning false means it's the legacy `Record<env, FeatureRule[]>` (v1).
// ---------------------------------------------------------------------------

// Input shape for the flattener: v1 rules keyed by env. Rules lack
// uid/allEnvironments/environments since those fields only exist in v2.
export type V1FeatureRule = Omit<
  FeatureRule,
  "uid" | "allEnvironments" | "environments"
>;

export type V1RulesByEnv = Record<string, V1FeatureRule[]>;

/**
 * Generate a stable, deterministic uid for a rule. Re-reading the same v1
 * document always produces the same uid so downstream references (ramp
 * targets, audit log entries) remain resolvable across JIT invocations.
 *
 * envContext is:
 *   - `"*"` when the rule is merged across multiple envs.
 *   - `"<env>"` when the rule is env-specific — either because it only appeared
 *     in one env, or it was split off a merge candidate due to content / order
 *     conflict, or it is the FIRST occurrence of a duplicate-in-one-env id.
 *   - `"<env>#<N>"` (N >= 2) for the Nth duplicate occurrence of the same
 *     legacy id within a single env. Guarantees unique uids when v1 data
 *     pathologically contains the same `id` twice in the same env's rule list.
 */
export function generateRuleUid(
  featureId: string,
  legacyId: string,
  envContext: string,
): string {
  const h = crypto
    .createHash("sha1")
    .update(`${featureId}::${legacyId}::${envContext}`)
    .digest("hex");
  return `ruid_${h.substring(0, 16)}`;
}

/**
 * Structural discriminator for a FeatureRevision's `rules` field. v2 revisions
 * store rules as a `FeatureRule[]`. v1 revisions store them as a
 * `Record<env, FeatureRule[]>`. This check is reliable even when v1 rules
 * carry uids (e.g. from a v1 REST round-trip via toLegacyRevision) because
 * the Record vs Array shape cannot coexist in a single value.
 */
export function isV2RevisionRules(rules: unknown): rules is FeatureRule[] {
  return Array.isArray(rules);
}

/**
 * Structural discriminator for a FeatureInterface's `environmentSettings` map.
 * A feature's envSettings is v1-shaped iff ANY env object has a `rules` key
 * defined (even []). Post-cutover v2 writes go through buildFeatureUpdate,
 * which replaces each env object wholesale with `{ enabled, prerequisites }` —
 * no `rules` key — so the absence of `rules` on every env is the v2 signal.
 *
 * Note: this returns true for brand-new features with `feature.rules === []`
 * because their envSettings also won't have any `rules` key. That's correct —
 * a zero-rule v2 feature needs no JIT work.
 */
export function isV2FeatureEnvSettings(
  envSettings: Record<string, { rules?: unknown }> | undefined,
): boolean {
  if (!envSettings) return true;
  for (const env of Object.values(envSettings)) {
    if (env && typeof env === "object" && "rules" in env) return false;
  }
  return true;
}

/**
 * Compute the set of environment IDs that apply to a feature given the org's
 * environments list and the feature's project. An environment applies if:
 *   - the environment has no `projects` list (applies to all), OR
 *   - the environment's `projects` list includes the feature's project.
 * If the feature has no project, all envs apply.
 */
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
 * Resolve a ramp target to a unified FeatureRule. Prefers `ruleUid` (written by
 * new code); falls back to the legacy `(ruleId, environment)` shape for ramps
 * created before the unification. Returns undefined if no match.
 *
 * Matching semantics for the legacy path:
 *   - r.id === target.ruleId, AND
 *   - If target.environment is set, the rule must be active in that env
 *     (r.allEnvironments === true OR r.environments.includes(env)).
 *   - If target.environment is absent, any rule with matching id matches.
 */
export function resolveRampTarget(
  target: {
    ruleUid?: string | null;
    ruleId?: string | null;
    environment?: string | null;
  },
  unifiedRules: FeatureRule[],
): FeatureRule | undefined {
  if (target.ruleUid) {
    const byUid = unifiedRules.find((r) => r.uid === target.ruleUid);
    if (byUid) return byUid;
  }
  if (!target.ruleId) return undefined;
  return unifiedRules.find((r) => {
    if (r.id !== target.ruleId) return false;
    if (!target.environment) return true;
    if (r.allEnvironments) return true;
    return r.environments?.includes(target.environment) ?? false;
  });
}

// ---- internal helpers ----

// Fields that are NOT part of a rule's "identity content" — they describe
// unification scoping, not rule behavior. Ignored when checking if two rules
// should merge.
const UNIFICATION_SCOPE_FIELDS = new Set([
  "uid",
  "allEnvironments",
  "environments",
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

// Sort env names in a deterministic way — alphabetical. The caller can override
// with opts.envOrder if they want a specific canonical order (e.g. matching the
// org's configured env order).
function canonicalEnvOrder(envs: string[], envOrder?: string[]): string[] {
  if (envOrder && envOrder.length) {
    const orderSet = new Set(envOrder);
    const known = envOrder.filter((e) => envs.includes(e));
    const unknown = envs.filter((e) => !orderSet.has(e)).sort();
    return [...known, ...unknown];
  }
  return [...envs].sort();
}

type Occurrence = {
  env: string;
  rule: V1FeatureRule;
  position: number; // index within that env's legacy list
};

/**
 * Flatten a v1 `Record<env, FeatureRule[]>` into a v2 `FeatureRule[]`.
 *
 * Semantics (all enforced by tests):
 *
 * Grouping + merging:
 *  - Rules are grouped by legacy `id` across envs.
 *  - A group merges into ONE unified rule iff ALL occurrences are content-identical
 *    AND merging does not create a relative-order conflict with any other merge
 *    candidate AND the legacy id is not duplicated within any single env.
 *  - When a group cannot merge, each occurrence becomes its own env-specific rule.
 *
 * uid assignment (see also `generateRuleUid`):
 *  - Merged rule:        `uid = hash(featureId, id, "*")`.
 *  - Env-specific rule:  `uid = hash(featureId, id, env)` for the first (or only)
 *                        occurrence of this id in that env.
 *  - In-env duplicate:   Subsequent occurrences of the same id in the same env
 *                        use `uid = hash(featureId, id, "<env>#<N>")` (N >= 2)
 *                        to guarantee uniqueness.
 *
 * `allEnvironments` collapse (requires `opts.applicableEnvs`):
 *  - `applicableEnvs` is the caller's set of envs where the feature applies
 *    (i.e. org envs filtered by the feature's project — see `getApplicableEnvIds`).
 *  - A rule whose env footprint covers every applicable env emits with
 *    `allEnvironments: true` and `environments` omitted.
 *  - Otherwise emits `allEnvironments: false` with an explicit `environments`
 *    list filtered to the applicable set.
 *  - Occurrences in non-applicable envs are dropped (orphan data — e.g. a
 *    feature project reassignment that left stale env records).
 *  - If `applicableEnvs` is omitted, `allEnvironments: true` is never emitted.
 *
 * Determinism: same input yields byte-identical output (same order, same uids).
 */
export function flattenV1ToV2Rules(
  featureId: string,
  rulesByEnv: V1RulesByEnv,
  opts?: { envOrder?: string[]; applicableEnvs?: string[] },
): FeatureRule[] {
  const envs = canonicalEnvOrder(Object.keys(rulesByEnv), opts?.envOrder);
  if (envs.length === 0) return [];

  // 1. Collect occurrences by legacy id. Also detect legacy ids that appear
  //    more than once within a single env — those are considered irrecoverably
  //    ambiguous and must be emitted as separate rules (never merged), with
  //    each occurrence getting its own uid.
  const groups = new Map<string, Occurrence[]>();
  const dupInEnvIds = new Set<string>();
  for (const env of envs) {
    const list = rulesByEnv[env] || [];
    const seenInEnv = new Set<string>();
    list.forEach((rule, position) => {
      if (!rule || typeof rule !== "object" || !rule.id) return;
      if (seenInEnv.has(rule.id)) dupInEnvIds.add(rule.id);
      seenInEnv.add(rule.id);
      const existing = groups.get(rule.id) ?? [];
      existing.push({ env, rule, position });
      groups.set(rule.id, existing);
    });
  }

  // 2. Identify merge-eligibility per group.
  //    Content-mergeable: appears in ≥2 envs AND all occurrences content-identical.
  const contentMergeable = new Set<string>();
  for (const [legacyId, occs] of groups) {
    if (occs.length < 2) continue;
    const first = occs[0].rule;
    const allSame = occs.every((o) => contentEquivalent(o.rule, first));
    if (allSame) contentMergeable.add(legacyId);
  }

  // 3. Detect order conflicts among content-mergeable groups.
  //    For every pair of content-mergeable ids (X, Y), if they BOTH appear in
  //    two or more shared envs AND their relative order disagrees, split both.
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

  // Final merged set: content-mergeable, minus order conflicts, minus any id
  // duplicated within a single env (which is always split).
  const finalMerged = new Set(
    [...contentMergeable].filter(
      (id) => !splitFromOrderConflict.has(id) && !dupInEnvIds.has(id),
    ),
  );

  // 4. Emit output. Strategy:
  //    - Walk envs in canonical order.
  //    - Within each env, walk that env's legacy rule list in order.
  //    - For each rule:
  //      - If the id is in `finalMerged`: emit ONCE (first time seen) with env
  //        footprint = [all envs where this legacy id appears]. `shapeRule`
  //        then filters that against `applicableEnvs` and may collapse to
  //        `allEnvironments: true`.
  //      - Else: emit as env-specific, one per occurrence. Duplicate-in-env
  //        occurrences get disambiguated uids via `nextEnvSpecificUid`.
  //    - Skip already-emitted merged rules on subsequent envs.
  //    - `shapeRule` returns null (and we skip emission) if the rule's
  //      footprint has no overlap with `applicableEnvs`.

  const applicable = opts?.applicableEnvs;
  const applicableSet = applicable ? new Set(applicable) : null;

  const emittedMergedIds = new Set<string>();
  const output: FeatureRule[] = [];

  // Tracks how many times we've emitted an (id, env) pair on the env-specific
  // path. Used to produce distinct uids for duplicates within a single env.
  // First occurrence uses env as the envContext (stable across migrations);
  // subsequent occurrences use `${env}#${n+1}` to disambiguate.
  const envOccCounter = new Map<string, number>();
  function nextEnvSpecificUid(legacyId: string, env: string): string {
    const key = `${legacyId}::${env}`;
    const n = envOccCounter.get(key) ?? 0;
    envOccCounter.set(key, n + 1);
    const ctx = n === 0 ? env : `${env}#${n + 1}`;
    return generateRuleUid(featureId, legacyId, ctx);
  }

  // Shape the final rule given the computed env coverage. If the rule's
  // footprint covers every applicable env (and applicableEnvs was provided),
  // emit `allEnvironments: true` with no `environments` field. Otherwise emit
  // the explicit env list (filtered to the applicable set if one was given).
  // Returns null if nothing to emit (e.g. rule only appears in non-applicable envs).
  function shapeRule(
    rule: V1FeatureRule,
    uid: string,
    rawEnvList: string[],
  ): FeatureRule | null {
    const filtered = applicableSet
      ? rawEnvList.filter((e) => applicableSet.has(e))
      : rawEnvList;
    if (filtered.length === 0) return null;

    // Reaching this line implies `filtered.length > 0`, so if applicableSet
    // is non-null its size is also > 0 (we can't filter a non-empty list
    // down to 0 via an empty set).
    const coversAllApplicable =
      applicableSet !== null && filtered.length === applicableSet.size;

    const base = {
      ...(rule as unknown as FeatureRule),
      uid,
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
      const legacyId = rule.id;

      if (finalMerged.has(legacyId)) {
        if (emittedMergedIds.has(legacyId)) continue;
        emittedMergedIds.add(legacyId);
        const occs = groups.get(legacyId) ?? [];
        const occEnvSet = new Set(occs.map((o) => o.env));
        const envList = envs.filter((e) => occEnvSet.has(e));
        const uid = generateRuleUid(featureId, legacyId, "*");
        const shaped = shapeRule(rule, uid, envList);
        if (shaped) output.push(shaped);
      } else {
        const uid = nextEnvSpecificUid(legacyId, env);
        const shaped = shapeRule(rule, uid, [env]);
        if (shaped) output.push(shaped);
      }
    }
  }

  return output;
}
