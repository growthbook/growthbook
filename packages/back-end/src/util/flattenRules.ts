import crypto from "crypto";
import isEqual from "lodash/isEqual";
import { FeatureRule } from "shared/validators";

// Input shape: legacy rules keyed by env. Rules may lack uid/allEnvironments/environments
// since those fields only exist in the unified shape.
export type LegacyFeatureRule = Omit<
  FeatureRule,
  "uid" | "allEnvironments" | "environments"
>;

export type LegacyRulesByEnv = Record<string, LegacyFeatureRule[]>;

/**
 * Generate a stable, deterministic uid for a rule. Re-reading the same legacy
 * document always produces the same uid so downstream references (ramp targets,
 * audit log entries) remain resolvable across JIT invocations.
 *
 * envContext is:
 *   - "*"  when the rule is merged across multiple envs
 *   - "<env>" when the rule is env-specific (either only appeared in one env or
 *     was split from a merge candidate due to content/order conflict)
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
 * Returns true if the value is already a flat FeatureRule[] (post-migration shape).
 * Used by JIT upgraders to fast-path already-migrated documents.
 */
export function isAlreadyFlat(rules: unknown): rules is FeatureRule[] {
  if (!Array.isArray(rules)) return false;
  if (rules.length === 0) return true;
  // Every entry must have a uid field (string) to be considered flat.
  // Legacy rules never had this field.
  return rules.every(
    (r) => r && typeof r === "object" && typeof (r as { uid?: unknown }).uid === "string",
  );
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

function contentEquivalent(a: LegacyFeatureRule, b: LegacyFeatureRule): boolean {
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
function canonicalEnvOrder(
  envs: string[],
  envOrder?: string[],
): string[] {
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
  rule: LegacyFeatureRule;
  position: number; // index within that env's legacy list
};

/**
 * Flatten a legacy Record<env, FeatureRule[]> into a single unified FeatureRule[].
 *
 * Semantics (enforced by tests):
 *  - Rules grouped by legacy `id` across envs.
 *  - A group merges into ONE unified rule iff ALL occurrences are content-identical
 *    AND merging does not create a relative-order conflict with other merge candidates.
 *  - When a group cannot merge, each occurrence becomes its own env-specific rule.
 *  - Merged rules get uid = hash(featureId, id, "*"); env-specific get uid = hash(featureId, id, env).
 *  - A merged rule whose occurrences cover EVERY env in `opts.applicableEnvs`
 *    emits with `allEnvironments: true` and `environments` omitted. Otherwise it
 *    emits with `allEnvironments: false` and an explicit `environments` list.
 *    `applicableEnvs` must be the caller's applicable-env set for the feature
 *    (i.e. `filterEnvironmentsByFeature(orgEnvs, feature)` mapped to ids).
 *    When `applicableEnvs` is omitted, `allEnvironments: true` is never emitted.
 *  - Deterministic: same input yields same output (order + uids).
 */
export function flattenRules(
  featureId: string,
  rulesByEnv: LegacyRulesByEnv,
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
        const dir =
          xOcc.position < yOcc.position ? "x-before-y" : "y-before-x";
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
  //      - If finalMerged: emit ONCE (first time seen). environments = [all envs
  //        where this legacy id appears].
  //      - Else: emit as env-specific. One per occurrence.
  //    - Skip already-emitted merged rules on subsequent envs.

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
    rule: LegacyFeatureRule,
    uid: string,
    rawEnvList: string[],
  ): FeatureRule | null {
    const filtered = applicableSet
      ? rawEnvList.filter((e) => applicableSet.has(e))
      : rawEnvList;
    if (filtered.length === 0) return null;

    const coversAllApplicable =
      applicableSet !== null &&
      applicableSet.size > 0 &&
      filtered.length === applicableSet.size;

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
