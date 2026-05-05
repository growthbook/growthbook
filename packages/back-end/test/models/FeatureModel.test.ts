import { FeatureRule } from "shared/validators";
import { FeatureInterface, LegacyFeatureInterface } from "shared/types/feature";
import { Environment } from "shared/types/organization";
import { suffixRuleId } from "shared/util";
import {
  FeatureModel,
  migrateRawFeatureToV2,
  buildFeatureUpdate,
  toInterface,
} from "back-end/src/models/FeatureModel";
import { ReqContext } from "back-end/types/request";

// ---------------------------------------------------------------------------
// migrateRawFeatureToV2 is the pure-function core of FeatureModel.toInterface.
// It accepts a raw document (already stripped of Mongoose metadata) and a
// minimal ReqContext, and emits a v2 FeatureInterface via JIT migration.
//
// Integration test matrix:
//   1. v0 (no environmentSettings)                — flattens via upgradeV0Feature
//   2. v1 (envSettings[env].rules present)        — flattens via flattenV1ToV2Rules
//   3. v2 (envSettings has no rules key)          — pass-through (no corruption)
//   4. v1 with v0 crust                           — v1 wins, v0 top-level rules ignored
//   5. v2 with empty envSettings                  — classified as v2 (no rules key)
//   6. partial migration (v1 env rules + v2-shaped top-level rules)
//                                                 — v2 top-level wins; stale env.rules
//                                                   ignored (regression: hotfix #5783)
//   7. sparse/nullish rule slots                  — null/undefined entries tolerated
//                                                   in v1 env arrays and v2 top-level
//                                                   array (regression: publish crash
//                                                   with "Cannot read properties of
//                                                   undefined (reading 'type')")
//
// The critical invariant: v2 documents MUST NOT be re-flattened. Calling the
// function twice on the same v2 input must produce identical output (same
// ids, same order, same content). This protects against the class of bugs
// where the v0 upgrader was silently re-distributing v2 top-level rules into
// envSettings, causing id churn on every read.
// ---------------------------------------------------------------------------

const FEATURE_ID = "feat_test";

const ORG_ENVS: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

function mockContext(envs: Environment[] = ORG_ENVS): ReqContext {
  return {
    org: { settings: { environments: envs } },
  } as unknown as ReqContext;
}

// A minimal but valid v2 FeatureRule with allEnvironments. Content fields
// are arbitrary — what matters is the unification scope metadata.
function v2Rule(id: string, opts: Partial<FeatureRule> = {}): FeatureRule {
  return {
    id,
    type: "force",
    description: "",
    value: "true",
    enabled: true,
    allEnvironments: true,
    ...opts,
  } as unknown as FeatureRule;
}

// A minimal v1 legacy rule (no allEnvironments/environments).
function v1Rule(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    type: "force",
    description: "",
    value: "true",
    enabled: true,
    ...overrides,
  };
}

// Common feature metadata used across all cases.
const BASE_META = {
  id: FEATURE_ID,
  organization: "org_test",
  owner: "tester",
  dateCreated: new Date("2024-01-01"),
  dateUpdated: new Date("2024-01-01"),
  valueType: "boolean" as const,
  defaultValue: "true",
  version: 1,
  tags: [],
};

describe("migrateRawFeatureToV2", () => {
  // ================= 1. v0 (no environmentSettings) =================

  describe("v0 documents (no environmentSettings)", () => {
    it("redistributes top-level rules into env settings, then flattens to v2", () => {
      const v0: LegacyFeatureInterface = {
        ...BASE_META,
        environments: ["dev", "production"],
        rules: [v1Rule("r1") as FeatureRule],
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v0, mockContext());
      // Same rule in both envs after v0 upgrade → merges to allEnvironments=true.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    it("handles v0 with no rules and no environments as a zero-rule feature", () => {
      const v0: LegacyFeatureInterface = {
        ...BASE_META,
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v0, mockContext());
      expect(out.rules).toEqual([]);
    });
  });

  // ================= 2. v1 (envSettings[env].rules present) =================

  describe("v1 documents (envSettings[env].rules)", () => {
    it("flattens identical rules across envs to a single allEnvironments=true v2 rule with bare id", () => {
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [v1Rule("r1") as FeatureRule] },
          production: {
            enabled: true,
            rules: [v1Rule("r1") as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    it("splits env-divergent rules into per-env suffixed ids", () => {
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [v1Rule("r1", { value: "A" }) as FeatureRule],
          },
          production: {
            enabled: true,
            rules: [v1Rule("r1", { value: "B" }) as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules).toHaveLength(2);
      const devRule = out.rules.find((r) => r.environments?.[0] === "dev");
      const prodRule = out.rules.find(
        (r) => r.environments?.[0] === "production",
      );
      expect(devRule?.id).toBe(suffixRuleId("r1", "dev"));
      expect(prodRule?.id).toBe(suffixRuleId("r1", "production"));
    });

    it("emits empty rules array when envSettings has rules key but no rules", () => {
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules).toEqual([]);
    });
  });

  // Env-less org: `getEnvironments` backfills to dev/production so
  // `flattenV1ToV2Rules`'s `applicableEnvs` isn't empty. The end-to-end
  // emit-side regression is locked down in
  // `test/services/getApiFeatureObj.test.ts`.
  describe("v0 doc + empty org envs (legacy getEnvironments backfill)", () => {
    // Real prod feature: pre-revisions v0 with an inline `type: "experiment"`
    // rule. Pre-fix, `out.rules` was [].
    function failingV0Feature(): LegacyFeatureInterface {
      return {
        ...BASE_META,
        defaultValue: "false",
        rules: [
          {
            id: "fr_real",
            type: "experiment",
            description: "",
            trackingKey: "",
            hashAttribute: "deviceId",
            values: [
              { weight: 0.9, value: "false" },
              { weight: 0.1, value: "true" },
            ],
            condition: '{"country": "US"}',
            enabled: true,
            coverage: 1,
            value: "false",
          } as unknown as FeatureRule,
        ],
      } as LegacyFeatureInterface;
    }

    it("preserves an inline experiment rule when org has empty envs array", () => {
      const out = migrateRawFeatureToV2(failingV0Feature(), mockContext([]));
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("fr_real");
      expect(out.rules[0].type).toBe("experiment");
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    it("preserves an inline experiment rule when org.settings is undefined", () => {
      const ctx = { org: {} } as unknown as ReqContext;
      const out = migrateRawFeatureToV2(failingV0Feature(), ctx);
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("fr_real");
      expect(out.rules[0].type).toBe("experiment");
    });
  });

  // ================= 3. v2 (envSettings has no rules key) =================

  describe("v2 documents (unified)", () => {
    it("passes through v2 top-level rules without rewriting ids", () => {
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [v2Rule("r1")],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    it("is idempotent: calling migrateRawFeatureToV2 twice produces identical output", () => {
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [
          v2Rule("r1", { allEnvironments: true }),
          v2Rule("r2", {
            allEnvironments: false,
            environments: ["dev"],
          } as Partial<FeatureRule>),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const first = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      const second = migrateRawFeatureToV2(
        first as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(second.rules.map((r) => r.id)).toEqual(
        first.rules.map((r) => r.id),
      );
      expect(second.rules.map((r) => r.allEnvironments)).toEqual(
        first.rules.map((r) => r.allEnvironments),
      );
    });

    it("preserves migration-suffixed rule ids on v2 pass-through", () => {
      // Simulates a v2 doc that was previously flattened from a v1 collision:
      // the on-disk rule carries a `__<env>` suffix. The v2 read path must
      // NOT rename it (that would churn references).
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [
          v2Rule(suffixRuleId("r1", "dev"), {
            allEnvironments: false,
            environments: ["dev"],
          } as Partial<FeatureRule>),
          v2Rule(suffixRuleId("r1", "production"), {
            allEnvironments: false,
            environments: ["production"],
          } as Partial<FeatureRule>),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules.map((r) => r.id).sort()).toEqual([
        suffixRuleId("r1", "dev"),
        suffixRuleId("r1", "production"),
      ]);
    });
  });

  // ================= 3b. v1/v2 parity =================
  //
  // A v1 doc (envSettings[env].rules) and a hand-crafted v2 doc expressing the
  // same logical rules must flatten to structurally identical FeatureInterface
  // output. Guards against drift in rule id shape or ordering between the
  // freshly-written v2 on-disk shape and legacy on-disk docs that still hit
  // the JIT flatten path on read.

  describe("v1/v2 on-disk parity", () => {
    it("produces the same rules array for logically-equivalent v1 and v2 inputs", () => {
      // Three rules covering the unification shape matrix:
      //   - r_all: fires in every env (v1: same content in both envs; v2: allEnvironments=true)
      //   - r_dev: dev-only
      //   - r_prod: prod-only
      const allContent = {
        type: "force" as const,
        value: "ALL",
        enabled: true,
        description: "",
      };
      const devContent = {
        type: "force" as const,
        value: "DEV",
        enabled: true,
        description: "",
      };
      const prodContent = {
        type: "force" as const,
        value: "PROD",
        enabled: true,
        description: "",
      };

      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              { id: "r_all", ...allContent },
              { id: "r_dev", ...devContent },
            ] as FeatureRule[],
          },
          production: {
            enabled: true,
            rules: [
              { id: "r_all", ...allContent },
              { id: "r_prod", ...prodContent },
            ] as FeatureRule[],
          },
        },
      } as LegacyFeatureInterface;

      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [
          { id: "r_all", ...allContent, allEnvironments: true },
          {
            id: "r_dev",
            ...devContent,
            allEnvironments: false,
            environments: ["dev"],
          },
          {
            id: "r_prod",
            ...prodContent,
            allEnvironments: false,
            environments: ["production"],
          },
        ] as unknown as FeatureRule[],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const fromV1 = migrateRawFeatureToV2(v1, mockContext());
      const fromV2 = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );

      // Sort by id so we don't assert on the incidental per-env iteration
      // order that the v1 flattener happens to produce today.
      const byId = (a: FeatureRule, b: FeatureRule) => a.id.localeCompare(b.id);
      expect([...fromV1.rules].sort(byId)).toEqual(
        [...fromV2.rules].sort(byId),
      );
    });
  });

  // ================= 4. v1 with v0 crust =================

  describe("v1 with v0 crust (partial v0->v1 migration)", () => {
    it("ignores top-level v0 rules, uses v1 env settings as authoritative", () => {
      const v1WithCrust: LegacyFeatureInterface = {
        ...BASE_META,
        environments: ["dev"],
        rules: [v1Rule("r_stale", { value: "STALE" }) as FeatureRule],
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [v1Rule("r_real", { value: "REAL" }) as FeatureRule],
          },
          production: {
            enabled: true,
            rules: [v1Rule("r_real", { value: "REAL" }) as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1WithCrust, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r_real");
      expect(out.rules.find((r) => r.id === "r_stale")).toBeUndefined();
    });
  });

  // ================= 4c. enabled backfill from v0 environments array =================
  //
  // Hybrid v0/v1 docs (v0 `environments: [...]` array + sparse v1
  // `environmentSettings`) used to silently flip `enabled: false` on envs
  // listed in the v0 array but missing from envSettings, breaking per-env
  // toggling on read.

  describe("enabled backfill (hybrid v0/v1 docs, sparse envSettings)", () => {
    it("backfills enabled=true for production listed in v0 array but missing from envSettings", () => {
      const hybrid = {
        ...BASE_META,
        environments: ["dev", "production"],
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          // production omitted on purpose — listed in `environments` only.
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(hybrid, mockContext());
      expect(out.environmentSettings.production?.enabled).toBe(true);
      expect(out.environmentSettings.dev?.enabled).toBe(true);
    });

    it("backfills enabled=false for dev when v0 array lists production only", () => {
      const hybrid = {
        ...BASE_META,
        environments: ["production"],
        environmentSettings: {},
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(hybrid, mockContext());
      expect(out.environmentSettings.production?.enabled).toBe(true);
      expect(out.environmentSettings.dev?.enabled).toBe(false);
    });

    it("preserves an explicit envSettings.enabled=false even when v0 array lists the env", () => {
      const hybrid = {
        ...BASE_META,
        environments: ["dev", "production"],
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: false, rules: [] },
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(hybrid, mockContext());
      expect(out.environmentSettings.production?.enabled).toBe(false);
      expect(out.environmentSettings.dev?.enabled).toBe(true);
    });

    it("does not materialize dev/production entries when there is no v0 array and no top-level rules", () => {
      const pureV1 = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [] },
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(pureV1, mockContext());
      expect(out.environmentSettings.dev?.enabled).toBe(true);
      expect(out.environmentSettings.production).toBeUndefined();
    });
  });

  // ================= 4d. hash-based id synthesis for legacy rules =================
  //
  // Legacy rules without an id (older exports, hand-edited configs) used to
  // fall through `flattenV1ToV2Rules`'s `!rule.id` skip and silently
  // disappear. We synthesize a stable content-hash id (`fr_h_<hex>`) before
  // flattening so the rule survives.

  describe("hash-based id synthesis (legacy rules without an id)", () => {
    it("synthesizes a deterministic id for a rule with id: ''", () => {
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              v1Rule("", { value: "X", description: "force X" }) as FeatureRule,
            ],
          },
          production: { enabled: true, rules: [] },
        },
      } as LegacyFeatureInterface;

      const a = migrateRawFeatureToV2(v1, mockContext());
      const b = migrateRawFeatureToV2(v1, mockContext());

      expect(a.rules).toHaveLength(1);
      expect(a.rules[0].id).toMatch(/^fr_h_[a-f0-9]{16}$/);
      expect(b.rules[0].id).toBe(a.rules[0].id);
    });

    it("generates the same id for byte-identical content across envs (so they merge)", () => {
      const sameContent = { value: "X", description: "shared" };
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [v1Rule("", sameContent) as FeatureRule],
          },
          production: {
            enabled: true,
            rules: [v1Rule("", sameContent) as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toMatch(/^fr_h_[a-f0-9]{16}$/);
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    it("generates different ids for content-divergent rules across envs (so they split)", () => {
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [v1Rule("", { value: "A" }) as FeatureRule],
          },
          production: {
            enabled: true,
            rules: [v1Rule("", { value: "B" }) as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules).toHaveLength(2);
      const ids = out.rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(2);
      ids.forEach((id) => expect(id).toMatch(/^fr_h_[a-f0-9]{16}/));
    });

    it("suffixes within-env duplicates whose synthesized ids collide", () => {
      // Identical rules in the same env hash to the same id and fall through
      // to flatten's `dupInEnvIds` env+occurrence suffix path.
      const dup = v1Rule("", { value: "X" }) as FeatureRule;
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [dup, dup] },
          production: { enabled: true, rules: [] },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules).toHaveLength(2);
      const ids = out.rules.map((r) => r.id);
      ids.forEach((id) => expect(id).toContain("__dev"));
      expect(new Set(ids).size).toBe(2);
    });
  });

  // ================= 4a. version backfill from legacy embedded revision =================
  //
  // Sparse legacy v1 docs store `version` only on the embedded
  // `revision: { version }` sub-doc. Pre-unification reads flowed through
  // `upgradeFeatureInterface`'s `feature.version || revision?.version || 1`
  // fallback; the v1/v2 branch here must mirror it or these docs read as
  // version 1.

  describe("version backfill (v1 doc with legacy embedded revision)", () => {
    it("lifts revision.version onto feature.version when top-level is missing", () => {
      const legacy = {
        ...BASE_META,
        version: undefined,
        revision: { version: 7, comment: "", date: new Date() },
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(legacy, mockContext());
      expect(out.version).toBe(7);
    });

    it("lifts revision.version when top-level is 0 (falsy)", () => {
      const legacy = {
        ...BASE_META,
        version: 0,
        revision: { version: 12, comment: "", date: new Date() },
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(legacy, mockContext());
      expect(out.version).toBe(12);
    });

    it("preserves a non-falsy top-level version over revision.version", () => {
      const legacy = {
        ...BASE_META,
        version: 9,
        revision: { version: 2, comment: "", date: new Date() },
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(legacy, mockContext());
      expect(out.version).toBe(9);
    });

    it("falls back to 1 only when both top-level and revision.version are missing", () => {
      const legacy = {
        ...BASE_META,
        version: undefined,
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(legacy, mockContext());
      expect(out.version).toBe(1);
    });

    it("strips the legacy `revision` sub-doc from the output (FeatureInterface has no such field)", () => {
      const legacy = {
        ...BASE_META,
        version: 5,
        revision: { version: 5, comment: "old", date: new Date() },
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(legacy, mockContext());
      expect("revision" in (out as object)).toBe(false);
    });
  });

  // ================= 4b. env.rules scrub on output =================
  //
  // `migrateRawFeatureToV2` must never expose the legacy
  // `environmentSettings[env].rules` key on its output (v1 or v2 path).
  // Downstream consumers read exclusively from the top-level `feature.rules`
  // array; leaving the legacy key populated would silently disagree with it.

  describe("environmentSettings[env].rules scrub", () => {
    it("strips the legacy rules key from env objects on the v1 flatten path", () => {
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [v1Rule("r1") as FeatureRule] },
          production: {
            enabled: true,
            rules: [v1Rule("r1") as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules).toHaveLength(1); // sanity: data still flows to feature.rules
      for (const envId of Object.keys(out.environmentSettings ?? {})) {
        expect(out.environmentSettings?.[envId]).toBeDefined();
        expect("rules" in (out.environmentSettings?.[envId] as object)).toBe(
          false,
        );
      }
    });

    it("belt-and-suspenders strips the rules key on the v2 path even when a pathological doc landed one", () => {
      // Simulates a direct-mongo mutation or a bypass write that stamped
      // env.rules on an otherwise-v2 document. Routing follows
      // `topLevelRulesAreV2Shaped` (true here), so we go v2; the v2 path's
      // own scrub strips the legacy key from the output.
      const hybrid = {
        ...BASE_META,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [],
            prerequisites: [],
          },
          production: {
            enabled: true,
            rules: [],
            prerequisites: [],
          },
        },
        rules: [v2Rule("r1")],
        prerequisites: [],
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(hybrid, mockContext());
      for (const envId of Object.keys(out.environmentSettings ?? {})) {
        expect("rules" in (out.environmentSettings?.[envId] as object)).toBe(
          false,
        );
      }
    });

    it("trusts top-level v2 rules over stale env.rules (regression: hotfix #5783)", () => {
      // Customer-reported scenario: a buggy pre-hotfix publish wrote a fresh
      // v2 rules array but failed to scrub the legacy
      // `environmentSettings.{env}.rules` from the same doc. Before this fix
      // the routing required `hasNoV1EnvRules(envSettings)` AND v2-shape, so
      // those docs took the v1 path on every read and rebuilt rules from the
      // stale env arrays — silently shadowing the authoritative v2 write.
      // SDK payload diffs (`getSDKPayloadKeysByDiff`) therefore saw no rule
      // change and the CDN cache went stale. With the new routing, top-level
      // v2 rules win.
      const stale = {
        ...BASE_META,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [v1Rule("stale-rule-from-pre-publish") as FeatureRule],
            prerequisites: [],
          },
          dev: {
            enabled: true,
            rules: [v1Rule("another-stale-rule") as FeatureRule],
            prerequisites: [],
          },
        },
        rules: [v2Rule("post-publish-canonical-rule")],
        prerequisites: [],
      } as unknown as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(stale, mockContext());

      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("post-publish-canonical-rule");
      expect(
        out.rules.some((r) => r.id === "stale-rule-from-pre-publish"),
      ).toBe(false);
      expect(out.rules.some((r) => r.id === "another-stale-rule")).toBe(false);
      // And the legacy env.rules key never leaks into the in-memory output.
      for (const envId of Object.keys(out.environmentSettings ?? {})) {
        expect("rules" in (out.environmentSettings?.[envId] as object)).toBe(
          false,
        );
      }
    });
  });

  // ================= 5. v2 with empty envSettings =================

  describe("v2 with empty env settings", () => {
    it("classifies envSettings without rules key as v2 even when empty", () => {
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: false, prerequisites: [] },
        },
        rules: [],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules).toEqual([]);
      expect(Object.keys(out.environmentSettings)).toEqual(
        expect.arrayContaining(["dev", "production"]),
      );
    });

    it("classifies a v2 doc with NO envSettings keys (but the field present) as v2", () => {
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {},
        rules: [v2Rule("r1", { allEnvironments: true })],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
    });
  });

  // ================= 6. Partial migration (v1 + v2-shaped top-level) =================

  describe("partial migration: v1 env rules + populated top-level rules", () => {
    it("trusts v2-shaped top-level rules over stale env.rules (regression: hotfix #5783)", () => {
      // Pre-hotfix this returned `r_from_env` because routing required
      // `hasNoV1EnvRules(envSettings)` AND v2-shape: any populated env.rules
      // sent us to the v1 path and the legacy env arrays silently shadowed
      // the authoritative top-level v2 write. The fix removes the env.rules
      // gate from routing, so v2-shaped top-level rules always win.
      const v1PartialMigration: LegacyFeatureInterface = {
        ...BASE_META,
        rules: [
          {
            id: "r_from_top_level",
            type: "force",
            value: "OLD",
            description: "",
            allEnvironments: true,
          },
        ] as unknown as FeatureRule[],
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [v1Rule("r_from_env") as FeatureRule],
          },
          production: {
            enabled: true,
            rules: [v1Rule("r_from_env") as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1PartialMigration, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r_from_top_level");
      expect(out.rules.find((r) => r.id === "r_from_env")).toBeUndefined();
    });
  });

  // ================= Env inheritance =================

  describe("env inheritance", () => {
    // Sparse legacy docs whose child env relies on parent inheritance must
    // still surface that rule in the child after unification.
    it("v1 path: propagates rules across inherited envs -> allEnvironments=true", () => {
      const envsWithParent: Environment[] = [
        { id: "dev", description: "" },
        { id: "staging", description: "", parent: "dev" },
        { id: "production", description: "" },
      ];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [v1Rule("r1") as FeatureRule] },
          production: {
            enabled: true,
            rules: [v1Rule("r1") as FeatureRule],
          },
          // staging is sparse → inherits dev.
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(envsWithParent));
      // r1 covers all 3 applicable envs → collapses to allEnvironments=true.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    // Legacy v1 docs may omit child envs that inherit from a parent. The v1
    // path runs `applyEnvironmentInheritance` before flattening so those rules
    // surface in the inheriting child too — matching pre-unification behavior.
    it("v1 path: propagates rules across inherited envs -> allEnvironments=false", () => {
      const envsWithParent: Environment[] = [
        { id: "dev", description: "" },
        { id: "staging", description: "", parent: "dev" },
        { id: "production", description: "" },
      ];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [v1Rule("r1") as FeatureRule] },
          production: {
            enabled: true,
            rules: [],
          },
          // staging has no entry → inherits dev's rules.
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(envsWithParent));
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(false);
      expect(out.rules[0].environments).toEqual(["dev", "staging"]);
    });

    // Legacy v1 docs may omit child envs that inherit from a parent. The v1
    // path runs `applyEnvironmentInheritance` before flattening so those rules
    // surface in the inheriting child too — matching pre-unification behavior.
    it("v1 path: ignores inheritance when environmentSettings already has the env", () => {
      const envsWithParent: Environment[] = [
        { id: "dev", description: "" },
        { id: "staging", description: "", parent: "dev" },
        { id: "production", description: "" },
      ];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [v1Rule("r1") as FeatureRule] },
          production: {
            enabled: true,
            rules: [],
          },
          staging: { enabled: true, rules: [] },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(envsWithParent));
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(false);
      expect(out.rules[0].environments).toEqual(["dev"]);
    });

    it("v1 path: still inherits non-rule envSettings fields (enabled) across parent chain", () => {
      const envsWithParent: Environment[] = [
        { id: "dev", description: "" },
        { id: "staging", description: "", parent: "dev" },
      ];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [] },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(envsWithParent));
      expect(out.environmentSettings.staging).toBeDefined();
      expect(out.environmentSettings.staging.enabled).toBe(true);
    });

    it("v2 path: updates environments array for missing envs with inheritance", () => {
      const envsWithParent: Environment[] = [
        { id: "dev", description: "" },
        { id: "staging", description: "", parent: "dev" },
        { id: "production", description: "" },
      ];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["dev"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
      } as unknown as FeatureInterface;
      const out = migrateRawFeatureToV2(v2, mockContext(envsWithParent));

      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(false);
      expect(out.rules[0].environments).toEqual(["dev", "staging"]);
    });

    it("v2 path: ignores inheritance when environmentSettings already has the env", () => {
      const envsWithParent: Environment[] = [
        { id: "dev", description: "" },
        { id: "staging", description: "", parent: "dev" },
        { id: "production", description: "" },
      ];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["dev"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
          staging: { enabled: true },
        },
      } as unknown as FeatureInterface;
      const out = migrateRawFeatureToV2(v2, mockContext(envsWithParent));

      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(false);
      expect(out.rules[0].environments).toEqual(["dev"]);
    });

    // The following cycle tests pin the cycle-detection guards in
    // `applyEnvironmentInheritance` and `buildInheritedChildrenByAncestor`.
    // Without those guards, a cyclic parent chain would loop forever on read.
    // Behavior on cycle: stop walking (as if no parent was set) — silent
    // no-op rather than throw.

    it("v2 path: 2-cycle parent chain (a<->b) with sparse envSettings is silently ignored", () => {
      const envsCycle: Environment[] = [
        { id: "a", description: "", parent: "b" },
        { id: "b", description: "", parent: "a" },
        { id: "production", description: "" },
      ];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["production"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          production: { enabled: true },
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(v2, mockContext(envsCycle));
      // No expansion into cyclic envs; rule footprint stays as-is.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].environments).toEqual(["production"]);
    });

    it("v2 path: self-loop parent (a.parent=a) is silently ignored", () => {
      const envsSelfLoop: Environment[] = [
        { id: "a", description: "", parent: "a" },
        { id: "production", description: "" },
      ];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["production"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          production: { enabled: true },
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(v2, mockContext(envsSelfLoop));
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].environments).toEqual(["production"]);
    });

    it("v2 path: cycle with one defined env in the chain still inherits from the defined env", () => {
      // a -> b -> c -> a, but `c` has envSettings. Walks from `a` and `b`
      // both reach `c` before re-entering the cycle and inherit from it.
      const envsMixed: Environment[] = [
        { id: "a", description: "", parent: "b" },
        { id: "b", description: "", parent: "c" },
        { id: "c", description: "", parent: "a" },
      ];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["c"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          c: { enabled: true },
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(v2, mockContext(envsMixed));
      // r1 expanded into a and b via c (the only defined env in the cycle).
      // The v2 path expands `environments` but does not re-collapse to
      // allEnvironments=true.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(new Set(out.rules[0].environments)).toEqual(
        new Set(["a", "b", "c"]),
      );
    });

    it("v2 path: non-existent parent id silently no-ops", () => {
      const envsBadParent: Environment[] = [
        { id: "production", description: "" },
        { id: "staging", description: "", parent: "deleted-env-id" },
      ];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["production"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          production: { enabled: true },
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(v2, mockContext(envsBadParent));
      // staging's parent doesn't exist → no inheritance, rule stays scoped
      // to production only.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].environments).toEqual(["production"]);
    });

    it("v1 path: 2-cycle parent chain does not hang and does not synthesize rules", () => {
      const envsCycle: Environment[] = [
        { id: "a", description: "", parent: "b" },
        { id: "b", description: "", parent: "a" },
        { id: "production", description: "" },
      ];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [v1Rule("r1") as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(envsCycle));
      // Rule scoped to production only — cyclic envs gain nothing.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].environments).toEqual(["production"]);
    });
  });

  // ================= Non-rule upgrades + envSettings preservation =================

  describe("non-rule upgrades on v2 documents", () => {
    it("backfills version=1 when version is missing on a v2 doc", () => {
      const { version: _v, ...noVersionMeta } = BASE_META;
      const v2 = {
        ...noVersionMeta,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [],
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.version).toBe(1);
    });

    it("backfills jsonSchema.schemaType and simple on a v2 doc", () => {
      const v2 = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [],
        jsonSchema: {
          schema: "{}",
          date: new Date("2024-01-01"),
          enabled: true,
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.jsonSchema?.schemaType).toBe("schema");
      expect(out.jsonSchema?.simple).toEqual({ type: "object", fields: [] });
    });

    it("preserves environmentSettings[env].prerequisites through v2 read", () => {
      const prereq = {
        id: "feat_parent",
        condition: `{"value": true}`,
      };
      const v2 = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [prereq] },
          production: { enabled: false, prerequisites: [] },
        },
        rules: [],
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.environmentSettings.dev.prerequisites).toEqual([prereq]);
      expect(out.environmentSettings.dev.enabled).toBe(true);
      expect(out.environmentSettings.production.enabled).toBe(false);
    });
  });

  // ================= applicableEnvs (project scoping) =================

  describe("project-scoped environments", () => {
    it("treats a rule that spans all project-applicable envs as allEnvironments=true", () => {
      const envs: Environment[] = [
        { id: "dev", description: "" },
        { id: "production", description: "" },
        { id: "enterprise", description: "", projects: ["proj_other"] },
      ];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        project: "proj_main",
        environmentSettings: {
          dev: { enabled: true, rules: [v1Rule("r1") as FeatureRule] },
          production: {
            enabled: true,
            rules: [v1Rule("r1") as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(envs));
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].allEnvironments).toBe(true);
    });
  });

  // ================= Removed/orphaned envs =================
  //
  // Both paths preserve rules whose only env(s) are non-applicable: the v1
  // path collapses to no-env "pending" via `shapeRule`; the v2 path leaves
  // the on-disk rule untouched (no `narrowRuleToApplicableEnvs` filter at
  // `migrateRawFeatureToV2` — the revision-read path narrows instead).
  // Either way no rule body is silently dropped on read.

  describe("removed/orphaned envs in feature data", () => {
    it("v1 path: preserves rule scoped only to a removed env with the orphan env retained", () => {
      // Org has only `production`. The on-disk doc still has a `staging`
      // entry from before staging was removed. The v1→v2 flatten preserves
      // the rule body AND the orphan env label so the UI can flag it
      // (`RuleEnvScopeBadges` renders disallowed envs as struck-through
      // amber pills) and a later publish doesn't drop it silently.
      const orgEnvs: Environment[] = [{ id: "production", description: "" }];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          production: { enabled: true, rules: [] },
          staging: {
            enabled: true,
            rules: [v1Rule("r_staging_only") as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(orgEnvs));
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r_staging_only");
      expect(out.rules[0].allEnvironments).toBe(false);
      expect(out.rules[0].environments).toEqual(["staging"]);
    });

    it("v2 path: preserves rule scoped to a removed env as-is (no narrow at migrateRawFeatureToV2)", () => {
      // The v2 read path does NOT filter rules by applicableEnvs at this
      // layer; orphan-env references survive on the live feature unchanged
      // so the UI can flag them. (The revision read path narrows in its v2
      // branch — pre-existing inconsistency, tracked separately.)
      const orgEnvs: Environment[] = [{ id: "production", description: "" }];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r_active", { allEnvironments: true }) as FeatureRule,
          v2Rule("r_orphan", {
            allEnvironments: false,
            environments: ["staging"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          production: { enabled: true },
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(v2, mockContext(orgEnvs));
      expect(out.rules).toHaveLength(2);
      expect(out.rules.map((r) => r.id).sort()).toEqual([
        "r_active",
        "r_orphan",
      ]);
      const orphan = out.rules.find((r) => r.id === "r_orphan");
      expect(orphan?.environments).toEqual(["staging"]);
    });

    it("v2 path: preserves orphan entries in mixed-env rule footprint", () => {
      // `migrateRawFeatureToV2` does not narrow v2 rule footprints to
      // applicableEnvs. The rule's env list is left intact even if some
      // entries no longer exist in the org, so the UI can render the
      // orphan portion as a struck-through amber pill.
      const orgEnvs: Environment[] = [{ id: "production", description: "" }];
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r_mixed", {
            allEnvironments: false,
            environments: ["staging", "production"],
          }) as FeatureRule,
        ],
        environmentSettings: {
          production: { enabled: true },
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(v2, mockContext(orgEnvs));
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].allEnvironments).toBe(false);
      expect(out.rules[0].environments).toEqual(["staging", "production"]);
    });

    it("v1 path: tolerates sparse null/undefined entries inside per-env rule arrays", () => {
      // Regression: `rules` is stored as Mongoose `Mixed`, and pre-v2 docs
      // can land with `null`/`undefined` slots (partial imports, sparse
      // arrays). A single nullish entry used to crash the entire JIT
      // migration with "Cannot read properties of undefined (reading
      // 'type')", blocking publish on long-lived legacy features.
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              v1Rule("r_a") as FeatureRule,
              null as unknown as FeatureRule,
              undefined as unknown as FeatureRule,
              v1Rule("r_b") as FeatureRule,
            ],
          },
          production: {
            enabled: true,
            rules: [v1Rule("r_a") as FeatureRule, v1Rule("r_b") as FeatureRule],
          },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext());
      expect(out.rules.map((r) => r.id).sort()).toEqual(["r_a", "r_b"]);
      out.rules.forEach((r) => {
        expect(r.allEnvironments).toBe(true);
        expect(typeof r.type).toBe("string");
      });
    });

    it("v2 path: tolerates sparse null/undefined entries inside the top-level rules array", () => {
      // Same nullish-tolerance for v2-shaped docs that landed with corrupt
      // slots on disk. Previously crashed `upgradeFeatureRule(undefined)`.
      const v2: FeatureInterface = {
        ...BASE_META,
        rules: [
          v2Rule("r_a") as FeatureRule,
          null as unknown as FeatureRule,
          v2Rule("r_b") as FeatureRule,
          undefined as unknown as FeatureRule,
        ],
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
      } as unknown as FeatureInterface;

      const out = migrateRawFeatureToV2(v2, mockContext());
      expect(out.rules.map((r) => r.id).sort()).toEqual(["r_a", "r_b"]);
      out.rules.forEach((r) => {
        expect(r.allEnvironments).toBe(true);
        expect(typeof r.type).toBe("string");
      });
    });

    it("v1 path: stale envSettings for a removed env is not pruned (no env-deletion cascade — revisit)", () => {
      // No active cascade on env deletion: stale envSettings entries linger
      // on disk indefinitely (PR review Risk #5). Reads remain correct
      // because applicableEnvs filters rules, but disk grows without bound,
      // and re-adding the same env id later resurrects the stale data.
      const orgEnvs: Environment[] = [{ id: "production", description: "" }];
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          production: { enabled: true, rules: [] },
          staging: { enabled: false, rules: [] },
        },
      } as LegacyFeatureInterface;

      const out = migrateRawFeatureToV2(v1, mockContext(orgEnvs));
      expect(out.rules).toHaveLength(0);
      // Production survives.
      expect(out.environmentSettings.production).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// buildFeatureUpdate: write chokepoint. Pure transform that scrubs v1-shape
// `rules` keys from environmentSettings entries so writes never accidentally
// re-introduce v1-shape data that would re-trigger the flatten path on the
// next read.
// ---------------------------------------------------------------------------

describe("buildFeatureUpdate", () => {
  it("is a no-op when update has no environmentSettings", () => {
    const update = { defaultValue: "true", version: 2 };
    expect(buildFeatureUpdate(update)).toEqual(update);
  });

  it("removes rules key from every env object in environmentSettings", () => {
    const out = buildFeatureUpdate({
      environmentSettings: {
        dev: { enabled: true, rules: [{ id: "r1" }] },
        production: { enabled: false, rules: [], prerequisites: [] },
      },
    });
    expect(out.environmentSettings).toEqual({
      dev: { enabled: true },
      production: { enabled: false, prerequisites: [] },
    });
  });

  it("leaves env objects that have no rules key untouched", () => {
    const input = {
      environmentSettings: {
        dev: { enabled: true, prerequisites: [{ id: "p", condition: "{}" }] },
      },
    };
    const out = buildFeatureUpdate(input);
    expect(out.environmentSettings).toEqual(input.environmentSettings);
  });

  it("does not mutate the caller's input", () => {
    const input = {
      environmentSettings: {
        dev: { enabled: true, rules: [{ id: "r1" }] },
      },
    };
    buildFeatureUpdate(input);
    expect(input.environmentSettings.dev.rules).toEqual([{ id: "r1" }]);
  });

  it("preserves non-envSettings fields on the update payload", () => {
    const out = buildFeatureUpdate({
      defaultValue: "false",
      version: 3,
      environmentSettings: {
        dev: { enabled: true, rules: [] },
      },
    });
    expect(out.defaultValue).toBe("false");
    expect(out.version).toBe(3);
    expect(out.environmentSettings?.dev).toEqual({ enabled: true });
  });

  it("clears stale `environments` from a top-level rule with allEnvironments: true", () => {
    const out = buildFeatureUpdate({
      rules: [
        {
          id: "r1",
          type: "force",
          description: "",
          allEnvironments: true,
          environments: ["dev", "prod"],
        },
        {
          id: "r2",
          type: "force",
          description: "",
          allEnvironments: false,
          environments: ["dev"],
        },
      ],
    } as Record<string, unknown>);

    const rules = (out as { rules: Array<Record<string, unknown>> }).rules;
    expect(rules[0]).toEqual({
      id: "r1",
      type: "force",
      description: "",
      allEnvironments: true,
    });
    expect(rules[0]).not.toHaveProperty("environments");
    expect(rules[1].environments).toEqual(["dev"]);
  });

  it("leaves allEnvironments: false rules untouched", () => {
    const input = {
      rules: [
        {
          id: "r1",
          type: "force",
          description: "",
          allEnvironments: false,
          environments: ["prod"],
        },
      ],
    } as Record<string, unknown>;
    const out = buildFeatureUpdate(input);
    expect((out as { rules: unknown }).rules).toBe(input.rules);
  });
});

// ---------------------------------------------------------------------------
// toInterface round-trip integration tests. Verify that a document
// constructed via `new FeatureModel({...})` (as Mongoose hydrates on read)
// round-trips to the same v2 `FeatureInterface` as calling
// `migrateRawFeatureToV2` directly on the raw payload.
// ---------------------------------------------------------------------------

describe("toInterface round-trip", () => {
  const runRoundTrip = (raw: Record<string, unknown>) => {
    const direct = migrateRawFeatureToV2(
      raw as unknown as LegacyFeatureInterface,
      mockContext(),
    );
    const doc = new FeatureModel(raw);
    const viaDoc = toInterface(doc, mockContext());
    return { direct, viaDoc };
  };

  it("v1 hydrated via Mongoose flattens to the same v2 shape as migrateRawFeatureToV2", () => {
    const raw = {
      ...BASE_META,
      environmentSettings: {
        dev: { enabled: true, rules: [v1Rule("r1") as FeatureRule] },
        production: {
          enabled: true,
          rules: [v1Rule("r1") as FeatureRule],
        },
      },
    };
    const { direct, viaDoc } = runRoundTrip(raw);

    expect(viaDoc.rules).toHaveLength(direct.rules.length);
    expect(viaDoc.rules.map((r) => r.id)).toEqual(
      direct.rules.map((r) => r.id),
    );
    expect(viaDoc.rules[0].allEnvironments).toBe(true);

    expect(viaDoc.id).toBe(FEATURE_ID);
    expect(viaDoc.defaultValue).toBe(direct.defaultValue);
    expect(viaDoc.valueType).toBe(direct.valueType);

    expect((viaDoc as unknown as { _id?: unknown })._id).toBeUndefined();
    expect((viaDoc as unknown as { __v?: unknown }).__v).toBeUndefined();
  });

  it("v2 hydrated via Mongoose passes through without rewriting ids", () => {
    const raw = {
      ...BASE_META,
      environmentSettings: {
        dev: { enabled: true, prerequisites: [] },
        production: { enabled: true, prerequisites: [] },
      },
      rules: [v2Rule("r1")],
    };
    const { direct, viaDoc } = runRoundTrip(raw);

    expect(viaDoc.rules).toHaveLength(1);
    expect(viaDoc.rules[0].id).toBe("r1");
    expect(viaDoc.rules[0].id).toBe(direct.rules[0].id);
    expect(viaDoc.rules[0].allEnvironments).toBe(true);
  });

  it("v0 hydrated via Mongoose flattens through the full pipeline to v2", () => {
    const raw = {
      ...BASE_META,
      environments: ["dev", "production"],
      rules: [v1Rule("r1") as FeatureRule],
    };
    delete (raw as Record<string, unknown>).environmentSettings;

    const { direct, viaDoc } = runRoundTrip(raw);

    expect(viaDoc.rules).toHaveLength(1);
    expect(viaDoc.rules[0].id).toBe("r1");
    expect(viaDoc.rules[0].allEnvironments).toBe(true);
    expect(viaDoc.rules[0].id).toBe(direct.rules[0].id);
  });

  it("idempotent: writing a v2 doc's toInterface result back in yields the same output", () => {
    // Simulates a read -> (no-op transform) -> hydrate-as-v2 -> read loop.
    // Ids and ordering must be stable across the round-trip.
    const raw = {
      ...BASE_META,
      environmentSettings: {
        dev: { enabled: true, prerequisites: [] },
        production: { enabled: true, prerequisites: [] },
      },
      rules: [
        v2Rule("r1", { allEnvironments: true }),
        v2Rule("r2", {
          allEnvironments: false,
          environments: ["dev"],
        } as Partial<FeatureRule>),
      ],
    };

    const first = toInterface(new FeatureModel(raw), mockContext());
    const second = toInterface(
      new FeatureModel(first as unknown as Record<string, unknown>),
      mockContext(),
    );

    expect(second.rules.map((r) => r.id)).toEqual(first.rules.map((r) => r.id));
    expect(second.rules.map((r) => r.allEnvironments)).toEqual(
      first.rules.map((r) => r.allEnvironments),
    );
  });

  it("strips Mongoose-injected _id and __v from the application-visible result", () => {
    const raw = {
      ...BASE_META,
      environmentSettings: {
        dev: { enabled: true, rules: [] },
        production: { enabled: true, rules: [] },
      },
    };
    const doc = new FeatureModel(raw);
    const rawJson = doc.toJSON<Record<string, unknown>>();
    expect(rawJson._id).toBeDefined();

    const result = toInterface(doc, mockContext());
    expect((result as unknown as { _id?: unknown })._id).toBeUndefined();
    expect((result as unknown as { __v?: unknown }).__v).toBeUndefined();
  });
});
