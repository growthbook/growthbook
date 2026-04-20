import isEqual from "lodash/isEqual";
import { FeatureRule, V1FeatureRule } from "shared/validators";
import { Environment } from "shared/types/organization";
import { stemRuleId, suffixRuleId } from "shared/util";

// Re-export V1FeatureRule for callers that import it from this module (kept
// for backwards-compat within the back-end; new code should import directly
// from shared/validators).
export type { V1FeatureRule };

// ---------------------------------------------------------------------------
// Feature document schema generations (see also shared/types/feature.d.ts)
// ---------------------------------------------------------------------------
// v0 — Pre-environmentSettings. Top-level `rules` + `environments` arrays on
//      the feature, no per-env settings. Upgraded to v1 by `upgradeV0Feature`.
//
// v1 — Pre-unification. `environmentSettings[env].rules` per environment. Rules
//      are addressed only by their legacy `id`, which can collide across envs.
//      This module's flattener converts v1 -> v2 on read (`flattenV1ToV2Rules`).
//
// v2 — Unified (canonical). Top-level `rules: FeatureRule[]` with
//      `allEnvironments: boolean` and an optional `environments` list per
//      rule. `environmentSettings[env]` has NO `rules` key. This is the
//      shape of `FeatureInterface` itself.
//
// Identifier contract:
//   - `rule.id` is the only rule identifier. It's PUBLIC for external
//     surfaces (SDK payloads, tracking, REST, ramp targeting).
//   - When v1 data contains the same legacy id in multiple envs with
//     non-mergeable content, the flattener disambiguates by appending
//     `__<env>` to each occurrence's id. External surfaces always use
//     `stemRuleId(id)` to strip the suffix back to the public form. See
//     `shared/src/util/ruleId.ts` for the one-and-only split/join helpers.
//   - New rules (authored post-v2) use server-generated ids via
//     `generateRuleId()` (form: `fr_<uniqid>`) which never contain `__`,
//     so the "any id with `__` is a migration artifact" invariant holds.
//
// Structural discriminators:
//   - `isV2FeatureEnvSettings(envSettings)`: returns true iff NO env object
//     carries a `rules` key (v2). Returning false means the doc is v1 and
//     must be flattened.
//   - `isV2RevisionRules(rules)`: returns true iff `rules` is an array (v2).
//     Returning false means it's the legacy `Record<env, FeatureRule[]>` (v1).
// ---------------------------------------------------------------------------

// Input shape for the flattener: v1 rules keyed by env. `V1FeatureRule` is
// zod-backed in shared/validators (permissive passthrough).
export type V1RulesByEnv = Record<string, V1FeatureRule[]>;

/**
 * Structural discriminator for a FeatureRevision's `rules` field. v2 revisions
 * store rules as a `FeatureRule[]`. v1 revisions store them as a
 * `Record<env, FeatureRule[]>`.
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
 * Compute the per-env footprint for a v2 rule, filtered to a set of
 * applicable envs (typically `getApplicableEnvIds(orgEnvs, featureProject)`).
 *
 *   - `rule.allEnvironments: true` → every applicable env
 *   - `rule.environments: [...]`    → intersection with applicable set
 *   - malformed (neither declared)  → [] (strict: no explicit scope, no
 *                                        bucket. Callers that want a
 *                                        permissive fallback should use
 *                                        `getRulesForEnvironment` /
 *                                        `ruleAppliesToEnv` from shared)
 *
 * Used by every v2→per-env projection (REST API response shape, legacy
 * down-convert, event env fanout, SDK payload per-env rule extraction) so
 * the same rule always lands in the same bucket set.
 */
export function ruleFootprint(
  rule: FeatureRule,
  applicableEnvs: string[],
): string[] {
  if (rule.allEnvironments) return applicableEnvs;
  const applicableSet = new Set(applicableEnvs);
  return (rule.environments || []).filter((e) => applicableSet.has(e));
}

/**
 * Resolve a ramp target to a unified FeatureRule. Returns undefined if no
 * match.
 *
 * Matching semantics (stem-based, so ramps authored against pre-migration
 * legacy ids continue to resolve post-migration even when the underlying
 * rule was renamed with a `__<env>` suffix):
 *
 *   - stemRuleId(r.id) === target.ruleId, AND
 *   - If target.environment is set, the rule must be active in that env
 *     (r.allEnvironments === true OR r.environments.includes(env)).
 *   - If target.environment is absent, any rule with matching stem matches.
 *
 * `target.environment` is deprecated on new ramps — in v2 `ruleId` is
 * normally sufficient within a feature's unified rule list. The env check is
 * retained so pre-v2 targets (whose ruleId could appear in multiple
 * env-scoped rule lists) resolve unambiguously. See `rampTarget` in
 * shared/validators.
 */
export function resolveRampTarget(
  target: {
    ruleId?: string | null;
    environment?: string | null;
  },
  unifiedRules: FeatureRule[],
): FeatureRule | undefined {
  if (!target.ruleId) return undefined;
  const targetStem = stemRuleId(target.ruleId);
  return unifiedRules.find((r) => {
    if (stemRuleId(r.id) !== targetStem) return false;
    if (!target.environment) return true;
    if (r.allEnvironments) return true;
    return r.environments?.includes(target.environment) ?? false;
  });
}

// ---- internal helpers ----

// Fields that are NOT part of a rule's "identity content" — they describe
// unification scoping or stable identity rather than rule behavior. Ignored
// when checking if two rules should merge.
//
// `id` is excluded because we group by `stemRuleId(id)` upstream; within a
// group every occurrence already shares a stem, but one may carry a
// migration suffix (e.g. post v2→v1→v2 round-trip) while a sibling is bare.
// A naive string compare on `id` would force an unnecessary split in that
// case. Merge decisions are behavior-driven, not string-driven.
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
 *  - A group merges into ONE unified rule iff ALL occurrences are
 *    content-identical AND merging does not create a relative-order conflict
 *    with any other merge candidate AND the legacy id is not duplicated
 *    within any single env.
 *  - When a group cannot merge, each occurrence is emitted as its own
 *    env-specific rule with a disambiguating id suffix (`__<env>`).
 *
 * Id assignment:
 *  - Merged rule:           id stays as the legacy id (no suffix).
 *  - Unique legacy id:      id stays as the legacy id (no suffix — there's
 *                           nothing to disambiguate from).
 *  - Cross-env collision:   each occurrence gets `id = "<legacyId>__<env>"`.
 *  - In-env duplicate:      first occurrence gets `__<env>`, subsequent get
 *                           `__<env>__<n>` (n >= 2). See `suffixRuleId`.
 *
 * `allEnvironments` collapse (requires `opts.applicableEnvs`):
 *  - `applicableEnvs` is the caller's set of envs where the feature applies
 *    (i.e. org envs filtered by the feature's project — see
 *    `getApplicableEnvIds`).
 *  - A rule whose env footprint covers every applicable env emits with
 *    `allEnvironments: true` and `environments` omitted.
 *  - Otherwise emits `allEnvironments: false` with an explicit `environments`
 *    list filtered to the applicable set.
 *  - Occurrences in non-applicable envs are dropped (orphan data — e.g. a
 *    feature project reassignment that left stale env records).
 *  - If `applicableEnvs` is omitted, `allEnvironments: true` is never emitted.
 *
 * Determinism: same input yields byte-identical output (same order, same ids).
 */
export function flattenV1ToV2Rules(
  rulesByEnv: V1RulesByEnv,
  opts?: { envOrder?: string[]; applicableEnvs?: string[] },
): FeatureRule[] {
  const envs = canonicalEnvOrder(Object.keys(rulesByEnv), opts?.envOrder);
  if (envs.length === 0) return [];

  // 1. Collect occurrences by legacy id. Also detect legacy ids that appear
  //    more than once within a single env — those are considered irrecoverably
  //    ambiguous and must be emitted as separate rules (never merged).
  const groups = new Map<string, Occurrence[]>();
  const dupInEnvIds = new Set<string>();
  for (const env of envs) {
    const list = rulesByEnv[env] || [];
    const seenInEnv = new Set<string>();
    list.forEach((rule, position) => {
      if (!rule || typeof rule !== "object" || !rule.id) return;
      // Stem the legacy id before grouping: if a v1 payload carries an
      // already-suffixed id (e.g. from a v2 → v1 round-trip), group it with
      // its un-suffixed siblings so merging/splitting decisions remain
      // content-driven rather than string-driven.
      const legacyId = stemRuleId(rule.id);
      if (seenInEnv.has(legacyId)) dupInEnvIds.add(legacyId);
      seenInEnv.add(legacyId);
      const existing = groups.get(legacyId) ?? [];
      existing.push({ env, rule, position });
      groups.set(legacyId, existing);
    });
  }

  // 2. Identify merge-eligibility per group.
  //    Content-mergeable: appears in >= 2 envs AND all occurrences
  //    content-identical.
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
  //    - For each rule (stem-id'd above):
  //      - If the id is in `finalMerged`: emit ONCE (first time seen) with
  //        env footprint = [all envs where this legacy id appears]. Keeps
  //        the bare legacy id. `shapeRule` may collapse to
  //        `allEnvironments: true`.
  //      - Else: emit as env-specific, one per occurrence. Id gets a
  //        `__<env>` suffix for disambiguation; in-env duplicates get a
  //        further `__<n>` counter.
  //    - Skip already-emitted merged rules on subsequent envs.
  //    - `shapeRule` returns null (and we skip emission) if the rule's
  //      footprint has no overlap with `applicableEnvs`.

  const applicable = opts?.applicableEnvs;
  const applicableSet = applicable ? new Set(applicable) : null;

  const emittedMergedIds = new Set<string>();
  const output: FeatureRule[] = [];

  // Tracks how many times we've emitted an (id, env) pair on the env-specific
  // path. Used to produce distinct ids for pathological v1 data where the same
  // legacy id appears multiple times within a single env's rule list.
  const envOccCounter = new Map<string, number>();
  function nextEnvSpecificId(legacyId: string, env: string): string {
    const key = `${legacyId}::${env}`;
    const n = envOccCounter.get(key) ?? 0;
    envOccCounter.set(key, n + 1);
    return suffixRuleId(legacyId, env, n + 1);
  }

  // Shape the final rule given the computed env coverage. If the rule's
  // footprint covers every applicable env (and applicableEnvs was provided),
  // emit `allEnvironments: true` with no `environments` field. Otherwise
  // emit the explicit env list (filtered to the applicable set if one was
  // given). Returns null if nothing to emit.
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
        // Non-merged emission. We only need to suffix the id when there's a
        // real collision: either the group has >= 2 occurrences across envs
        // (non-mergeable collision) or the id is duplicated within a single
        // env (dupInEnv). A lone occurrence with no siblings keeps the bare
        // legacy id — suffixing would be pure noise.
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
