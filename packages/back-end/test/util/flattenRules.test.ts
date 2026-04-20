import { FeatureRule } from "shared/validators";
import { Environment } from "shared/types/organization";
import {
  flattenV1ToV2Rules,
  getApplicableEnvIds,
  isV2FeatureEnvSettings,
  isV2RevisionRules,
  V1FeatureRule,
  V1RulesByEnv,
  resolveRampTarget,
} from "../../src/util/flattenRules";
import { stemRuleId, suffixRuleId } from "shared/util";

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

    it("drops occurrences in envs NOT in applicableEnvs (orphan project-reassignment data)", () => {
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
      expect(out[0].allEnvironments).toBe(true);
      expect(out[0]).not.toHaveProperty("environments");
    });

    it("env-specific rule in a non-applicable env is dropped entirely", () => {
      const out = flattenV1ToV2Rules(
        { legacyReadOnly: [forceRule("orphan")] },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toEqual([]);
    });

    it("partial-merge rule whose applicable subset is fully covered still collapses to allEnvironments=true", () => {
      const r = forceRule("r1");
      const out = flattenV1ToV2Rules(
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

    it("order-conflicting rules do not collapse — each split piece stays env-specific with suffixed id", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const out = flattenV1ToV2Rules(
        { dev: [A, B], prod: [B, A] },
        { applicableEnvs: ["dev", "prod"] },
      );
      expect(out).toHaveLength(4);
      out.forEach((r) => {
        expect(r.allEnvironments).toBe(false);
        expect(r.environments).toHaveLength(1);
      });
      // Every output id stem-strips back to the legacy id.
      const stems = out.map((r) => stemRuleId(r.id)).sort();
      expect(stems).toEqual(["A", "A", "B", "B"]);
    });

    it("empty applicableEnvs (feature has no applicable envs) yields empty output", () => {
      const out = flattenV1ToV2Rules(
        { dev: [forceRule("r1")] },
        { applicableEnvs: [] },
      );
      expect(out).toEqual([]);
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

    it("splits both rules on order conflict (suffixed ids)", () => {
      const r1 = forceRule("r1");
      const r2 = forceRule("r2");
      const out = flattenV1ToV2Rules({
        dev: [r1, r2],
        prod: [r2, r1],
      });
      expect(out).toHaveLength(4);
      const perEnv = new Map<string, string[]>();
      for (const r of out) {
        const env = r.environments![0];
        perEnv.set(env, [...(perEnv.get(env) ?? []), stemRuleId(r.id)]);
      }
      expect(perEnv.get("dev")).toEqual(["r1", "r2"]);
      expect(perEnv.get("prod")).toEqual(["r2", "r1"]);
      out.forEach((r) => expect(r.environments).toHaveLength(1));
      // Every split piece's id is suffixed with its env.
      out.forEach((r) => {
        expect(r.id).toBe(suffixRuleId(stemRuleId(r.id), r.environments![0]));
      });
    });

    it("only splits the conflicting pair — unrelated mergeable rules still merge and keep bare id", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const C = forceRule("C");
      const out = flattenV1ToV2Rules({
        dev: [A, B, C],
        prod: [A, C, B],
      });
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      // A merges (stable order) and keeps bare id.
      expect(byStem("A")).toHaveLength(1);
      expect(byStem("A")[0].id).toBe("A");
      expect(byStem("A")[0].environments).toEqual(["dev", "prod"]);
      // B and C split, suffixed.
      expect(byStem("B")).toHaveLength(2);
      expect(byStem("C")).toHaveLength(2);
    });

    it("preserves within-env order for split rules", () => {
      const A = forceRule("A");
      const B = forceRule("B");
      const out = flattenV1ToV2Rules({
        dev: [A, B],
        prod: [B, A],
      });
      const devSeq = out
        .filter((r) => r.environments?.[0] === "dev")
        .map((r) => stemRuleId(r.id));
      const prodSeq = out
        .filter((r) => r.environments?.[0] === "prod")
        .map((r) => stemRuleId(r.id));
      expect(devSeq).toEqual(["A", "B"]);
      expect(prodSeq).toEqual(["B", "A"]);
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

    it("transitive-safe: if X and Y conflict in order, unrelated Z with content match to X still merges", () => {
      const X = forceRule("X");
      const Y = forceRule("Y");
      const Z = forceRule("Z");
      const out = flattenV1ToV2Rules({
        dev: [X, Y, Z],
        prod: [Y, X, Z],
      });
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      expect(byStem("X")).toHaveLength(2);
      expect(byStem("Y")).toHaveLength(2);
      expect(byStem("Z")).toHaveLength(1);
      expect(byStem("Z")[0].id).toBe("Z");
      expect(byStem("Z")[0].environments).toEqual(["dev", "prod"]);
    });

    it("order conflict where conflicting pair only overlaps in a subset of envs", () => {
      const X = forceRule("X");
      const Y = forceRule("Y");
      const out = flattenV1ToV2Rules({
        dev: [X, Y],
        staging: [X],
        prod: [Y, X],
      });
      const byStem = (stem: string) =>
        out.filter((r) => stemRuleId(r.id) === stem);
      expect(byStem("X")).toHaveLength(3);
      expect(byStem("Y")).toHaveLength(2);
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

// ================= isV2FeatureEnvSettings =================

describe("isV2FeatureEnvSettings", () => {
  it("returns true for undefined env settings", () => {
    expect(isV2FeatureEnvSettings(undefined)).toBe(true);
  });

  it("returns true for empty env settings map", () => {
    expect(isV2FeatureEnvSettings({})).toBe(true);
  });

  it("returns true when no env has a rules key", () => {
    expect(
      isV2FeatureEnvSettings({
        dev: { enabled: true },
        prod: { enabled: false },
      }),
    ).toBe(true);
  });

  it("returns false when at least one env has a rules key, even if empty", () => {
    expect(
      isV2FeatureEnvSettings({
        dev: { enabled: true, rules: [] },
        prod: { enabled: false },
      }),
    ).toBe(false);
  });

  it("returns false when every env has a rules key (typical legacy doc)", () => {
    expect(
      isV2FeatureEnvSettings({
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

    it("resolves a legacy ruleId without env to the first matching suffixed rule", () => {
      // When the ramp has no env preference, either split is an acceptable
      // match. We return the first found.
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
