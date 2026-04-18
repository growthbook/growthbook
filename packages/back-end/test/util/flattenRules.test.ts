import { FeatureRule } from "shared/validators";
import { Environment } from "shared/types/organization";
import {
  flattenRules,
  generateRuleUid,
  getApplicableEnvIds,
  isUnifiedFeatureEnvSettings,
  isUnifiedRevisionRules,
  LegacyFeatureRule,
  LegacyRulesByEnv,
  resolveRampTarget,
} from "../../src/util/flattenRules";

// ---------- helpers ----------

// Build a minimal ForceRule. The only fields that matter for flattenRules'
// logic are `id` (for grouping) and the other content fields (for equality).
// The discriminated union is loose here via cast because we don't care about
// the full zod shape in tests — we just exercise the flatten algorithm.
function forceRule(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): LegacyFeatureRule {
  return {
    id,
    type: "force",
    description: "",
    value: "true",
    enabled: true,
    ...overrides,
  } as unknown as LegacyFeatureRule;
}

function rolloutRule(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): LegacyFeatureRule {
  return {
    id,
    type: "rollout",
    description: "",
    value: "true",
    enabled: true,
    coverage: 0.5,
    hashAttribute: "id",
    ...overrides,
  } as unknown as LegacyFeatureRule;
}

const FEATURE_ID = "feat_abc";

// Extract just the bits we care about comparing in output assertions.
type Slim = {
  id: string;
  uid: string;
  allEnvironments: boolean;
  environments: string[] | undefined;
};
function slim(rules: FeatureRule[]): Slim[] {
  return rules.map((r) => ({
    id: r.id,
    uid: r.uid,
    allEnvironments: r.allEnvironments,
    environments: r.environments,
  }));
}

describe("flattenRules", () => {
  // ================= baseline / empty =================

  describe("baseline", () => {
    it("returns [] for empty input", () => {
      expect(flattenRules(FEATURE_ID, {})).toEqual([]);
    });

    it("returns [] when every env has an empty array", () => {
      expect(flattenRules(FEATURE_ID, { dev: [], prod: [] })).toEqual([]);
    });

    it("skips rules missing an id field (malformed legacy data)", () => {
      const input = {
        dev: [
          { type: "force", value: "true" } as unknown as LegacyFeatureRule,
          forceRule("r1"),
        ],
      };
      const out = flattenRules(FEATURE_ID, input);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("r1");
    });
  });

  // ================= single env =================

  describe("single env", () => {
    it("emits a single rule as env-specific", () => {
      const out = flattenRules(FEATURE_ID, { dev: [forceRule("r1")] });
      expect(slim(out)).toEqual([
        {
          id: "r1",
          uid: generateRuleUid(FEATURE_ID, "r1", "dev"),
          allEnvironments: false,
          environments: ["dev"],
        },
      ]);
    });

    it("preserves order of multiple rules in the same env", () => {
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1"), forceRule("r2"), forceRule("r3")],
      });
      expect(out.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
      out.forEach((r) => expect(r.environments).toEqual(["dev"]));
    });
  });

  // ================= multi-env: full merge =================

  describe("content-identical across all envs", () => {
    it("merges into a single rule with all envs", () => {
      const r = forceRule("r1");
      const out = flattenRules(FEATURE_ID, {
        dev: [{ ...r }],
        prod: [{ ...r }],
      });
      expect(out).toHaveLength(1);
      expect(slim(out)[0]).toEqual({
        id: "r1",
        uid: generateRuleUid(FEATURE_ID, "r1", "*"),
        allEnvironments: false,
        environments: ["dev", "prod"],
      });
    });

    it("merges across 3 envs", () => {
      const r = forceRule("r1");
      const out = flattenRules(FEATURE_ID, {
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
      const out = flattenRules(FEATURE_ID, {
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
      const out = flattenRules(
        FEATURE_ID,
        { dev: [{ ...r }], prod: [{ ...r }] },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(true);
      expect(out[0]).not.toHaveProperty("environments");
    });

    it("emits explicit env list when rule misses at least one applicable env", () => {
      // Feature applies to dev, prod, staging — rule only in dev+prod.
      const r = forceRule("r1");
      const out = flattenRules(
        FEATURE_ID,
        { dev: [{ ...r }], prod: [{ ...r }] },
        { applicableEnvs: ["dev", "prod", "staging"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(false);
      expect(out[0].environments).toEqual(["dev", "prod"]);
    });

    it("single-env rule in a single-applicable-env feature collapses to allEnvironments=true", () => {
      // E.g. a feature in a project whose only applicable env is "prod".
      const out = flattenRules(
        FEATURE_ID,
        { prod: [forceRule("r1")] },
        { applicableEnvs: ["prod"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(true);
      expect(out[0]).not.toHaveProperty("environments");
    });

    it("drops occurrences in envs NOT in applicableEnvs (orphan project-reassignment data)", () => {
      // Rule exists in dev, prod, and a leftover "legacy" env that no longer
      // applies to the feature. Applicable envs are dev+prod only. Output
      // should be allEnvironments=true and reference neither the legacy env
      // nor explicitly list dev/prod.
      const r = forceRule("r1");
      const out = flattenRules(
        FEATURE_ID,
        {
          dev: [{ ...r }],
          prod: [{ ...r }],
          legacyReadOnly: [{ ...r }],
        },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(1);
      expect(out[0].allEnvironments).toBe(true);
      expect(out[0]).not.toHaveProperty("environments");
    });

    it("env-specific rule in a non-applicable env is dropped entirely", () => {
      // Only appears in a leftover env; not applicable → should not produce
      // output. This avoids emitting unified rules that reference envs that
      // no longer apply to the feature.
      const out = flattenRules(
        FEATURE_ID,
        { legacyReadOnly: [forceRule("orphan")] },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toEqual([]);
    });

    it("partial-merge rule whose applicable subset is fully covered still collapses to allEnvironments=true", () => {
      // Rule is in dev+prod+legacy; applicable is dev+prod. Legacy occurrence
      // is ignored for coverage — rule still covers every applicable env.
      const r = forceRule("r1");
      const out = flattenRules(
        FEATURE_ID,
        {
          dev: [{ ...r }],
          prod: [{ ...r }],
          legacyReadOnly: [{ ...r }],
        },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out[0].allEnvironments).toBe(true);
    });

    it("content-diverged rules do not collapse to allEnvironments=true even if they span applicable set", () => {
      // Different `value` per env ⇒ split ⇒ each piece is env-specific.
      const out = flattenRules(
        FEATURE_ID,
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
    });

    it("order-conflicting rules do not collapse — each split piece stays env-specific", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const out = flattenRules(
        FEATURE_ID,
        { dev: [A, B], prod: [B, A] },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(4);
      out.forEach((r) => {
        expect(r.allEnvironments).toBe(false);
        expect(r.environments).toHaveLength(1);
      });
    });

    it("empty applicableEnvs (feature has no applicable envs) yields empty output", () => {
      // Degenerate but defensible: feature's project is not on any env.
      const out = flattenRules(
        FEATURE_ID,
        { dev: [forceRule("r1")] },
        { applicableEnvs: [] },
      );
      expect(out).toEqual([]);
    });
  });

  // ================= partial envs =================

  describe("rule in a subset of envs", () => {
    it("merges with environments = only the envs it appears in", () => {
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1")],
        staging: [forceRule("r1")],
        prod: [],
      });
      expect(out).toHaveLength(1);
      expect(out[0].environments).toEqual(["dev", "staging"]);
    });

    it("emits env-specific for a rule that appears in only one env", () => {
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("onlyDev")],
        prod: [forceRule("onlyProd")],
      });
      expect(out.map((r) => r.id).sort()).toEqual(["onlyDev", "onlyProd"]);
      const dev = out.find((r) => r.id === "onlyDev")!;
      const prod = out.find((r) => r.id === "onlyProd")!;
      expect(dev.environments).toEqual(["dev"]);
      expect(prod.environments).toEqual(["prod"]);
      expect(dev.uid).toBe(generateRuleUid(FEATURE_ID, "onlyDev", "dev"));
      expect(prod.uid).toBe(generateRuleUid(FEATURE_ID, "onlyProd", "prod"));
    });
  });

  // ================= content divergence =================

  describe("same id but diverging content", () => {
    it("splits into env-specific rules when `value` differs", () => {
      const out = flattenRules(FEATURE_ID, {
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
      expect(devRule.uid).toBe(generateRuleUid(FEATURE_ID, "r1", "dev"));
      expect(prodRule.uid).toBe(generateRuleUid(FEATURE_ID, "r1", "prod"));
    });

    it("splits when `enabled` differs", () => {
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1", { enabled: true })],
        prod: [forceRule("r1", { enabled: false })],
      });
      expect(out).toHaveLength(2);
    });

    it("splits when `condition` differs", () => {
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1", { condition: '{"env":"dev"}' })],
        prod: [forceRule("r1", { condition: '{"env":"prod"}' })],
      });
      expect(out).toHaveLength(2);
    });

    it("splits when scheduleRules differ", () => {
      const sched = [{ timestamp: "2024-01-01T00:00:00Z", enabled: true }];
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1", { scheduleRules: sched })],
        prod: [forceRule("r1", { scheduleRules: [] })],
      });
      expect(out).toHaveLength(2);
    });

    it("considers content-equivalent if only uid/allEnvironments/environments differ (hygiene)", () => {
      // In practice these fields won't be on legacy input, but if callers pass
      // partially-upgraded rules they should not cause spurious splits.
      const a = {
        ...forceRule("r1"),
        uid: "should-be-ignored-A",
        environments: ["dev"],
      } as unknown as LegacyFeatureRule;
      const b = {
        ...forceRule("r1"),
        uid: "should-be-ignored-B",
        environments: ["prod"],
      } as unknown as LegacyFeatureRule;
      const out = flattenRules(FEATURE_ID, { dev: [a], prod: [b] });
      expect(out).toHaveLength(1);
    });
  });

  // ================= order =================

  describe("rule ordering across envs", () => {
    it("merges both rules when order is consistent in all shared envs", () => {
      const r1 = forceRule("r1");
      const r2 = forceRule("r2");
      const out = flattenRules(FEATURE_ID, {
        dev: [r1, r2],
        prod: [r1, r2],
      });
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.id)).toEqual(["r1", "r2"]);
      out.forEach((r) => expect(r.environments).toEqual(["dev", "prod"]));
    });

    it("splits both rules on order conflict", () => {
      const r1 = forceRule("r1");
      const r2 = forceRule("r2");
      const out = flattenRules(FEATURE_ID, {
        dev: [r1, r2],
        prod: [r2, r1],
      });
      expect(out).toHaveLength(4);
      const perEnv = new Map<string, string[]>();
      for (const r of out) {
        const env = r.environments![0];
        perEnv.set(env, [...(perEnv.get(env) ?? []), r.id]);
      }
      expect(perEnv.get("dev")).toEqual(["r1", "r2"]);
      expect(perEnv.get("prod")).toEqual(["r2", "r1"]);
      out.forEach((r) => expect(r.environments).toHaveLength(1));
    });

    it("only splits the conflicting pair — unrelated mergeable rules still merge", () => {
      // A,B,C in dev; A,C,B in prod → B/C conflict, A merges.
      const A = forceRule("A");
      const B = forceRule("B");
      const C = forceRule("C");
      const out = flattenRules(FEATURE_ID, {
        dev: [A, B, C],
        prod: [A, C, B],
      });
      const byId = (id: string) => out.filter((r) => r.id === id);
      expect(byId("A")).toHaveLength(1);
      expect(byId("A")[0].environments).toEqual(["dev", "prod"]);
      expect(byId("B")).toHaveLength(2);
      expect(byId("C")).toHaveLength(2);
    });

    it("preserves within-env order for split rules", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const out = flattenRules(FEATURE_ID, {
        dev: [A, B],
        prod: [B, A],
      });
      // Emission strategy walks envs in canonical order. Dev first.
      const devSeq = out
        .filter((r) => r.environments?.[0] === "dev")
        .map((r) => r.id);
      const prodSeq = out
        .filter((r) => r.environments?.[0] === "prod")
        .map((r) => r.id);
      expect(devSeq).toEqual(["A", "B"]);
      expect(prodSeq).toEqual(["B", "A"]);
    });
  });

  // ================= emission order =================

  describe("deterministic output order", () => {
    it("walks envs in canonical (alphabetical) order by default", () => {
      const r1 = forceRule("r1");
      const out = flattenRules(FEATURE_ID, {
        prod: [r1],
        dev: [r1],
        staging: [r1],
      });
      expect(out[0].environments).toEqual(["dev", "prod", "staging"]);
    });

    it("honors opts.envOrder when provided", () => {
      const r = forceRule("r1");
      const out = flattenRules(
        FEATURE_ID,
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
      const out = flattenRules(
        FEATURE_ID,
        { prod: [r], dev: [r], zzzCustom: [r] },
        { envOrder: ["prod", "dev"] },
      );
      expect(out[0].environments).toEqual(["prod", "dev", "zzzCustom"]);
    });

    it("merged rule is emitted once, anchored at the first env in canonical order", () => {
      // rule X in dev,prod; rule Y only in prod. Expected order: X then Y.
      const X = forceRule("X");
      const Y = forceRule("Y");
      const out = flattenRules(FEATURE_ID, {
        dev: [X],
        prod: [X, Y],
      });
      expect(out.map((r) => r.id)).toEqual(["X", "Y"]);
    });
  });

  // ================= determinism =================

  describe("determinism", () => {
    it("produces identical output (including uids) on repeated calls", () => {
      const input: LegacyRulesByEnv = {
        dev: [forceRule("a"), forceRule("b"), rolloutRule("c")],
        prod: [forceRule("a"), forceRule("b")],
      };
      const out1 = flattenRules(FEATURE_ID, input);
      const out2 = flattenRules(FEATURE_ID, input);
      expect(out1).toEqual(out2);
    });

    it("uid differs between merged and env-specific variants of the same legacy id", () => {
      const r = forceRule("r1");
      const merged = flattenRules(FEATURE_ID, {
        dev: [r],
        prod: [r],
      });
      const split = flattenRules(FEATURE_ID, {
        dev: [{ ...r, value: "x" }],
        prod: [{ ...r, value: "y" }],
      });
      expect(merged[0].uid).not.toBe(split[0].uid);
      expect(split[0].uid).not.toBe(split[1].uid);
    });

    it("uid changes when featureId changes", () => {
      expect(generateRuleUid("f1", "r1", "*")).not.toBe(
        generateRuleUid("f2", "r1", "*"),
      );
    });

    it("uid format is ruid_ + 16 hex chars", () => {
      const uid = generateRuleUid("f1", "r1", "*");
      expect(uid).toMatch(/^ruid_[0-9a-f]{16}$/);
    });
  });

  // ================= realistic combos =================

  describe("realistic scenarios", () => {
    it("handles a mix of merged, partial-env, and env-specific rules", () => {
      // - "shared" is identical in dev+prod → merged
      // - "devTweak" is different between dev and prod → split
      // - "prodOnly" is only in prod → env-specific
      const shared = forceRule("shared");
      const out = flattenRules(FEATURE_ID, {
        dev: [{ ...shared }, forceRule("devTweak", { value: "dev" })],
        prod: [
          { ...shared },
          forceRule("devTweak", { value: "prod" }),
          forceRule("prodOnly"),
        ],
      });
      // Expected: [shared, devTweak@dev, devTweak@prod, prodOnly]
      // (dev walked first, so dev-specific pieces appear before prod-specific)
      expect(out).toHaveLength(4);
      expect(out.map((r) => r.id)).toEqual([
        "shared",
        "devTweak",
        "devTweak",
        "prodOnly",
      ]);
      expect(out[0].environments).toEqual(["dev", "prod"]);
      expect(out[1].environments).toEqual(["dev"]);
      expect(out[2].environments).toEqual(["prod"]);
      expect(out[3].environments).toEqual(["prod"]);
    });

    it("handles rollout rule with savedGroups preserved", () => {
      const r = rolloutRule("r1", {
        savedGroups: [{ match: "all", ids: ["g1"] }],
      });
      const out = flattenRules(FEATURE_ID, {
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
    it("different rule types with the same legacy id are treated as content-different (split)", () => {
      // Legacy data should never have this, but if an import tool did produce
      // it, we must not merge and lose information.
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1")],
        prod: [rolloutRule("r1")],
      });
      expect(out).toHaveLength(2);
    });

    it("3+ envs: rule merges across the two envs where it is identical, splits off the diverging env", () => {
      // "r1" is identical in dev+staging, different value in prod.
      // Current semantics: any content divergence in the group splits the WHOLE
      // group into env-specific copies. (Conservative.) This documents that.
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1", { value: "a" })],
        staging: [forceRule("r1", { value: "a" })],
        prod: [forceRule("r1", { value: "b" })],
      });
      expect(out).toHaveLength(3);
      out.forEach((r) => expect(r.environments).toHaveLength(1));
    });

    it("transitive-safe: if X and Y conflict in order, unrelated Z with content match to X still merges", () => {
      const X = forceRule("X");
      const Y = forceRule("Y");
      const Z = forceRule("Z");
      const out = flattenRules(FEATURE_ID, {
        dev: [X, Y, Z],
        prod: [Y, X, Z], // X,Y swapped; Z still at end in both
      });
      const byId = (id: string) => out.filter((r) => r.id === id);
      expect(byId("X")).toHaveLength(2); // split
      expect(byId("Y")).toHaveLength(2); // split
      expect(byId("Z")).toHaveLength(1); // merged
      expect(byId("Z")[0].environments).toEqual(["dev", "prod"]);
    });

    it("order conflict where conflicting pair only overlaps in a subset of envs", () => {
      // X in dev,staging,prod; Y in dev,prod. Order: X<Y in dev, Y<X in prod.
      // Only dev and prod overlap → conflict. Staging has only X so no issue.
      const X = forceRule("X");
      const Y = forceRule("Y");
      const out = flattenRules(FEATURE_ID, {
        dev: [X, Y],
        staging: [X],
        prod: [Y, X],
      });
      const byId = (id: string) => out.filter((r) => r.id === id);
      expect(byId("X")).toHaveLength(3); // one per env
      expect(byId("Y")).toHaveLength(2);
    });

    it("pair is consistent because they never share an env → still merges", () => {
      // X in dev only; Y in prod only. No shared env → no possible conflict.
      // X and Y are each env-specific by virtue of single-env occurrence.
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("X")],
        prod: [forceRule("Y")],
      });
      expect(out).toHaveLength(2);
      out.forEach((r) => expect(r.environments).toHaveLength(1));
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
      const out = flattenRules(FEATURE_ID, {
        dev: [{ ...rich }],
        prod: [{ ...rich }],
      });
      expect(out).toHaveLength(1);
      const r = out[0] as FeatureRule & Record<string, unknown>;
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
      // 10 envs × 50 rules, mostly identical. Sanity-check correctness + runtime.
      const envs = Array.from({ length: 10 }, (_, i) => `env${i}`);
      const rules = Array.from({ length: 50 }, (_, i) =>
        forceRule(`r${i}`, { value: `v${i % 5}` }),
      );
      const input: LegacyRulesByEnv = {};
      for (const env of envs) input[env] = rules.map((r) => ({ ...r }));
      const t0 = Date.now();
      const out = flattenRules(FEATURE_ID, input);
      const elapsed = Date.now() - t0;
      expect(out).toHaveLength(50);
      out.forEach((r) => expect(r.environments).toHaveLength(10));
      // Generous ceiling; this should easily be < 100ms in practice.
      expect(elapsed).toBeLessThan(500);
    });

    it("duplicate legacy id within the same env: emits each occurrence with a unique uid", () => {
      // Legacy data SHOULD never produce this, but if it does we shouldn't drop
      // the duplicate silently. Treat each position as its own occurrence with
      // its own disambiguated uid.
      const r1a = forceRule("dup", { value: "first" });
      const r1b = forceRule("dup", { value: "second" });
      const out = flattenRules(FEATURE_ID, {
        dev: [r1a, r1b],
      });
      expect(out).toHaveLength(2);
      expect(
        out.map((r) => (r as FeatureRule & { value: string }).value),
      ).toEqual(["first", "second"]);
      expect(out[0].uid).not.toBe(out[1].uid);
      // First occurrence uses the stable `env` suffix; subsequent use `env#N`.
      expect(out[0].uid).toBe(generateRuleUid(FEATURE_ID, "dup", "dev"));
      expect(out[1].uid).toBe(generateRuleUid(FEATURE_ID, "dup", "dev#2"));
    });

    it("3+ duplicates in same env get distinct, deterministic uids", () => {
      const out = flattenRules(FEATURE_ID, {
        dev: [
          forceRule("dup", { value: "1" }),
          forceRule("dup", { value: "2" }),
          forceRule("dup", { value: "3" }),
        ],
      });
      expect(out).toHaveLength(3);
      expect(new Set(out.map((r) => r.uid)).size).toBe(3);
      expect(out[0].uid).toBe(generateRuleUid(FEATURE_ID, "dup", "dev"));
      expect(out[1].uid).toBe(generateRuleUid(FEATURE_ID, "dup", "dev#2"));
      expect(out[2].uid).toBe(generateRuleUid(FEATURE_ID, "dup", "dev#3"));
    });

    it("duplicate id in one env + same id in another env: all emitted as env-specific with unique uids (no merge)", () => {
      // The in-env duplicate disqualifies the entire legacy id from merging.
      // Without that rule we'd otherwise try to merge "shared" across dev+prod.
      const base = forceRule("shared");
      const out = flattenRules(FEATURE_ID, {
        dev: [{ ...base }, { ...base }],
        prod: [{ ...base }],
      });
      expect(out).toHaveLength(3);
      expect(new Set(out.map((r) => r.uid)).size).toBe(3);
      const uids = out.map((r) => r.uid);
      expect(uids).toContain(generateRuleUid(FEATURE_ID, "shared", "dev"));
      expect(uids).toContain(generateRuleUid(FEATURE_ID, "shared", "dev#2"));
      expect(uids).toContain(generateRuleUid(FEATURE_ID, "shared", "prod"));
      // All three must be env-specific (no allEnvironments or multi-env arrays).
      out.forEach((r) => {
        expect(r.allEnvironments).toBe(false);
        expect(r.environments).toHaveLength(1);
      });
    });

    it("different rule types with same legacy id produce distinct, stable uids per env", () => {
      // Already covered by the "split on content divergence" test, but here
      // we assert the uids explicitly since the user flagged this case.
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1")],
        prod: [rolloutRule("r1")],
      });
      expect(out).toHaveLength(2);
      const uids = new Set(out.map((r) => r.uid));
      expect(uids.has(generateRuleUid(FEATURE_ID, "r1", "dev"))).toBe(true);
      expect(uids.has(generateRuleUid(FEATURE_ID, "r1", "prod"))).toBe(true);
    });
  });

  // ================= output shape invariants =================

  describe("output invariants", () => {
    it("without applicableEnvs, every output rule has uid, allEnvironments=false, and non-empty environments", () => {
      // Without applicableEnvs, the collapse-to-allEnvironments path is never
      // taken, so every rule emits with explicit `environments` and
      // `allEnvironments: false`.
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("a"), forceRule("b")],
        prod: [forceRule("a"), forceRule("c")],
      });
      for (const r of out) {
        expect(typeof r.uid).toBe("string");
        expect(r.uid.length).toBeGreaterThan(0);
        expect(r.allEnvironments).toBe(false);
        expect(Array.isArray(r.environments)).toBe(true);
        expect(r.environments!.length).toBeGreaterThan(0);
      }
    });

    it("all uids in the output are unique", () => {
      const out = flattenRules(FEATURE_ID, {
        dev: [forceRule("r1"), forceRule("r2"), forceRule("r3")],
        prod: [
          forceRule("r1"),
          forceRule("r2", { value: "different" }),
          forceRule("r3"),
        ],
      });
      const uids = out.map((r) => r.uid);
      expect(new Set(uids).size).toBe(uids.length);
    });
  });
});

// ================= isUnifiedRevisionRules =================

describe("isUnifiedRevisionRules", () => {
  it("returns true for empty array (zero-rule unified revision)", () => {
    expect(isUnifiedRevisionRules([])).toBe(true);
  });

  it("returns true for any array, even if rules lack uids", () => {
    // Legacy rules round-tripped through toLegacyRevision would carry uids.
    // Non-round-tripped rules would not. Both are "unified" at the structural
    // level — the discriminator is purely shape-based.
    expect(isUnifiedRevisionRules([{ id: "r1" }])).toBe(true);
    expect(isUnifiedRevisionRules([{ id: "r1", uid: "ruid_abc" }])).toBe(true);
  });

  it("returns false for a Record<env, rules> (legacy) shape", () => {
    expect(isUnifiedRevisionRules({ dev: [] })).toBe(false);
    expect(isUnifiedRevisionRules({ dev: [{ id: "r1" }] })).toBe(false);
  });

  it("returns false for null/undefined/non-array values", () => {
    expect(isUnifiedRevisionRules(null)).toBe(false);
    expect(isUnifiedRevisionRules(undefined)).toBe(false);
    expect(isUnifiedRevisionRules("unexpected")).toBe(false);
  });
});

// ================= isUnifiedFeatureEnvSettings =================

describe("isUnifiedFeatureEnvSettings", () => {
  it("returns true for undefined env settings", () => {
    expect(isUnifiedFeatureEnvSettings(undefined)).toBe(true);
  });

  it("returns true for empty env settings map", () => {
    expect(isUnifiedFeatureEnvSettings({})).toBe(true);
  });

  it("returns true when no env has a rules key", () => {
    expect(
      isUnifiedFeatureEnvSettings({
        dev: { enabled: true },
        prod: { enabled: false },
      }),
    ).toBe(true);
  });

  it("returns false when at least one env has a rules key, even if empty", () => {
    expect(
      isUnifiedFeatureEnvSettings({
        dev: { enabled: true, rules: [] },
        prod: { enabled: false },
      }),
    ).toBe(false);
  });

  it("returns false when every env has a rules key (typical legacy doc)", () => {
    expect(
      isUnifiedFeatureEnvSettings({
        dev: { enabled: true, rules: [{ id: "r1" }] },
        prod: { enabled: false, rules: [] },
      }),
    ).toBe(false);
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
    // Convention: an absent `projects` field and an empty `projects: []` both
    // mean "no project restriction". This matches the rest of the codebase.
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

// ================= resolveRampTarget =================

describe("resolveRampTarget", () => {
  const FID = "feat_x";
  const mergedRule: FeatureRule = {
    id: "r_merged",
    uid: generateRuleUid(FID, "r_merged", "*"),
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: false,
    environments: ["dev", "prod"],
  } as unknown as FeatureRule;

  const devOnlyRule: FeatureRule = {
    id: "r_devOnly",
    uid: generateRuleUid(FID, "r_devOnly", "dev"),
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: false,
    environments: ["dev"],
  } as unknown as FeatureRule;

  const allEnvRule: FeatureRule = {
    id: "r_all",
    uid: generateRuleUid(FID, "r_all", "*"),
    type: "force",
    description: "",
    enabled: true,
    value: "true",
    allEnvironments: true,
  } as unknown as FeatureRule;

  const rules = [mergedRule, devOnlyRule, allEnvRule];

  describe("uid-first path (new ramps)", () => {
    it("resolves by uid when present", () => {
      expect(resolveRampTarget({ ruleUid: mergedRule.uid }, rules)).toBe(
        mergedRule,
      );
    });

    it("returns undefined if uid doesn't match any rule and no fallback ruleId", () => {
      expect(
        resolveRampTarget({ ruleUid: "ruid_doesnotexist" }, rules),
      ).toBeUndefined();
    });

    it("falls back to ruleId when uid is unresolvable but ruleId matches", () => {
      // Ramp written by new code but the rule it references was split into
      // per-env copies by a later edit. Falling back by ruleId lets us still
      // resolve to ONE of the surviving rules (best effort).
      const result = resolveRampTarget(
        { ruleUid: "ruid_stale", ruleId: "r_devOnly", environment: "dev" },
        rules,
      );
      expect(result).toBe(devOnlyRule);
    });
  });

  describe("legacy (ruleId, environment) path", () => {
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
      // Multi-env ramps that don't target a specific env.
      expect(resolveRampTarget({ ruleId: "r_devOnly" }, rules)).toBe(
        devOnlyRule,
      );
    });

    it("returns undefined when the legacy ruleId doesn't match anything", () => {
      expect(
        resolveRampTarget({ ruleId: "r_gone", environment: "dev" }, rules),
      ).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("returns undefined when neither ruleUid nor ruleId is provided", () => {
      expect(resolveRampTarget({}, rules)).toBeUndefined();
      expect(
        resolveRampTarget({ ruleUid: null, ruleId: null }, rules),
      ).toBeUndefined();
    });

    it("treats ruleUid: null the same as missing (falls through to ruleId)", () => {
      expect(
        resolveRampTarget(
          { ruleUid: null, ruleId: "r_devOnly", environment: "dev" },
          rules,
        ),
      ).toBe(devOnlyRule);
    });

    it("handles a rule with no environments field and allEnvironments=false (malformed) gracefully", () => {
      // Defensive: shouldn't match by legacy (ruleId, env) path since the
      // rule has no env coverage.
      const malformed = {
        id: "r_bad",
        uid: "ruid_bad",
        type: "force",
        description: "",
        enabled: true,
        value: "true",
        allEnvironments: false,
      } as unknown as FeatureRule;
      expect(
        resolveRampTarget({ ruleId: "r_bad", environment: "dev" }, [malformed]),
      ).toBeUndefined();
      // But uid match should still work.
      expect(resolveRampTarget({ ruleUid: "ruid_bad" }, [malformed])).toBe(
        malformed,
      );
    });
  });
});
