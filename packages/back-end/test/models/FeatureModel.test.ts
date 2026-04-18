import { FeatureRule } from "shared/validators";
import {
  FeatureInterface,
  LegacyFeatureInterface,
} from "shared/types/feature";
import { Environment } from "shared/types/organization";
import { buildFeatureInterface } from "back-end/src/models/FeatureModel";
import { ReqContext } from "back-end/types/request";
import { generateRuleUid } from "back-end/src/util/flattenRules";

// ---------------------------------------------------------------------------
// buildFeatureInterface is the pure-function core of FeatureModel.toInterface.
// It accepts a raw document (already stripped of Mongoose metadata) and a
// minimal ReqContext, and emits a v2 FeatureInterface via JIT migration.
//
// Integration test matrix:
//   1. v0 (no environmentSettings)                — flattens via upgradeV0Feature
//   2. v1 (envSettings[env].rules present)        — flattens via flattenV1ToV2Rules
//   3. v2 (envSettings has no rules key)          — pass-through (no corruption)
//   4. v1 with v0 crust                           — v1 wins, v0 top-level rules ignored
//   5. v2 with empty envSettings                  — classified as v2 (no rules key)
//   6. partial migration (v1 env rules + v2-shaped top-level rules with uids)
//                                                 — v1 wins, top-level rules overwritten
//
// The critical invariant: v2 documents MUST NOT be re-flattened. Calling the
// function twice on the same v2 input must produce identical output (same
// uids, same order, same content). This protects against the class of bugs
// where the v0 upgrader was silently re-distributing v2 top-level rules into
// envSettings, causing uid regeneration on every read.
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

// A minimal but valid v2 FeatureRule with uid + allEnvironments. Content
// fields are arbitrary — what matters is the unification scope metadata.
function v2Rule(
  id: string,
  uid: string,
  opts: Partial<FeatureRule> = {},
): FeatureRule {
  return {
    id,
    uid,
    type: "force",
    description: "",
    value: "true",
    enabled: true,
    allEnvironments: true,
    ...opts,
  } as unknown as FeatureRule;
}

// A minimal v1 legacy rule (no uid/allEnvironments/environments).
function v1Rule(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
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

describe("buildFeatureInterface", () => {
  // ================= 1. v0 (no environmentSettings) =================

  describe("v0 documents (no environmentSettings)", () => {
    it("redistributes top-level rules into env settings, then flattens to v2", () => {
      const v0: LegacyFeatureInterface = {
        ...BASE_META,
        environments: ["dev", "production"],
        rules: [v1Rule("r1") as FeatureRule],
      } as LegacyFeatureInterface;

      const out = buildFeatureInterface(v0, mockContext());
      // Same rule in both envs after v0 upgrade → merges to allEnvironments=true.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].uid).toBe(generateRuleUid(FEATURE_ID, "r1", "*"));
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    it("handles v0 with no rules and no environments as a zero-rule feature", () => {
      const v0: LegacyFeatureInterface = {
        ...BASE_META,
      } as LegacyFeatureInterface;

      const out = buildFeatureInterface(v0, mockContext());
      expect(out.rules).toEqual([]);
    });
  });

  // ================= 2. v1 (envSettings[env].rules present) =================

  describe("v1 documents (envSettings[env].rules)", () => {
    it("flattens identical rules across envs to a single allEnvironments=true v2 rule", () => {
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

      const out = buildFeatureInterface(v1, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
      expect(out.rules[0].uid).toBe(generateRuleUid(FEATURE_ID, "r1", "*"));
    });

    it("splits env-divergent rules into per-env uids", () => {
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

      const out = buildFeatureInterface(v1, mockContext());
      expect(out.rules).toHaveLength(2);
      const devRule = out.rules.find((r) => r.environments?.[0] === "dev");
      const prodRule = out.rules.find(
        (r) => r.environments?.[0] === "production",
      );
      expect(devRule?.uid).toBe(generateRuleUid(FEATURE_ID, "r1", "dev"));
      expect(prodRule?.uid).toBe(
        generateRuleUid(FEATURE_ID, "r1", "production"),
      );
    });

    it("emits empty rules array when envSettings has rules key but no rules", () => {
      const v1: LegacyFeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      } as LegacyFeatureInterface;

      const out = buildFeatureInterface(v1, mockContext());
      expect(out.rules).toEqual([]);
    });
  });

  // ================= 3. v2 (envSettings has no rules key) =================

  describe("v2 documents (unified)", () => {
    it("passes through v2 top-level rules without regenerating uids", () => {
      const uid = generateRuleUid(FEATURE_ID, "r1", "*");
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [v2Rule("r1", uid)],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const out = buildFeatureInterface(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].uid).toBe(uid);
      expect(out.rules[0].allEnvironments).toBe(true);
      expect(out.rules[0].id).toBe("r1");
    });

    it("is idempotent: calling buildFeatureInterface twice produces identical output", () => {
      const uid1 = generateRuleUid(FEATURE_ID, "r1", "*");
      const uid2 = generateRuleUid(FEATURE_ID, "r2", "dev");
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [
          v2Rule("r1", uid1, { allEnvironments: true }),
          v2Rule("r2", uid2, {
            allEnvironments: false,
            environments: ["dev"],
          } as Partial<FeatureRule>),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const first = buildFeatureInterface(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      const second = buildFeatureInterface(
        first as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(second.rules.map((r) => r.uid)).toEqual(
        first.rules.map((r) => r.uid),
      );
      expect(second.rules.map((r) => r.id)).toEqual(
        first.rules.map((r) => r.id),
      );
    });

    it("preserves unified rule uids even when input rules predate recent content upgrades", () => {
      const uid = "ruid_stable_abc";
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [v2Rule("r1", uid)],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const out = buildFeatureInterface(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules[0].uid).toBe(uid);
    });
  });

  // ================= 4. v1 with v0 crust =================

  describe("v1 with v0 crust (partial v0->v1 migration)", () => {
    it("ignores top-level v0 rules, uses v1 env settings as authoritative", () => {
      const v1WithCrust: LegacyFeatureInterface = {
        ...BASE_META,
        environments: ["dev"], // v0 crust
        rules: [v1Rule("r_stale", { value: "STALE" }) as FeatureRule], // v0 crust
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

      const out = buildFeatureInterface(v1WithCrust, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r_real");
      // Critical: r_stale must NOT appear in the v2 output.
      expect(out.rules.find((r) => r.id === "r_stale")).toBeUndefined();
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

      const out = buildFeatureInterface(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules).toEqual([]);
      // envSettings must survive unchanged (modulo env inheritance which is
      // a no-op for a fully-defined envSettings map).
      expect(Object.keys(out.environmentSettings)).toEqual(
        expect.arrayContaining(["dev", "production"]),
      );
    });

    it("classifies a v2 doc with NO envSettings keys (but the field present) as v2", () => {
      const v2: FeatureInterface = {
        ...BASE_META,
        environmentSettings: {},
        rules: [
          v2Rule("r1", generateRuleUid(FEATURE_ID, "r1", "*"), {
            allEnvironments: true,
          }),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const out = buildFeatureInterface(
        v2 as unknown as LegacyFeatureInterface,
        mockContext(),
      );
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].uid).toBe(generateRuleUid(FEATURE_ID, "r1", "*"));
    });
  });

  // ================= 6. Partial migration (v1 + v2-shaped top-level) =================

  describe("partial migration: v1 env rules + populated top-level rules", () => {
    it("classifies as v1 when env settings have rules key; top-level rules are overwritten by flattener", () => {
      // Simulates a doc mid-migration: envSettings still v1-shaped, but
      // top-level rules has some out-of-date content. The v1 branch wins.
      const v1PartialMigration: LegacyFeatureInterface = {
        ...BASE_META,
        rules: [
          {
            id: "r_from_top_level",
            uid: "ruid_stale_top_level",
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

      const out = buildFeatureInterface(v1PartialMigration, mockContext());
      // Top-level stale rule is gone; env-settings rule is authoritative.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r_from_env");
      expect(
        out.rules.find((r) => r.id === "r_from_top_level"),
      ).toBeUndefined();
    });
  });

  // ================= Env inheritance =================

  describe("env inheritance", () => {
    it("v1 path: expands sparse env settings via parent chain before flattening", () => {
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
          // staging inherits from dev
        },
      } as LegacyFeatureInterface;

      const out = buildFeatureInterface(v1, mockContext(envsWithParent));
      // r1 present in dev + production + inherited staging = all 3 applicable
      // envs → collapses to allEnvironments=true.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
    });
  });

  // ================= applicableEnvs (project scoping) =================

  describe("project-scoped environments", () => {
    it("treats a rule that spans all project-applicable envs as allEnvironments=true", () => {
      const envs: Environment[] = [
        { id: "dev", description: "" },
        { id: "production", description: "" },
        // enterprise-only env restricted to projects it doesn't cover
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

      const out = buildFeatureInterface(v1, mockContext(envs));
      // r1 is in dev + production, which are the only envs applicable to
      // proj_main → collapses to allEnvironments=true.
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].allEnvironments).toBe(true);
    });
  });
});
