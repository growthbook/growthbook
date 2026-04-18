import { FeatureRule } from "shared/validators";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { buildFeatureRevisionInterface } from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";
import { generateRuleUid } from "back-end/src/util/flattenRules";

// ---------------------------------------------------------------------------
// buildFeatureRevisionInterface is the pure-function core of
// FeatureRevisionModel.toInterface. It accepts a raw revision object (already
// stripped of Mongoose metadata) and a minimal ReqContext, and emits a v2
// FeatureRevisionInterface via JIT migration.
//
// Integration test matrix:
//   1. v2 rules (FeatureRule[] array)           — pass-through
//   2. v1 rules (Record<env, FeatureRule[]>)    — flattened via flattenV1ToV2Rules
//   3. v2 symmetry with buildFeatureInterface   — upgradeFeatureRule applied
//   4. featureProject hint                      — allEnvironments collapse
//   5. Backfills for old revisions              — status, baseVersion, etc.
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

const BASE_REVISION = {
  organization: "org_test",
  featureId: FEATURE_ID,
  version: 2,
  baseVersion: 1,
  dateCreated: new Date("2024-01-01"),
  dateUpdated: new Date("2024-01-01"),
  datePublished: new Date("2024-01-01"),
  publishedBy: { type: "dashboard" as const, id: "u", email: "", name: "" },
  createdBy: { type: "dashboard" as const, id: "u", email: "", name: "" },
  comment: "",
  defaultValue: "true",
  status: "published" as const,
  log: [],
};

describe("buildFeatureRevisionInterface", () => {
  // ================= 1. v2 rules (array) pass-through =================

  describe("v2 rules (already flat)", () => {
    it("passes through v2 rule array without regenerating uids", () => {
      const uid = generateRuleUid(FEATURE_ID, "r1", "*");
      const raw = {
        ...BASE_REVISION,
        rules: [
          {
            id: "r1",
            uid,
            type: "force",
            description: "",
            value: "true",
            enabled: true,
            allEnvironments: true,
          },
        ] as FeatureRule[],
      } as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].uid).toBe(uid);
      expect(out.rules[0].id).toBe("r1");
    });

    it("is idempotent: calling twice yields identical uids", () => {
      const uid = generateRuleUid(FEATURE_ID, "r1", "*");
      const raw = {
        ...BASE_REVISION,
        rules: [
          {
            id: "r1",
            uid,
            type: "force",
            description: "",
            value: "true",
            enabled: true,
            allEnvironments: true,
          },
        ] as FeatureRule[],
      } as FeatureRevisionInterface;

      const first = buildFeatureRevisionInterface(raw, mockContext());
      const second = buildFeatureRevisionInterface(
        first as FeatureRevisionInterface,
        mockContext(),
      );
      expect(second.rules.map((r) => r.uid)).toEqual(
        first.rules.map((r) => r.uid),
      );
    });
  });

  // ================= 2. v1 rules (Record<env, rules>) flatten =================

  describe("v1 rules (legacy env-keyed record)", () => {
    it("flattens identical rules across envs to allEnvironments=true (with featureProject hint)", () => {
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r1")],
          production: [v1Rule("r1")],
        },
      } as unknown as FeatureRevisionInterface;

      // applicableEnvs only gets computed when featureProject is truthy,
      // which is what lets the flattener collapse a full-footprint rule to
      // `allEnvironments: true`. Callers without a project hint get
      // per-env rules with explicit `environments: [...]` instead — still
      // semantically correct, just not collapsed.
      const out = buildFeatureRevisionInterface(raw, mockContext(), {
        featureProject: "proj_main",
      });
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
      expect(out.rules[0].uid).toBe(generateRuleUid(FEATURE_ID, "r1", "*"));
    });

    it("emits explicit environments list when no featureProject hint is given", () => {
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r1")],
          production: [v1Rule("r1")],
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(false);
      expect(out.rules[0].environments).toEqual(["dev", "production"]);
    });

    it("splits env-divergent rules into per-env uids", () => {
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r1", { value: "A" })],
          production: [v1Rule("r1", { value: "B" })],
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
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

    it("emits empty rules array when all env arrays are empty", () => {
      const raw = {
        ...BASE_REVISION,
        rules: { dev: [], production: [] },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      expect(out.rules).toEqual([]);
    });
  });

  // ================= 3. upgradeFeatureRule symmetry =================

  describe("upgradeFeatureRule symmetry", () => {
    // Pre-coverage experiment rules get `coverage: 1` and normalized weights
    // backfilled. This must apply on BOTH the v1 flatten path and the v2
    // pass-through path so a rule snapshotted into a revision looks the same
    // regardless of which path it arrived by.
    it("heals a pre-coverage experiment rule on the v1 path", () => {
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [
            {
              id: "r_exp",
              type: "experiment",
              description: "",
              trackingKey: "t",
              hashAttribute: "id",
              values: [
                { value: "a", weight: 0.5 },
                { value: "b", weight: 0.5 },
              ],
              // coverage intentionally missing
            },
          ],
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      expect(out.rules).toHaveLength(1);
      const rule = out.rules[0] as FeatureRule & { coverage?: number };
      expect(rule.coverage).toBe(1);
    });

    it("heals a pre-coverage experiment rule on the v2 path", () => {
      const uid = generateRuleUid(FEATURE_ID, "r_exp", "*");
      const raw = {
        ...BASE_REVISION,
        rules: [
          {
            id: "r_exp",
            uid,
            allEnvironments: true,
            type: "experiment",
            description: "",
            trackingKey: "t",
            hashAttribute: "id",
            values: [
              { value: "a", weight: 0.5 },
              { value: "b", weight: 0.5 },
            ],
            // coverage intentionally missing
          },
        ] as unknown as FeatureRule[],
      } as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      const rule = out.rules[0] as FeatureRule & { coverage?: number };
      expect(rule.coverage).toBe(1);
      // uid preserved through the healing pass
      expect(rule.uid).toBe(uid);
    });
  });

  // ================= 4. Backfills =================

  describe("backfills for old revisions", () => {
    it("backfills status=published when missing", () => {
      const { status: _s, ...noStatus } = BASE_REVISION;
      const raw = {
        ...noStatus,
        rules: [],
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      expect(out.status).toBe("published");
    });

    it("backfills baseVersion = version - 1 when missing", () => {
      const { baseVersion: _b, ...noBase } = BASE_REVISION;
      const raw = {
        ...noBase,
        version: 5,
        rules: [],
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      expect(out.baseVersion).toBe(4);
    });

    it("backfills dateUpdated from dateCreated when missing", () => {
      const { dateUpdated: _d, ...noDateUpdated } = BASE_REVISION;
      const raw = {
        ...noDateUpdated,
        rules: [],
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      expect(out.dateUpdated).toEqual(BASE_REVISION.dateCreated);
    });
  });
});
