import { FeatureRule } from "shared/validators";
import { Environment } from "shared/types/organization";
import { stemRuleId, suffixRuleId } from "shared/util";
import {
  ensureUniqueRuleIds,
  flattenV1ToV2Rules,
  getApplicableEnvIds,
  hasNoV1EnvRules,
  isV2RevisionRules,
  narrowRuleForEnvRemoval,
  ruleFootprint,
  V1FeatureRule,
  V1RulesByEnv,
  rampTargetsEquivalent,
  resolveRampTarget,
  resolveRampTargets,
} from "../../src/util/flattenRules";

// ---------- helpers ----------

// Build a minimal ForceRule. The only fields that matter for
// flattenV1ToV2Rules' logic are `id` (for grouping) and the other content
// fields (for equality).
function forceRule(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): V1FeatureRule {
  return {
    id,
    type: "force",
    description: "",
    value: "true",
    enabled: true,
    ...overrides,
  } as unknown as V1FeatureRule;
}

function rolloutRule(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): V1FeatureRule {
  return {
    id,
    type: "rollout",
    description: "",
    value: "true",
    enabled: true,
    coverage: 0.5,
    hashAttribute: "id",
    ...overrides,
  } as unknown as V1FeatureRule;
}

// Extract just the bits we care about comparing in output assertions.
type Slim = {
  id: string;
  allEnvironments: boolean;
  environments: string[] | undefined;
};
function slim(rules: FeatureRule[]): Slim[] {
  return rules.map((r) => ({
    id: r.id,
    allEnvironments: r.allEnvironments,
    environments: r.environments,
  }));
}

describe("flattenV1ToV2Rules", () => {
  // ================= baseline / empty =================

  describe("baseline", () => {
    it("returns [] for empty input", () => {
      expect(flattenV1ToV2Rules({})).toEqual([]);
    });

    it("returns [] when every env has an empty array", () => {
      expect(flattenV1ToV2Rules({ dev: [], prod: [] })).toEqual([]);
    });

    it("skips rules missing an id field (malformed legacy data)", () => {
      const input = {
        dev: [
          { type: "force", value: "true" } as unknown as V1FeatureRule,
          forceRule("r1"),
        ],
      };
      const out = flattenV1ToV2Rules(input);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("r1");
    });
  });

  // ================= single env =================

  describe("single env", () => {
    it("emits a single rule with bare id (no suffix — nothing to disambiguate from)", () => {
      const out = flattenV1ToV2Rules({ dev: [forceRule("r1")] });
      expect(slim(out)).toEqual([
        {
          id: "r1",
          allEnvironments: false,
          environments: ["dev"],
        },
      ]);
    });

    it("preserves order of multiple rules in the same env", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1"), forceRule("r2"), forceRule("r3")],
      });
      expect(out.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
      out.forEach((r) => expect(r.environments).toEqual(["dev"]));
    });
  });

  // ================= multi-env: full merge =================

  describe("content-identical across all envs", () => {
    it("merges into a single rule with bare id and all envs in `environments`", () => {
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules({
        dev: [{ ...r }],
        prod: [{ ...r }],
      });
      expect(out).toHaveLength(1);
      expect(slim(out)[0]).toEqual({
        id: "r1",
        allEnvironments: false,
        environments: ["dev", "prod"],
      });
    });

    it("merges across 3 envs", () => {
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules({
        dev: [{ ...r }],
        staging: [{ ...r }],
        prod: [{ ...r }],
      });
      expect(out).toHaveLength(1);
      expect(out[0].environments).toEqual(["dev", "prod", "staging"]);
    });

    it("emits allEnvironments=false with explicit env list when applicableEnvs is not provided", () => {
      // Without applicableEnvs we cannot know whether the rule truly covers
      // every env the feature applies to, so we play it safe.
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules({
        dev: [{ ...r }],
        prod: [{ ...r }],
      });
      expect(out[0].allEnvironments).toBe(false);
      expect(out[0].environments).toEqual(["dev", "prod"]);
    });
  });

  // ================= allEnvironments collapse =================

  describe("allEnvironments collapse via applicableEnvs", () => {
    it("emits allEnvironments=true (no environments field) when rule covers every applicable env", () => {
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules(
        { dev: [{ ...r }], prod: [{ ...r }] },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(true);
      expect(out[0]).not.toHaveProperty("environments");
    });

    it("emits explicit env list when rule misses at least one applicable env", () => {
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules(
        { dev: [{ ...r }], prod: [{ ...r }] },
        { applicableEnvs: ["dev", "prod", "staging"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(false);
      expect(out[0].environments).toEqual(["dev", "prod"]);
    });

    it("single-env rule in a single-applicable-env feature collapses to allEnvironments=true", () => {
      const out = flattenV1ToV2Rules(
        { prod: [forceRule("r1")] },
        { applicableEnvs: ["prod"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(true);
      expect(out[0]).not.toHaveProperty("environments");
    });

    it("preserves orphan envs in `environments` rather than collapsing to allEnvironments=true", () => {
      // Rule lives in dev/prod (applicable) and legacyReadOnly (orphan).
      // We do NOT collapse to allEnvironments because that would silently
      // erase the orphan; the UI surfaces it as a disallowed-env badge.
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules(
        {
          dev: [{ ...r }],
          prod: [{ ...r }],
          legacyReadOnly: [{ ...r }],
        },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(false);
      expect(out[0].environments).toEqual(["dev", "legacyReadOnly", "prod"]);
    });

    it("env-specific rule in a non-applicable env preserves the orphan label", () => {
      const out = flattenV1ToV2Rules(
        { legacyReadOnly: [forceRule("orphan")] },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("orphan");
      expect(out[0].allEnvironments).toBe(false);
      expect(out[0].environments).toEqual(["legacyReadOnly"]);
    });

    it("content-diverged rules do not collapse to allEnvironments=true even if they span applicable set", () => {
      // Different `value` per env ⇒ split ⇒ each piece gets a suffixed id.
      const out = flattenV1ToV2Rules(
        {
          dev: [forceRule("r1", { value: "a" })],
          prod: [forceRule("r1", { value: "b" })],
        },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(2);
      out.forEach((r) => {
        expect(r.allEnvironments).toBe(false);
        expect(r.environments).toHaveLength(1);
      });
      // Both pieces are suffixed with their env — neither keeps the bare id.
      expect(out.map((r) => r.id).sort()).toEqual([
        suffixRuleId("r1", "dev"),
        suffixRuleId("r1", "prod"),
      ]);
      // Stemming recovers the original legacy id.
      out.forEach((r) => expect(stemRuleId(r.id)).toBe("r1"));
    });

    it("order-conflicting rules: only the conflicting predecessor splits; the trailing rule safely merges (round-trip preserves env order)", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const out = flattenV1ToV2Rules(
        { dev: [A, B], prod: [B, A] },
        { applicableEnvs: ["dev", "prod"] },
      );
      // A splits (preds(A) in prod = {B} which is not a pred of A in its
      // canonical-first env). B safely merges across [dev, prod] because A
      // (now split) is no longer a "merged predecessor" obstructing B.
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      expect(byStem("A")).toHaveLength(2);
      expect(byStem("B")).toHaveLength(1);
      expect(byStem("B")[0].id).toBe("B");
      expect(byStem("B")[0].allEnvironments).toBe(true);

      // Buckets must round-trip back to v1 on-disk order in each env.
      const bucketBy = (env: string) =>
        out
          .filter((r) =>
            r.allEnvironments ? true : (r.environments ?? []).includes(env),
          )
          .map((r) => stemRuleId(r.id));
      expect(bucketBy("dev")).toEqual(["A", "B"]);
      expect(bucketBy("prod")).toEqual(["B", "A"]);
    });

    it("empty applicableEnvs preserves rule with raw envs labeled as orphans (no silent drop)", () => {
      const out = flattenV1ToV2Rules(
        { dev: [forceRule("r1")] },
        { applicableEnvs: [] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("r1");
      expect(out[0].allEnvironments).toBe(false);
      expect(out[0].environments).toEqual(["dev"]);
    });
  });

  // ================= partial envs =================

  describe("rule in a subset of envs", () => {
    it("merges with environments = only the envs it appears in", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1")],
        staging: [forceRule("r1")],
        prod: [],
      });
      expect(out).toHaveLength(1);
      expect(out[0].environments).toEqual(["dev", "staging"]);
      expect(out[0].id).toBe("r1");
    });

    it("emits env-specific with bare id for rules that appear in only one env each (no collision)", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("onlyDev")],
        prod: [forceRule("onlyProd")],
      });
      expect(out.map((r) => r.id).sort()).toEqual(["onlyDev", "onlyProd"]);
      const dev = out.find((r) => r.id === "onlyDev")!;
      const prod = out.find((r) => r.id === "onlyProd")!;
      expect(dev.environments).toEqual(["dev"]);
      expect(prod.environments).toEqual(["prod"]);
    });
  });

  // ================= content divergence =================

  describe("same id but diverging content → suffixed ids", () => {
    it("splits into env-specific rules with `__<env>` suffixes when `value` differs", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1", { value: "true" })],
        prod: [forceRule("r1", { value: "false" })],
      });
      expect(out).toHaveLength(2);
      const devRule = out.find((r) =>
        r.environments?.includes("dev"),
      )! as FeatureRule & { value: string };
      const prodRule = out.find((r) =>
        r.environments?.includes("prod"),
      )! as FeatureRule & { value: string };
      expect(devRule.value).toBe("true");
      expect(prodRule.value).toBe("false");
      expect(devRule.id).toBe(suffixRuleId("r1", "dev"));
      expect(prodRule.id).toBe(suffixRuleId("r1", "prod"));
    });

    it("splits when `enabled` differs", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1", { enabled: true })],
        prod: [forceRule("r1", { enabled: false })],
      });
      expect(out).toHaveLength(2);
    });

    it("splits when `condition` differs", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1", { condition: '{"env":"dev"}' })],
        prod: [forceRule("r1", { condition: '{"env":"prod"}' })],
      });
      expect(out).toHaveLength(2);
    });

    it("splits when scheduleRules differ", () => {
      const sched = [{ timestamp: "2024-01-01T00:00:00Z", enabled: true }];
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1", { scheduleRules: sched })],
        prod: [forceRule("r1", { scheduleRules: [] })],
      });
      expect(out).toHaveLength(2);
    });

    it("considers content-equivalent if only allEnvironments/environments differ (hygiene)", () => {
      // In practice these fields won't be on legacy input, but if callers pass
      // partially-upgraded rules they should not cause spurious splits.
      const a = {
        ...forceRule("r1"),
        environments: ["dev"],
      } as unknown as V1FeatureRule;
      const b = {
        ...forceRule("r1"),
        environments: ["prod"],
      } as unknown as V1FeatureRule;
      const out = flattenV1ToV2Rules({ dev: [a], prod: [b] });
      expect(out).toHaveLength(1);
    });

    it("groups already-suffixed ids with their stem so round-tripped data re-merges or re-splits coherently", () => {
      // Simulates v2 → v1 → v2: the v1 input carries pre-stemmed ids because
      // toLegacyRule strips suffixes, but we also exercise the defensive
      // case where a suffixed id leaks in. Both cases must produce the same
      // stable output.
      const out = flattenV1ToV2Rules({
        dev: [
          {
            ...forceRule(suffixRuleId("r1", "dev"), { value: "a" }),
          } as V1FeatureRule,
        ],
        prod: [
          {
            ...forceRule(suffixRuleId("r1", "prod"), { value: "b" }),
          } as V1FeatureRule,
        ],
      });
      // Grouped by stem, content differs, re-split with suffixes.
      expect(out).toHaveLength(2);
      out.forEach((r) => expect(stemRuleId(r.id)).toBe("r1"));
    });
  });

  // ================= order =================

  describe("rule ordering across envs", () => {
    it("merges both rules when order is consistent in all shared envs", () => {
      const r1 = forceRule("r1");
      const r2 = forceRule("r2");
      const out = flattenV1ToV2Rules({
        dev: [r1, r2],
        prod: [r1, r2],
      });
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.id)).toEqual(["r1", "r2"]);
      out.forEach((r) => expect(r.environments).toEqual(["dev", "prod"]));
    });

    it("two-env order conflict: only the rule whose preds-in-non-first-env aren't preds-in-first-env splits", () => {
      const r1 = forceRule("r1");
      const r2 = forceRule("r2");
      const out = flattenV1ToV2Rules({
        dev: [r1, r2],
        prod: [r2, r1],
      });
      // r1 splits (preds(r1) in prod = {r2}, but firstPreds(r1) = {} since
      // r1 is at pos 0 in dev). r2 safely merges (no preds in prod, so
      // nothing forces a split).
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      expect(byStem("r1")).toHaveLength(2);
      expect(
        byStem("r1")
          .map((r) => r.id)
          .sort(),
      ).toEqual([suffixRuleId("r1", "dev"), suffixRuleId("r1", "prod")]);
      expect(byStem("r2")).toHaveLength(1);
      expect(byStem("r2")[0].id).toBe("r2");

      // Bucket round-trip preserves v1 order in both envs.
      const bucketBy = (env: string) =>
        out
          .filter((r) =>
            r.allEnvironments ? true : (r.environments ?? []).includes(env),
          )
          .map((r) => stemRuleId(r.id));
      expect(bucketBy("dev")).toEqual(["r1", "r2"]);
      expect(bucketBy("prod")).toEqual(["r2", "r1"]);
    });

    it("3-rule swap in tail: leading rule and trailing predecessors merge; only the rule whose predecessors disagree splits", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const C = forceRule("C");
      const out = flattenV1ToV2Rules({
        dev: [A, B, C],
        prod: [A, C, B],
      });
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      // A merges (no preds in either env). B splits (preds(B) in prod
      // includes C which isn't in firstPreds(B) = {A}). C merges (preds(C) in
      // prod = {A} ⊆ firstPreds(C) = {A, B}, and A is mergeable).
      expect(byStem("A")).toHaveLength(1);
      expect(byStem("A")[0].id).toBe("A");
      expect(byStem("A")[0].environments).toEqual(["dev", "prod"]);
      expect(byStem("B")).toHaveLength(2);
      expect(byStem("C")).toHaveLength(1);
      expect(byStem("C")[0].id).toBe("C");
      expect(byStem("C")[0].environments).toEqual(["dev", "prod"]);

      // Bucket round-trip preserves v1 order.
      const bucketBy = (env: string) =>
        out
          .filter((r) =>
            r.allEnvironments ? true : (r.environments ?? []).includes(env),
          )
          .map((r) => stemRuleId(r.id));
      expect(bucketBy("dev")).toEqual(["A", "B", "C"]);
      expect(bucketBy("prod")).toEqual(["A", "C", "B"]);
    });

    it("preserves within-env order for split rules", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const out = flattenV1ToV2Rules({
        dev: [A, B],
        prod: [B, A],
      });
      // A splits (its preds in prod include mergeable B which isn't a pred in
      // dev). B safely merges — bucket round-trip preserves [A, B] / [B, A].
      const bucketBy = (env: string) =>
        out
          .filter((r) =>
            r.allEnvironments ? true : (r.environments ?? []).includes(env),
          )
          .map((r) => stemRuleId(r.id));
      expect(bucketBy("dev")).toEqual(["A", "B"]);
      expect(bucketBy("prod")).toEqual(["B", "A"]);
    });

    // Regression: real-world multi-env hybrid feature where two rules F, G
    // are content-equivalent across {production, azure-prod, single-tenants-prod}
    // but azure-prod ALSO has a non-mergeable multi-env predecessor U at pos 0.
    // Naive merge anchors F, G at production's iteration and reorders
    // azure-prod's bucket to [F, G, U, T] instead of v1's [U, T, F, G].
    // Order-conflict detection must split F and G to keep the bucket invariant.
    it("splits a mergeable rule when a non-mergeable predecessor only exists in non-canonical-first envs", () => {
      // U is multi-env but content-divergent (split per env).
      const uDev = forceRule("U", { value: "u-dev" });
      const uAzure = forceRule("U", { value: "u-azure" });
      const uStaging = forceRule("U", { value: "u-staging" });
      // T is multi-env but content-divergent (also split per env).
      const tDev = forceRule("T", { value: "t-dev" });
      const tProd = forceRule("T", { value: "t-prod" });
      const tAzure = forceRule("T", { value: "t-azure" });
      const tSingleTenants = forceRule("T", { value: "t-single" });
      const tStaging = forceRule("T", { value: "t-staging" });
      // F, G are content-equivalent across the 3 envs they appear in.
      const f = forceRule("F", { value: "f" });
      const g = forceRule("G", { value: "g" });

      const out = flattenV1ToV2Rules(
        {
          dev: [tDev, uDev],
          production: [tProd, { ...f }, { ...g }],
          "azure-prod": [uAzure, tAzure, { ...f }, { ...g }],
          "single-tenants-prod": [tSingleTenants, { ...f }, { ...g }],
          staging: [tStaging, uStaging],
        },
        {
          envOrder: [
            "dev",
            "production",
            "azure-prod",
            "single-tenants-prod",
            "staging",
          ],
        },
      );

      // F and G must NOT merge — they'd reorder azure-prod's bucket.
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      expect(byStem("F")).toHaveLength(3);
      expect(byStem("G")).toHaveLength(3);
      byStem("F").forEach((r) => expect(r.environments).toHaveLength(1));
      byStem("G").forEach((r) => expect(r.environments).toHaveLength(1));

      // Round-trip into per-env buckets must equal the original v1 order.
      const bucketBy = (env: string) =>
        out
          .filter((r) =>
            r.allEnvironments ? true : (r.environments ?? []).includes(env),
          )
          .map((r) => stemRuleId(r.id));
      expect(bucketBy("dev")).toEqual(["T", "U"]);
      expect(bucketBy("production")).toEqual(["T", "F", "G"]);
      expect(bucketBy("azure-prod")).toEqual(["U", "T", "F", "G"]);
      expect(bucketBy("single-tenants-prod")).toEqual(["T", "F", "G"]);
      expect(bucketBy("staging")).toEqual(["T", "U"]);
    });
  });

  // ================= emission order =================

  describe("deterministic output order", () => {
    it("walks envs in canonical (alphabetical) order by default", () => {
      const r1 = forceRule("r1");
      const out = flattenV1ToV2Rules({
        prod: [r1],
        dev: [r1],
        staging: [r1],
      });
      expect(out[0].environments).toEqual(["dev", "prod", "staging"]);
    });

    it("honors opts.envOrder when provided", () => {
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules(
        {
          prod: [r],
          dev: [r],
          staging: [r],
        },
        { envOrder: ["prod", "staging", "dev"] },
      );
      expect(out[0].environments).toEqual(["prod", "staging", "dev"]);
    });

    it("envOrder puts unknown envs alphabetically at the end", () => {
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules(
        { prod: [r], dev: [r], zzzCustom: [r] },
        { envOrder: ["prod", "dev"] },
      );
      expect(out[0].environments).toEqual(["prod", "dev", "zzzCustom"]);
    });

    it("merged rule is emitted once, anchored at the first env in canonical order", () => {
      const X = forceRule("X");
      const Y = forceRule("Y");
      const out = flattenV1ToV2Rules({
        dev: [X],
        prod: [X, Y],
      });
      expect(out.map((r) => r.id)).toEqual(["X", "Y"]);
    });
  });

  // ================= determinism =================

  describe("determinism", () => {
    it("produces identical output (including ids) on repeated calls", () => {
      const input: V1RulesByEnv = {
        dev: [forceRule("a"), forceRule("b"), rolloutRule("c")],
        prod: [forceRule("a"), forceRule("b")],
      };
      const out1 = flattenV1ToV2Rules(input);
      const out2 = flattenV1ToV2Rules(input);
      expect(out1).toEqual(out2);
    });

    it("id shape differs between merged and env-specific variants of the same legacy id", () => {
      const r = forceRule("r1");
      const merged = flattenV1ToV2Rules({
        dev: [r],
        prod: [r],
      });
      const split = flattenV1ToV2Rules({
        dev: [{ ...r, value: "x" }],
        prod: [{ ...r, value: "y" }],
      });
      // Merged keeps bare id.
      expect(merged[0].id).toBe("r1");
      // Split assigns env-suffixed ids.
      expect(split[0].id).not.toBe(split[1].id);
      expect(split.map((s) => s.id).sort()).toEqual([
        suffixRuleId("r1", "dev"),
        suffixRuleId("r1", "prod"),
      ]);
    });
  });

  // ================= realistic combos =================

  describe("realistic scenarios", () => {
    it("handles a mix of merged, partial-env, and env-specific rules", () => {
      const shared = forceRule("shared");
      const out = flattenV1ToV2Rules({
        dev: [{ ...shared }, forceRule("devTweak", { value: "dev" })],
        prod: [
          { ...shared },
          forceRule("devTweak", { value: "prod" }),
          forceRule("prodOnly"),
        ],
      });
      expect(out).toHaveLength(4);
      // Ids: merged "shared" stays bare; "devTweak" splits with env suffixes;
      // "prodOnly" (single-env, no collision) stays bare.
      expect(out.map((r) => r.id)).toEqual([
        "shared",
        suffixRuleId("devTweak", "dev"),
        suffixRuleId("devTweak", "prod"),
        "prodOnly",
      ]);
      expect(out[0].environments).toEqual(["dev", "prod"]);
      expect(out[1].environments).toEqual(["dev"]);
      expect(out[2].environments).toEqual(["prod"]);
      expect(out[3].environments).toEqual(["prod"]);
    });

    it("handles rollout rule with savedGroups preserved through merge", () => {
      const r = rolloutRule("r1", {
        savedGroups: [{ match: "all", ids: ["g1"] }],
      });
      const out = flattenV1ToV2Rules({
        dev: [r],
        prod: [r],
      });
      expect(out).toHaveLength(1);
      expect(
        (out[0] as FeatureRule & { savedGroups: unknown }).savedGroups,
      ).toEqual([{ match: "all", ids: ["g1"] }]);
    });
  });

  // ================= hardening / pathological inputs =================

  describe("hardening", () => {
    it("different rule types with the same legacy id are treated as content-different (split, suffixed)", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1")],
        prod: [rolloutRule("r1")],
      });
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.id).sort()).toEqual([
        suffixRuleId("r1", "dev"),
        suffixRuleId("r1", "prod"),
      ]);
    });

    it("3+ envs: any content divergence splits the whole group into per-env suffixed rules", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1", { value: "a" })],
        staging: [forceRule("r1", { value: "a" })],
        prod: [forceRule("r1", { value: "b" })],
      });
      expect(out).toHaveLength(3);
      out.forEach((r) => expect(r.environments).toHaveLength(1));
      expect(out.map((r) => r.id).sort()).toEqual([
        suffixRuleId("r1", "dev"),
        suffixRuleId("r1", "prod"),
        suffixRuleId("r1", "staging"),
      ]);
    });

    it("trailing rule with disagreeing predecessor sequence cannot merge — splits transitively", () => {
      const X = forceRule("X");
      const Y = forceRule("Y");
      const Z = forceRule("Z");
      const out = flattenV1ToV2Rules({
        dev: [X, Y, Z],
        prod: [Y, X, Z],
      });
      // X splits (preds(X) in prod = {Y}, not in firstPreds(X)). Once X is
      // split, Z's preds in prod = {Y, X} include the now-non-mergeable X,
      // so Z must split too. Y safely merges (no preds in prod). Each env's
      // bucket round-trips: dev=[X,Y,Z], prod=[Y,X,Z].
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      expect(byStem("X")).toHaveLength(2);
      expect(byStem("Y")).toHaveLength(1);
      expect(byStem("Y")[0].id).toBe("Y");
      expect(byStem("Z")).toHaveLength(2);

      const bucketBy = (env: string) =>
        out
          .filter((r) =>
            r.allEnvironments ? true : (r.environments ?? []).includes(env),
          )
          .map((r) => stemRuleId(r.id));
      expect(bucketBy("dev")).toEqual(["X", "Y", "Z"]);
      expect(bucketBy("prod")).toEqual(["Y", "X", "Z"]);
    });

    it("conflicting pair only co-occurs in a subset of envs: predecessor-set check still splits the leading rule and lets the trailing one merge", () => {
      const X = forceRule("X");
      const Y = forceRule("Y");
      const out = flattenV1ToV2Rules({
        dev: [X, Y],
        staging: [X],
        prod: [Y, X],
      });
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      // X splits across all 3 envs (preds in prod include Y not in firstPreds(X)).
      // Y safely merges across [dev, prod] (no preds in prod, only in dev).
      expect(byStem("X")).toHaveLength(3);
      expect(byStem("Y")).toHaveLength(1);
      expect(byStem("Y")[0].id).toBe("Y");
      expect(byStem("Y")[0].environments).toEqual(["dev", "prod"]);

      const bucketBy = (env: string) =>
        out
          .filter((r) =>
            r.allEnvironments ? true : (r.environments ?? []).includes(env),
          )
          .map((r) => stemRuleId(r.id));
      expect(bucketBy("dev")).toEqual(["X", "Y"]);
      expect(bucketBy("staging")).toEqual(["X"]);
      expect(bucketBy("prod")).toEqual(["Y", "X"]);
    });

    it("pair is consistent because they never share an env → still 'merges' (one-env each, no suffix)", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("X")],
        prod: [forceRule("Y")],
      });
      expect(out).toHaveLength(2);
      out.forEach((r) => expect(r.environments).toHaveLength(1));
      expect(out.map((r) => r.id).sort()).toEqual(["X", "Y"]);
    });

    it("preserves full rule body (condition, savedGroups, scheduleRules, prerequisites) on merge", () => {
      const rich = forceRule("r1", {
        description: "the rule",
        condition: '{"country":"US"}',
        enabled: true,
        scheduleRules: [
          { timestamp: "2024-01-01T00:00:00Z", enabled: true },
          { timestamp: "2024-02-01T00:00:00Z", enabled: false },
        ],
        savedGroups: [{ match: "all", ids: ["g1", "g2"] }],
        prerequisites: [{ id: "prereq1", condition: '{"value":true}' }],
        scheduleType: "schedule",
      });
      const out = flattenV1ToV2Rules({
        dev: [{ ...rich }],
        prod: [{ ...rich }],
      });
      expect(out).toHaveLength(1);
      const r = out[0] as FeatureRule & Record<string, unknown>;
      expect(r.id).toBe("r1");
      expect(r.description).toBe("the rule");
      expect(r.condition).toBe('{"country":"US"}');
      expect(r.scheduleRules).toEqual([
        { timestamp: "2024-01-01T00:00:00Z", enabled: true },
        { timestamp: "2024-02-01T00:00:00Z", enabled: false },
      ]);
      expect(r.savedGroups).toEqual([{ match: "all", ids: ["g1", "g2"] }]);
      expect(r.prerequisites).toEqual([
        { id: "prereq1", condition: '{"value":true}' },
      ]);
      expect(r.scheduleType).toBe("schedule");
    });

    it("scales to many envs and many rules without performance pathologies", () => {
      const envs = Array.from({ length: 10 }, (_, i) => `env${i}`);
      const rules = Array.from({ length: 50 }, (_, i) =>
        forceRule(`r${i}`, { value: `v${i % 5}` }),
      );
      const input: V1RulesByEnv = {};
      for (const env of envs) input[env] = rules.map((r) => ({ ...r }));
      const t0 = Date.now();
      const out = flattenV1ToV2Rules(input);
      const elapsed = Date.now() - t0;
      expect(out).toHaveLength(50);
      out.forEach((r) => expect(r.environments).toHaveLength(10));
      expect(elapsed).toBeLessThan(500);
    });

    it("duplicate legacy id within the same env: emits each occurrence with a disambiguated id (`__<env>`, `__<env>__2`, ...)", () => {
      const r1a = forceRule("dup", { value: "first" });
      const r1b = forceRule("dup", { value: "second" });
      const out = flattenV1ToV2Rules({
        dev: [r1a, r1b],
      });
      expect(out).toHaveLength(2);
      expect(
        out.map((r) => (r as FeatureRule & { value: string }).value),
      ).toEqual(["first", "second"]);
      expect(out[0].id).toBe(suffixRuleId("dup", "dev"));
      expect(out[1].id).toBe(suffixRuleId("dup", "dev", 2));
      // Both stem back to the legacy id.
      out.forEach((r) => expect(stemRuleId(r.id)).toBe("dup"));
    });

    it("3+ duplicates in same env get distinct, deterministic ids", () => {
      const out = flattenV1ToV2Rules({
        dev: [
          forceRule("dup", { value: "1" }),
          forceRule("dup", { value: "2" }),
          forceRule("dup", { value: "3" }),
        ],
      });
      expect(out).toHaveLength(3);
      expect(new Set(out.map((r) => r.id)).size).toBe(3);
      expect(out[0].id).toBe(suffixRuleId("dup", "dev"));
      expect(out[1].id).toBe(suffixRuleId("dup", "dev", 2));
      expect(out[2].id).toBe(suffixRuleId("dup", "dev", 3));
    });

    it("duplicate id in one env + same id in another env: all emitted suffixed (no merge)", () => {
      const base = forceRule("shared");
      const out = flattenV1ToV2Rules({
        dev: [{ ...base }, { ...base }],
        prod: [{ ...base }],
      });
      expect(out).toHaveLength(3);
      const ids = out.map((r) => r.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids).toContain(suffixRuleId("shared", "dev"));
      expect(ids).toContain(suffixRuleId("shared", "dev", 2));
      expect(ids).toContain(suffixRuleId("shared", "prod"));
      out.forEach((r) => {
        expect(r.allEnvironments).toBe(false);
        expect(r.environments).toHaveLength(1);
      });
    });
  });

  // ================= output shape invariants =================

  describe("output invariants", () => {
    it("without applicableEnvs, every output rule has allEnvironments=false and non-empty environments", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("a"), forceRule("b")],
        prod: [forceRule("a"), forceRule("c")],
      });
      for (const r of out) {
        expect(typeof r.id).toBe("string");
        expect(r.id.length).toBeGreaterThan(0);
        expect(r.allEnvironments).toBe(false);
        expect(Array.isArray(r.environments)).toBe(true);
        expect(r.environments!.length).toBeGreaterThan(0);
      }
    });

    it("all ids in the output are unique", () => {
      const out = flattenV1ToV2Rules({
        dev: [forceRule("r1"), forceRule("r2"), forceRule("r3")],
        prod: [
          forceRule("r1"),
          forceRule("r2", { value: "different" }),
          forceRule("r3"),
        ],
      });
      const ids = out.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

// ================= isV2RevisionRules =================

describe("isV2RevisionRules", () => {
  it("returns true for empty array (zero-rule unified revision)", () => {
    expect(isV2RevisionRules([])).toBe(true);
  });

  it("returns true for any array", () => {
    expect(isV2RevisionRules([{ id: "r1" }])).toBe(true);
    expect(isV2RevisionRules([{ id: "r1__production" }])).toBe(true);
  });

  it("returns false for a Record<env, rules> (legacy) shape", () => {
    expect(isV2RevisionRules({ dev: [] })).toBe(false);
    expect(isV2RevisionRules({ dev: [{ id: "r1" }] })).toBe(false);
  });

  it("returns false for null/undefined/non-array values", () => {
    expect(isV2RevisionRules(null)).toBe(false);
    expect(isV2RevisionRules(undefined)).toBe(false);
    expect(isV2RevisionRules("unexpected")).toBe(false);
  });
});

// ================= hasNoV1EnvRules =================

describe("hasNoV1EnvRules", () => {
  it("returns true for empty env settings map", () => {
    expect(hasNoV1EnvRules({})).toBe(true);
  });

  it("returns true when no env has a rules key", () => {
    expect(
      hasNoV1EnvRules({
        dev: { enabled: true },
        prod: { enabled: false },
      }),
    ).toBe(true);
  });

  it("treats rules: [] and rules: undefined as v2 (pre-scrub write artifact)", () => {
    expect(
      hasNoV1EnvRules({
        dev: { enabled: true, rules: [] },
        prod: { enabled: false },
      }),
    ).toBe(true);
    expect(
      hasNoV1EnvRules({
        dev: { enabled: true, rules: undefined },
        prod: { enabled: false },
      }),
    ).toBe(true);
  });

  it("returns false when any env has a populated rules array (legacy v1)", () => {
    expect(
      hasNoV1EnvRules({
        dev: { enabled: true, rules: [{ id: "r1" }] },
        prod: { enabled: false, rules: [] },
      }),
    ).toBe(false);
  });
});

// ================= ensureUniqueRuleIds =================

describe("ensureUniqueRuleIds", () => {
  const rule = (
    id: string,
    scope: { allEnvironments?: boolean; environments?: string[] } = {
      allEnvironments: true,
    },
  ): FeatureRule =>
    ({
      id,
      allEnvironments: scope.allEnvironments ?? false,
      environments: scope.environments,
      description: "",
      type: "force",
    }) as unknown as FeatureRule;

  it("returns empty list unchanged", () => {
    const result = ensureUniqueRuleIds([]);
    expect(result.rules).toEqual([]);
    expect(result.collisions).toEqual([]);
  });

  it("is a no-op on unique ids", () => {
    const input = [rule("a"), rule("b"), rule("c")];
    const result = ensureUniqueRuleIds(input);
    expect(result.rules).toEqual(input);
    expect(result.collisions).toEqual([]);
  });

  it("suffixes later duplicates and reports collisions", () => {
    const result = ensureUniqueRuleIds([
      rule("a", { allEnvironments: true }),
      rule("b", { environments: ["dev"] }),
      rule("a", { allEnvironments: true }),
      rule("c"),
      rule("b", { environments: ["dev"] }),
    ]);
    const ids = result.rules.map((r) => r.id);
    // First occurrence of each id is preserved unchanged
    expect(ids[0]).toBe("a");
    expect(ids[1]).toBe("b");
    // Subsequent dups are suffixed via the stem-aware convention
    expect(ids[2]).not.toBe("a");
    expect(ids[2].startsWith("a__")).toBe(true);
    expect(ids[4]).not.toBe("b");
    expect(ids[4].startsWith("b__")).toBe(true);
    // All ids end up unique
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.collisions.map((c) => c.originalId).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("uses the rule's single-env scope as the suffix envHint", () => {
    const result = ensureUniqueRuleIds([
      rule("x", { environments: ["prod"] }),
      rule("x", { environments: ["prod"] }),
    ]);
    expect(result.rules[0].id).toBe("x");
    expect(result.rules[1].id).toBe(suffixRuleId("x", "prod", 2));
  });

  it("falls back to 'all' envHint for allEnvironments rules", () => {
    const result = ensureUniqueRuleIds([
      rule("x", { allEnvironments: true }),
      rule("x", { allEnvironments: true }),
    ]);
    expect(result.rules[1].id).toBe(suffixRuleId("x", "all", 2));
  });

  it("falls back to 'dup' envHint for multi-env rules", () => {
    const result = ensureUniqueRuleIds([
      rule("x", { environments: ["dev", "prod"] }),
      rule("x", { environments: ["dev", "prod"] }),
    ]);
    expect(result.rules[1].id).toBe(suffixRuleId("x", "dup", 2));
  });

  it("skips already-assigned suffixes to avoid secondary collisions", () => {
    const result = ensureUniqueRuleIds([
      rule("x", { environments: ["dev"] }),
      rule("x__dev__2", { environments: ["dev"] }),
      rule("x", { environments: ["dev"] }),
    ]);
    const ids = result.rules.map((r) => r.id);
    expect(ids[0]).toBe("x");
    expect(ids[1]).toBe("x__dev__2");
    expect(ids[2]).toBe(suffixRuleId("x", "dev", 3));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stems to the original id so external lookups still resolve", () => {
    const result = ensureUniqueRuleIds([
      rule("fr_abc", { environments: ["prod"] }),
      rule("fr_abc", { environments: ["prod"] }),
    ]);
    expect(stemRuleId(result.rules[0].id)).toBe("fr_abc");
    expect(stemRuleId(result.rules[1].id)).toBe("fr_abc");
  });

  it("is idempotent — re-running on its own output is a no-op", () => {
    const first = ensureUniqueRuleIds([
      rule("a", { environments: ["dev"] }),
      rule("a", { environments: ["dev"] }),
      rule("a", { environments: ["dev"] }),
    ]);
    const second = ensureUniqueRuleIds(first.rules);
    expect(second.rules.map((r) => r.id)).toEqual(first.rules.map((r) => r.id));
    expect(second.collisions).toEqual([]);
  });
});

// ================= getApplicableEnvIds =================

describe("getApplicableEnvIds", () => {
  const env = (id: string, projects?: string[]): Environment =>
    ({ id, projects }) as unknown as Environment;

  it("returns all env ids when feature has no project (org-wide feature)", () => {
    const envs = [env("dev", ["p1"]), env("prod"), env("staging", ["p2"])];
    expect(getApplicableEnvIds(envs)).toEqual(["dev", "prod", "staging"]);
  });

  it("includes envs whose projects list contains the feature project", () => {
    const envs = [env("dev", ["p1", "p2"]), env("prod", ["p1"])];
    expect(getApplicableEnvIds(envs, "p1")).toEqual(["dev", "prod"]);
    expect(getApplicableEnvIds(envs, "p2")).toEqual(["dev"]);
  });

  it("includes envs with no projects list (applies to all projects)", () => {
    const envs = [env("dev"), env("prod", ["p1"])];
    expect(getApplicableEnvIds(envs, "p2")).toEqual(["dev"]);
    expect(getApplicableEnvIds(envs, "p1")).toEqual(["dev", "prod"]);
  });

  it("treats an empty projects array as 'applies to all'", () => {
    const envs = [env("dev", []), env("prod", ["p1"])];
    expect(getApplicableEnvIds(envs, "p2")).toEqual(["dev"]);
  });

  it("returns [] when org has no envs", () => {
    expect(getApplicableEnvIds([], "p1")).toEqual([]);
  });

  it("preserves the order of orgEnvs", () => {
    const envs = [env("prod"), env("dev"), env("staging")];
    expect(getApplicableEnvIds(envs)).toEqual(["prod", "dev", "staging"]);
  });
});

// ================= ruleFootprint (back-end) =================
//
// Must stay semantically identical to the shared `ruleFootprint` helper —
// callers on both sides of the fence route the same rule through the same
// scope interpretation. Lock the tri-state contract here explicitly.

describe("ruleFootprint (back-end util)", () => {
  const applicable = ["dev", "staging", "production"];
  const base = {
    id: "r1",
    type: "force",
    description: "",
    value: "x",
    enabled: true,
  } as unknown as FeatureRule;

  it("allEnvironments: true expands to the applicable env set", () => {
    expect(
      ruleFootprint(
        { ...base, allEnvironments: true } as FeatureRule,
        applicable,
      ),
    ).toEqual(applicable);
  });

  it("environments:[list] intersects with the applicable set", () => {
    expect(
      ruleFootprint(
        {
          ...base,
          allEnvironments: false,
          environments: ["production", "dev", "unknown"],
        } as FeatureRule,
        applicable,
      ),
    ).toEqual(["production", "dev"]);
  });

  it("strict: explicit environments:[] returns [] (applies nowhere)", () => {
    expect(
      ruleFootprint(
        { ...base, allEnvironments: false, environments: [] } as FeatureRule,
        applicable,
      ),
    ).toEqual([]);
  });

  it("permissive fallback: neither field declared expands to applicable envs", () => {
    expect(ruleFootprint(base, applicable)).toEqual(applicable);
  });
});

// ================= narrowRuleForEnvRemoval =================
//
// v1 REST `DELETE /feature/:id/revision/:version/rule/:ruleId` is per-env:
// it removes one env from a unified rule's footprint. This helper codifies
// the decision — narrow vs fully delete — so the handler logic stays a
// thin orchestrator around a testable primitive.
//
// Behavior matrix the handler relies on:
//   - allEnvironments:true + delete one env → narrow to "every OTHER
//     applicable env" (rule stops implicitly following org env changes).
//   - environments:[a,b] + delete `a` → narrow to environments:[b].
//   - environments:[a] + delete `a` → action: "delete" (v1 DELETE-from-
//     last-env removes the rule entirely).
//   - environments:[a,b] + delete `c` (rule didn't apply to c) → no-op
//     narrow, never a silent delete.

describe("narrowRuleForEnvRemoval", () => {
  const applicable = ["dev", "staging", "production"];
  const base = {
    id: "r1",
    type: "force",
    description: "",
    value: "x",
    enabled: true,
  } as unknown as FeatureRule;

  it("allEnvironments:true, delete one env → narrows to the other applicable envs with allEnvironments:false", () => {
    const input = { ...base, allEnvironments: true } as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "production", applicable);
    expect(result.action).toBe("narrow");
    if (result.action !== "narrow") return;
    expect(result.rule.allEnvironments).toBe(false);
    expect(result.rule.environments).toEqual(["dev", "staging"]);
    // Original must not be mutated — the handler clones the flat array and
    // relies on `===` identity to dispatch; in-place mutation would defeat
    // the clone and leak into unrelated rules during the transform.
    expect(input.environments).toBeUndefined();
    expect(input.allEnvironments).toBe(true);
  });

  it("environments:[a,b], delete a → narrows to environments:[b]", () => {
    const input = {
      ...base,
      allEnvironments: false,
      environments: ["dev", "production"],
    } as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "dev", applicable);
    expect(result.action).toBe("narrow");
    if (result.action !== "narrow") return;
    expect(result.rule.allEnvironments).toBe(false);
    expect(result.rule.environments).toEqual(["production"]);
  });

  it("environments:[a], delete a → action:'delete' (v1 last-env = rule removed)", () => {
    const input = {
      ...base,
      allEnvironments: false,
      environments: ["production"],
    } as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "production", applicable);
    expect(result.action).toBe("delete");
  });

  it("allEnvironments:true on a project where only one env applies, delete that env → action:'delete'", () => {
    // Project-scoped features can have an applicable set of size 1. A rule
    // that applies to all of a single-env project collapses to "delete"
    // when that env is removed, same as environments:[a].
    const input = { ...base, allEnvironments: true } as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "dev", ["dev"]);
    expect(result.action).toBe("delete");
  });

  it("narrow preserves all non-scope rule fields (id, type, value, description, enabled, etc.)", () => {
    const input = {
      id: "r_safe",
      type: "safe-rollout",
      description: "ramp",
      enabled: true,
      value: "on",
      allEnvironments: true,
      safeRolloutId: "sr_1",
      coverage: 0.25,
    } as unknown as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "dev", applicable);
    expect(result.action).toBe("narrow");
    if (result.action !== "narrow") return;
    expect(result.rule.id).toBe("r_safe");
    expect(result.rule.type).toBe("safe-rollout");
    expect(
      (result.rule as unknown as { safeRolloutId?: string }).safeRolloutId,
    ).toBe("sr_1");
    expect((result.rule as unknown as { coverage?: number }).coverage).toBe(
      0.25,
    );
    expect(result.rule.description).toBe("ramp");
    expect(result.rule.enabled).toBe(true);
  });

  it("environments:[dev, unknown] intersected with applicable [dev,staging,prod], delete dev → action:'delete'", () => {
    // `unknown` is not in the applicable set, so the effective footprint is
    // just [dev]. Removing dev collapses to empty → rule deletion. This
    // matches `ruleFootprint`'s intersect-with-applicable behavior and
    // protects against a rule clinging to life via a phantom env id.
    const input = {
      ...base,
      allEnvironments: false,
      environments: ["dev", "unknown"],
    } as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "dev", applicable);
    expect(result.action).toBe("delete");
  });

  it("rule that does not apply to the target env → no-op narrow, never a silent delete", () => {
    // Precondition violation safeguard: if the handler's upstream
    // `ruleAppliesToEnv` check is ever bypassed, this helper must not
    // silently delete a rule the caller wasn't targeting. The footprint is
    // unchanged, so we emit a narrow to the same set.
    const input = {
      ...base,
      allEnvironments: false,
      environments: ["dev", "staging"],
    } as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "production", applicable);
    expect(result.action).toBe("narrow");
    if (result.action !== "narrow") return;
    expect(result.rule.environments).toEqual(["dev", "staging"]);
  });

  it("explicit environments:[] rule, delete any env → action:'delete' (footprint already empty)", () => {
    // `environments: []` is the strict-nowhere state. The handler's
    // `ruleAppliesToEnv` check would 404 before reaching this helper, but
    // if it did: empty footprint minus anything is still empty → delete.
    const input = {
      ...base,
      allEnvironments: false,
      environments: [] as string[],
    } as FeatureRule;
    const result = narrowRuleForEnvRemoval(input, "dev", applicable);
    expect(result.action).toBe("delete");
  });
});

// ================= resolveRampTarget =================
//
// Ramps target rules by the public (stem) id. The resolver stem-strips the
// candidate rule's id before comparing, so ramps authored against a
// pre-migration legacy id keep resolving even when the on-disk rule was
// subsequently renamed with a `__<env>` suffix during v1 → v2 flattening.

describe("resolveRampTarget", () => {
  const mergedRule: FeatureRule = {
    id: "r_merged",
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: false,
    environments: ["dev", "prod"],
  } as unknown as FeatureRule;

  const devOnlyRule: FeatureRule = {
    id: "r_devOnly",
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: false,
    environments: ["dev"],
  } as unknown as FeatureRule;

  const allEnvRule: FeatureRule = {
    id: "r_all",
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: true,
  } as unknown as FeatureRule;

  // A post-migration split pair: legacy id `r_split` existed in dev and prod
  // with non-mergeable content, so the flattener renamed both copies with
  // env suffixes. A ramp targeting `r_split` must still resolve.
  const splitDev: FeatureRule = {
    id: suffixRuleId("r_split", "dev"),
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: false,
    environments: ["dev"],
  } as unknown as FeatureRule;

  const splitProd: FeatureRule = {
    id: suffixRuleId("r_split", "prod"),
    type: "force",
    description: "",
    enabled: true,
    value: "false",
    allEnvironments: false,
    environments: ["prod"],
  } as unknown as FeatureRule;

  const rules = [mergedRule, devOnlyRule, allEnvRule, splitDev, splitProd];

  describe("(ruleId, environment) matching", () => {
    it("matches a rule with explicit environments when env is in the list", () => {
      expect(
        resolveRampTarget({ ruleId: "r_merged", environment: "dev" }, rules),
      ).toBe(mergedRule);
      expect(
        resolveRampTarget({ ruleId: "r_merged", environment: "prod" }, rules),
      ).toBe(mergedRule);
    });

    it("does NOT match a rule when env is not in its environments list", () => {
      expect(
        resolveRampTarget({ ruleId: "r_devOnly", environment: "prod" }, rules),
      ).toBeUndefined();
    });

    it("matches an allEnvironments rule regardless of target env", () => {
      expect(
        resolveRampTarget({ ruleId: "r_all", environment: "staging" }, rules),
      ).toBe(allEnvRule);
    });

    it("matches any rule with the id when target.environment is absent", () => {
      expect(resolveRampTarget({ ruleId: "r_devOnly" }, rules)).toBe(
        devOnlyRule,
      );
    });

    it("returns undefined when ruleId doesn't match anything", () => {
      expect(
        resolveRampTarget({ ruleId: "r_gone", environment: "dev" }, rules),
      ).toBeUndefined();
    });
  });

  describe("stem matching (migration-renamed rules)", () => {
    it("resolves a legacy ruleId to the env-suffixed rule when env matches", () => {
      // Ramp targets legacy stem `r_split` + dev → should find splitDev.
      expect(
        resolveRampTarget({ ruleId: "r_split", environment: "dev" }, rules),
      ).toBe(splitDev);
      expect(
        resolveRampTarget({ ruleId: "r_split", environment: "prod" }, rules),
      ).toBe(splitProd);
    });

    it("resolves a legacy ruleId without env via stem fan-out (singular wrapper returns first match)", () => {
      // Bare id + no env is the legacy-fan-out quadrant. The plural resolver
      // returns BOTH splits; the singular wrapper returns the first. See
      // `resolveRampTargets` JSDoc for the rationale — the plural is what the
      // ramp poller iterates over to apply patches to every split sibling.
      const resolved = resolveRampTarget({ ruleId: "r_split" }, rules);
      expect([splitDev, splitProd]).toContain(resolved);
    });

    it("resolves when the ramp target ruleId itself already carries a suffix (defensive)", () => {
      // An older ramp authored after a manual rename might carry a suffixed
      // ruleId. Stem-matching on both sides recovers the intended rule.
      expect(
        resolveRampTarget(
          { ruleId: suffixRuleId("r_split", "dev"), environment: "dev" },
          rules,
        ),
      ).toBe(splitDev);
    });
  });

  describe("edge cases", () => {
    it("returns undefined when ruleId is not provided", () => {
      expect(resolveRampTarget({}, rules)).toBeUndefined();
      expect(resolveRampTarget({ ruleId: null }, rules)).toBeUndefined();
    });

    it("handles a rule with no environments field and allEnvironments=false (malformed) gracefully", () => {
      const malformed = {
        id: "r_bad",
        type: "force",
        description: "",
        enabled: true,
        value: "true",
        allEnvironments: false,
      } as unknown as FeatureRule;
      expect(
        resolveRampTarget({ ruleId: "r_bad", environment: "dev" }, [malformed]),
      ).toBeUndefined();
    });

    it("matches a malformed rule when target.environment is absent", () => {
      const malformed = {
        id: "r_bad",
        type: "force",
        description: "",
        enabled: true,
        value: "true",
        allEnvironments: false,
      } as unknown as FeatureRule;
      expect(resolveRampTarget({ ruleId: "r_bad" }, [malformed])).toBe(
        malformed,
      );
    });
  });
});

// ================= resolveRampTargets (plural) =================
//
// Four quadrants by (id form, env presence):
//   1. (bare id,     env supplied) — exact match on stem or stem__env,
//                                    filtered by env active on rule.
//   2. (suffixed id, env supplied) — same as (1) after stem-stripping.
//   3. (bare id,     no env)       — legacy-fan-out: every rule with matching
//                                    stem (covers pre-migration ramps that
//                                    later got split into env siblings).
//   4. (suffixed id, no env)       — exact id match (caller disambiguated).

describe("resolveRampTargets (plural)", () => {
  const devSibling: FeatureRule = {
    id: suffixRuleId("r_split", "dev"),
    type: "force",
    description: "",
    enabled: true,
    value: "dev-value",
    allEnvironments: false,
    environments: ["dev"],
  } as unknown as FeatureRule;

  const prodSibling: FeatureRule = {
    id: suffixRuleId("r_split", "prod"),
    type: "force",
    description: "",
    enabled: true,
    value: "prod-value",
    allEnvironments: false,
    environments: ["prod"],
  } as unknown as FeatureRule;

  const bareAllEnvs: FeatureRule = {
    id: "r_keep",
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: true,
  } as unknown as FeatureRule;

  const bareDev: FeatureRule = {
    id: "r_dev_only",
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: false,
    environments: ["dev"],
  } as unknown as FeatureRule;

  const rules = [devSibling, prodSibling, bareAllEnvs, bareDev];

  describe("quadrant 1 — (bare id, env supplied)", () => {
    it("returns the env-active sibling for a split rule", () => {
      expect(
        resolveRampTargets({ ruleId: "r_split", environment: "dev" }, rules),
      ).toEqual([devSibling]);
      expect(
        resolveRampTargets({ ruleId: "r_split", environment: "prod" }, rules),
      ).toEqual([prodSibling]);
    });

    it("returns [] for an env that matches neither sibling", () => {
      expect(
        resolveRampTargets(
          { ruleId: "r_split", environment: "staging" },
          rules,
        ),
      ).toEqual([]);
    });

    it("filters by env-active-ness for an unsplit rule", () => {
      expect(
        resolveRampTargets({ ruleId: "r_dev_only", environment: "dev" }, rules),
      ).toEqual([bareDev]);
      expect(
        resolveRampTargets(
          { ruleId: "r_dev_only", environment: "prod" },
          rules,
        ),
      ).toEqual([]);
    });

    it("matches allEnvironments rules regardless of env", () => {
      expect(
        resolveRampTargets(
          { ruleId: "r_keep", environment: "anything" },
          rules,
        ),
      ).toEqual([bareAllEnvs]);
    });
  });

  describe("quadrant 2 — (suffixed id, env supplied)", () => {
    it("stems and then behaves like quadrant 1", () => {
      expect(
        resolveRampTargets(
          { ruleId: suffixRuleId("r_split", "prod"), environment: "prod" },
          rules,
        ),
      ).toEqual([prodSibling]);
    });
  });

  describe("quadrant 3 — (bare id, no env) — legacy fan-out", () => {
    it("fans out to every stem-matching sibling for a split rule", () => {
      const result = resolveRampTargets({ ruleId: "r_split" }, rules);
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([devSibling, prodSibling]));
    });

    it("returns the single matching rule for an unsplit id", () => {
      expect(resolveRampTargets({ ruleId: "r_dev_only" }, rules)).toEqual([
        bareDev,
      ]);
    });
  });

  describe("quadrant 4 — (suffixed id, no env)", () => {
    it("exact-matches the disambiguated id only", () => {
      expect(
        resolveRampTargets({ ruleId: suffixRuleId("r_split", "dev") }, rules),
      ).toEqual([devSibling]);
    });
  });

  describe("edge cases", () => {
    it("returns [] when ruleId is absent", () => {
      expect(resolveRampTargets({}, rules)).toEqual([]);
      expect(resolveRampTargets({ ruleId: null }, rules)).toEqual([]);
    });

    it("returns [] when nothing matches", () => {
      expect(
        resolveRampTargets({ ruleId: "r_missing", environment: "dev" }, rules),
      ).toEqual([]);
    });
  });
});

// ================= rampTargetsEquivalent =================
//
// Used by findByTargetRule's in-memory re-filter and by conflict detection.
// Two targets are equivalent iff they share a stem AND their effective envs
// match (explicit env || suffix-derived env || wildcard).

describe("rampTargetsEquivalent", () => {
  it("same bare id + same env ⇒ true", () => {
    expect(
      rampTargetsEquivalent(
        { ruleId: "r_foo", environment: "dev" },
        { ruleId: "r_foo", environment: "dev" },
      ),
    ).toBe(true);
  });

  it("same stem via suffix vs explicit env ⇒ true", () => {
    // Stored (pre-migration, bare id + env) vs query (post-migration, suffixed id, no env).
    expect(
      rampTargetsEquivalent(
        { ruleId: "r_foo", environment: "prod" },
        { ruleId: suffixRuleId("r_foo", "prod"), environment: null },
      ),
    ).toBe(true);
  });

  it("same stem, one side wildcard env ⇒ true", () => {
    expect(
      rampTargetsEquivalent(
        { ruleId: "r_foo", environment: null },
        { ruleId: suffixRuleId("r_foo", "dev"), environment: "dev" },
      ),
    ).toBe(true);
  });

  it("same stem, different explicit envs ⇒ false", () => {
    expect(
      rampTargetsEquivalent(
        { ruleId: "r_foo", environment: "dev" },
        { ruleId: "r_foo", environment: "prod" },
      ),
    ).toBe(false);
  });

  it("same stem, suffix-derived envs differ ⇒ false", () => {
    expect(
      rampTargetsEquivalent(
        { ruleId: suffixRuleId("r_foo", "dev") },
        { ruleId: suffixRuleId("r_foo", "prod") },
      ),
    ).toBe(false);
  });

  it("different stems ⇒ false", () => {
    expect(
      rampTargetsEquivalent(
        { ruleId: "r_foo", environment: "dev" },
        { ruleId: "r_bar", environment: "dev" },
      ),
    ).toBe(false);
  });

  it("missing ruleId on either side ⇒ false", () => {
    expect(
      rampTargetsEquivalent(
        { ruleId: undefined, environment: "dev" },
        { ruleId: "r_foo", environment: "dev" },
      ),
    ).toBe(false);
  });
});
