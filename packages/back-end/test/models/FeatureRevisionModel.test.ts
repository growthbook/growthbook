import { FeatureRule } from "shared/validators";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { naiveFlattenV1Rules, suffixRuleId } from "shared/util";
import {
  activeReviewsFromLog,
  buildFeatureRevisionInterface,
  computeRevisionUpdate,
  normalizeRulesInputToV2,
} from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";
import { V1RulesByEnv } from "back-end/src/util/flattenRules";

// ---------------------------------------------------------------------------
// buildFeatureRevisionInterface is the pure-function core of
// FeatureRevisionModel.toInterface. It accepts a raw revision object (already
// stripped of Mongoose metadata) and a minimal ReqContext, and emits a v2
// FeatureRevisionInterface via JIT migration.
//
// Integration test matrix:
//   1. v2 rules (FeatureRule[] array)           — pass-through
//   2. v1 rules (Record<env, FeatureRule[]>)    — flattened via flattenV1ToV2Rules
//   3. upgradeFeatureRule symmetry              — applied on both paths
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
    it("passes through v2 rule array without rewriting ids", () => {
      const raw = {
        ...BASE_REVISION,
        rules: [
          {
            id: "r1",
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
      expect(out.rules[0].id).toBe("r1");
    });

    it("is idempotent: calling twice yields identical rules", () => {
      const raw = {
        ...BASE_REVISION,
        rules: [
          {
            id: "r1",
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
      expect(second.rules.map((r) => r.id)).toEqual(
        first.rules.map((r) => r.id),
      );
    });

    it("preserves migration-suffixed rule ids on v2 pass-through", () => {
      const raw = {
        ...BASE_REVISION,
        rules: [
          {
            id: suffixRuleId("r1", "dev"),
            type: "force",
            description: "",
            value: "true",
            enabled: true,
            allEnvironments: false,
            environments: ["dev"],
          },
        ] as FeatureRule[],
      } as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext(), undefined);
      expect(out.rules[0].id).toBe(suffixRuleId("r1", "dev"));
    });
  });

  // ================= 2. v1 rules (Record<env, rules>) flatten =================

  describe("v1 rules (legacy env-keyed record)", () => {
    it("flattens identical rules across envs to allEnvironments=true (with featureProject) and keeps bare id", () => {
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r1")],
          production: [v1Rule("r1")],
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext(), {
        project: "proj_main",
      });
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    // Without a featureProject hint, every org env is treated as applicable
    // (project-less feature). A rule covering all org envs still collapses
    // to allEnvironments=true.
    it("collapses to allEnvironments=true when project is undefined and rule covers every org env", () => {
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r1")],
          production: [v1Rule("r1")],
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext(), undefined);
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
    });

    // Regression: a v1 rule scoped to an env excluded from the feature's
    // project must keep the orphan env label (so the UI can flag it) rather
    // than disappear or silently widen.
    it("preserves rules whose only env is non-applicable with the orphan label retained", () => {
      const orgEnvsWithProject: Environment[] = [
        { id: "dev", description: "", projects: ["other_proj"] },
        { id: "production", description: "" },
      ];
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r_dev_only")],
          production: [v1Rule("r_prod_only")],
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(
        raw,
        mockContext(orgEnvsWithProject),
        { project: "proj_main" },
      );
      expect(out.rules).toHaveLength(2);
      const devOnly = out.rules.find((r) => r.id === "r_dev_only");
      const prodOnly = out.rules.find((r) => r.id === "r_prod_only");
      expect(devOnly?.environments).toEqual(["dev"]);
      expect(devOnly?.allEnvironments).toBe(false);
      // r_prod_only covers the only applicable env, so it collapses to
      // allEnvironments=true (environments stripped).
      expect(prodOnly?.allEnvironments).toBe(true);
    });

    it("splits env-divergent rules into per-env suffixed ids", () => {
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r1", { value: "A" })],
          production: [v1Rule("r1", { value: "B" })],
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext(), undefined);
      expect(out.rules).toHaveLength(2);
      const devRule = out.rules.find((r) => r.environments?.[0] === "dev");
      const prodRule = out.rules.find(
        (r) => r.environments?.[0] === "production",
      );
      expect(devRule?.id).toBe(suffixRuleId("r1", "dev"));
      expect(prodRule?.id).toBe(suffixRuleId("r1", "production"));
    });

    it("emits empty rules array when all env arrays are empty", () => {
      const raw = {
        ...BASE_REVISION,
        rules: { dev: [], production: [] },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext(), undefined);
      expect(out.rules).toEqual([]);
    });

    // Sparse legacy revisions must surface parent-env rules in inheriting
    // children — symmetric with `migrateRawFeatureToV2`'s v1 path.
    it("propagates rules across inherited envs (sparse v1 record)", () => {
      const envsWithParent: Environment[] = [
        { id: "dev", description: "" },
        { id: "staging", description: "", parent: "dev" },
        { id: "production", description: "" },
      ];
      const raw = {
        ...BASE_REVISION,
        rules: {
          dev: [v1Rule("r1")],
          production: [v1Rule("r1")],
          // staging is sparse → inherits dev.
        },
      } as unknown as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(
        raw,
        mockContext(envsWithParent),
        { project: "proj_main" },
      );
      expect(out.rules).toHaveLength(1);
      expect(out.rules[0].id).toBe("r1");
      expect(out.rules[0].allEnvironments).toBe(true);
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
      const raw = {
        ...BASE_REVISION,
        rules: [
          {
            id: "r_exp",
            allEnvironments: true,
            type: "experiment",
            description: "",
            trackingKey: "t",
            hashAttribute: "id",
            values: [
              { value: "a", weight: 0.5 },
              { value: "b", weight: 0.5 },
            ],
          },
        ] as unknown as FeatureRule[],
      } as FeatureRevisionInterface;

      const out = buildFeatureRevisionInterface(raw, mockContext());
      const rule = out.rules[0] as FeatureRule & { coverage?: number };
      expect(rule.coverage).toBe(1);
      expect(rule.id).toBe("r_exp");
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

// ---------------------------------------------------------------------------
// normalizeRulesInputToV2
//
// Write-path shim used by createRevision / createInitialRevision. Must accept
// BOTH the canonical v2 shape (ramp writer, future controller rewrites) AND
// the legacy v1 per-env Record (old controller handlers still in flight) and
// produce a canonical v2 array on disk.
//
// Regression guard (Tier 1.1): the ramp writer passes a flat `FeatureRule[]`
// into createRevision. The old implementation did
// `rules[env] = changes.rules[env] || []`, which against an array-valued
// `changes.rules` always evaluated to undefined (string keys on arrays),
// silently wiping every rule on every revision write triggered by ramps.
// The v2-pass-through test below locks this down: v2 input must round-trip
// to a non-empty v2 array, never coerced through the v1 Record path.
// ---------------------------------------------------------------------------
describe("normalizeRulesInputToV2", () => {
  const orgEnvs: Environment[] = [
    { id: "dev" },
    { id: "production" },
  ] as Environment[];

  function v2ForceRule(id: string, value = "true"): FeatureRule {
    return {
      id,
      type: "force",
      description: "",
      enabled: true,
      value,
      allEnvironments: true,
    } as unknown as FeatureRule;
  }

  it("passes through a v2 array unchanged (ramp writer round-trip)", () => {
    const out = normalizeRulesInputToV2([v2ForceRule("fr_ramp")], { orgEnvs });

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("fr_ramp");
    expect(out[0].allEnvironments).toBe(true);
  });

  it("flattens a v1 per-env Record whose content matches across envs", () => {
    // v1 shape — upgradeFeatureRule applied internally. Same id+content in
    // every env → collapses to one allEnvironments rule.
    const v1: V1RulesByEnv = {
      dev: [v1Rule("fr_a")] as unknown as V1RulesByEnv[string],
      production: [v1Rule("fr_a")] as unknown as V1RulesByEnv[string],
    };

    const out = normalizeRulesInputToV2(v1, { orgEnvs });

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("fr_a");
    expect(out[0].allEnvironments).toBe(true);
  });

  it("suffixes v1 rules whose content differs across envs", () => {
    const v1: V1RulesByEnv = {
      dev: [
        v1Rule("fr_split", { value: "A" }),
      ] as unknown as V1RulesByEnv[string],
      production: [
        v1Rule("fr_split", { value: "B" }),
      ] as unknown as V1RulesByEnv[string],
    };

    const out = normalizeRulesInputToV2(v1, { orgEnvs });

    expect(out).toHaveLength(2);
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual([
      suffixRuleId("fr_split", "dev"),
      suffixRuleId("fr_split", "production"),
    ]);
    expect(out.every((r) => !r.allEnvironments)).toBe(true);
  });

  it("returns [] for undefined / null input", () => {
    expect(normalizeRulesInputToV2(undefined, { orgEnvs })).toEqual([]);
    expect(normalizeRulesInputToV2(null, { orgEnvs })).toEqual([]);
  });

  it("returns [] for an empty v2 array", () => {
    expect(normalizeRulesInputToV2([], { orgEnvs })).toEqual([]);
  });

  // Write-side mirror of the read-path inheritance fix: a sparse v1 input must
  // persist a rule scoped to inherited child envs too.
  it("propagates v1 rules across inherited envs (sparse input)", () => {
    const envsWithParent: Environment[] = [
      { id: "dev" } as Environment,
      { id: "staging", parent: "dev" } as Environment,
      { id: "production" } as Environment,
    ];
    const v1: V1RulesByEnv = {
      dev: [v1Rule("fr_inh")] as unknown as V1RulesByEnv[string],
      production: [v1Rule("fr_inh")] as unknown as V1RulesByEnv[string],
    };

    const out = normalizeRulesInputToV2(v1, { orgEnvs: envsWithParent });

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("fr_inh");
    expect(out[0].allEnvironments).toBe(true);
  });

  // Duplicate-id v1 input on create: the v1 controller surface still accepts
  // `Record<env, V1FeatureRule[]>` payloads. If a buggy / older v1 client
  // posts the same rule id under multiple envs (the natural v1 shape), the
  // write must converge to canonical v2 without persisting duplicate ids.
  // - Identical content across envs → one rule with allEnvironments=true.
  // - Diverging content across envs → suffixed `__<env>` ids, all unique.
  describe("duplicate-id v1 input on create (collision handling)", () => {
    it("merges identical-content duplicate ids across envs into one allEnvironments rule", () => {
      const v1: V1RulesByEnv = {
        dev: [v1Rule("fr_dup")] as unknown as V1RulesByEnv[string],
        production: [v1Rule("fr_dup")] as unknown as V1RulesByEnv[string],
      };

      const out = normalizeRulesInputToV2(v1, { orgEnvs: ORG_ENVS });

      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("fr_dup");
      expect(out[0].allEnvironments).toBe(true);
    });

    it("splits diverging-content duplicate ids into per-env suffixed ids (no collision)", () => {
      const v1: V1RulesByEnv = {
        dev: [
          v1Rule("fr_dup", { value: "A" }),
        ] as unknown as V1RulesByEnv[string],
        production: [
          v1Rule("fr_dup", { value: "B" }),
        ] as unknown as V1RulesByEnv[string],
      };

      const out = normalizeRulesInputToV2(v1, { orgEnvs: ORG_ENVS });

      expect(out).toHaveLength(2);
      const ids = out.map((r) => r.id).sort();
      expect(ids).toEqual([
        suffixRuleId("fr_dup", "dev"),
        suffixRuleId("fr_dup", "production"),
      ]);
      // All ids must be unique after normalization (no duplicate-id persist).
      expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
    });

    it("disambiguates duplicate ids within the same env (`__<env>__N`)", () => {
      const v1: V1RulesByEnv = {
        dev: [
          v1Rule("fr_dup", { value: "first" }),
          v1Rule("fr_dup", { value: "second" }),
        ] as unknown as V1RulesByEnv[string],
      };

      const out = normalizeRulesInputToV2(v1, { orgEnvs: ORG_ENVS });

      expect(out).toHaveLength(2);
      // Both rules must have distinct ids.
      expect(new Set(out.map((r) => r.id)).size).toBe(2);
      // Stems unify back to the legacy id.
      expect(out.map((r) => r.id)).toEqual([
        suffixRuleId("fr_dup", "dev"),
        suffixRuleId("fr_dup", "dev", 2),
      ]);
    });
  });

  it("honors featureProject when collapsing to allEnvironments", () => {
    // One restricted env + one unrestricted. Under featureProject="p1" both
    // are applicable, so a rule present in both collapses to
    // allEnvironments=true. Pins the applicable-env-derived collapse that
    // createRevision relies on.
    const restrictedEnvs: Environment[] = [
      { id: "dev" } as Environment,
      { id: "prod-only", projects: ["p1"] } as Environment,
    ];

    const v1: V1RulesByEnv = {
      dev: [v1Rule("fr_cov")] as unknown as V1RulesByEnv[string],
      "prod-only": [v1Rule("fr_cov")] as unknown as V1RulesByEnv[string],
    };

    const out = normalizeRulesInputToV2(v1, {
      orgEnvs: restrictedEnvs,
      featureProject: "p1",
    });

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("fr_cov");
    expect(out[0].allEnvironments).toBe(true);
  });

  // Living documentation: shared `naiveFlattenV1Rules` (UI/diff path) vs
  // back-end `normalizeRulesInputToV2` (persistence path). Same inputs, very
  // different outputs — the shared helper duplicates ids across envs; the
  // back-end version dedupes, collapses to `allEnvironments: true`, and
  // suffixes id collisions. Swapping the shared helper onto a write path
  // would persist duplicate rule ids and break v1 round-trip.
  describe("vs shared naiveFlattenV1Rules", () => {
    it("identical rule across envs: shared duplicates per env, back-end merges into one allEnvironments rule", () => {
      const v1: V1RulesByEnv = {
        dev: [v1Rule("fr_same")] as unknown as V1RulesByEnv[string],
        production: [v1Rule("fr_same")] as unknown as V1RulesByEnv[string],
      };

      const naive = naiveFlattenV1Rules(v1);
      expect(naive).toHaveLength(2);
      expect(naive.every((r) => r.id === "fr_same")).toBe(true);
      expect(new Set(naive.map((r) => r.id)).size).toBe(1);
      expect(naive.map((r) => r.environments)).toEqual([
        ["dev"],
        ["production"],
      ]);

      const persisted = normalizeRulesInputToV2(v1, { orgEnvs: ORG_ENVS });
      expect(persisted).toHaveLength(1);
      expect(persisted[0].id).toBe("fr_same");
      expect(persisted[0].allEnvironments).toBe(true);
    });

    it("diverging rule across envs: shared keeps colliding ids, back-end suffixes them", () => {
      const v1: V1RulesByEnv = {
        dev: [
          v1Rule("fr_split", { value: "A" }),
        ] as unknown as V1RulesByEnv[string],
        production: [
          v1Rule("fr_split", { value: "B" }),
        ] as unknown as V1RulesByEnv[string],
      };

      const naive = naiveFlattenV1Rules(v1);
      expect(naive).toHaveLength(2);
      // Shared helper persists colliding ids — unsafe on write paths.
      expect(new Set(naive.map((r) => r.id)).size).toBe(1);

      const persisted = normalizeRulesInputToV2(v1, { orgEnvs: ORG_ENVS });
      expect(persisted).toHaveLength(2);
      // Back-end version suffixes to keep ids unique.
      expect(new Set(persisted.map((r) => r.id)).size).toBe(2);
      expect(persisted.map((r) => r.id).sort()).toEqual([
        suffixRuleId("fr_split", "dev"),
        suffixRuleId("fr_split", "production"),
      ]);
    });

    it("v2 array input: shared returns the array unchanged; back-end clones (and would dedup if needed)", () => {
      const v2 = [
        {
          id: "fr_v2",
          type: "force" as const,
          description: "",
          enabled: true,
          value: "true",
          allEnvironments: true,
        } as unknown as FeatureRule,
      ];
      expect(naiveFlattenV1Rules(v2)).toBe(v2);
      const persisted = normalizeRulesInputToV2(v2, { orgEnvs: ORG_ENVS });
      expect(persisted).toHaveLength(1);
      expect(persisted[0].id).toBe("fr_v2");
      expect(persisted[0].allEnvironments).toBe(true);
    });

    it("v2 array with colliding ids: back-end suffixes the duplicate", () => {
      const v2 = [
        {
          id: "fr_dup",
          type: "force",
          description: "",
          enabled: true,
          value: "A",
          environments: ["dev"],
          allEnvironments: false,
        },
        {
          id: "fr_dup",
          type: "force",
          description: "",
          enabled: true,
          value: "B",
          environments: ["production"],
          allEnvironments: false,
        },
      ] as unknown as FeatureRule[];
      const persisted = normalizeRulesInputToV2(v2, { orgEnvs: ORG_ENVS });
      expect(persisted).toHaveLength(2);
      expect(new Set(persisted.map((r) => r.id)).size).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// activeReviewsFromLog replays the review lifecycle from merged log entries
// to reconstruct per-reviewer verdicts. It's both the legacy fallback for
// revisions that predate the baked `reviews` field and the semantic spec for
// how that field is maintained (submit upserts, undo removes, request/recall
// clears).
// ---------------------------------------------------------------------------

describe("activeReviewsFromLog", () => {
  const human = (id: string) => ({
    type: "dashboard" as const,
    id,
    email: `${id}@example.com`,
    name: id,
  });
  const bot = (apiKey: string) => ({ type: "api_key" as const, apiKey });
  const at = (minute: number) => new Date(2024, 0, 1, 0, minute);

  it("returns the latest verdict per reviewer with timestamps", () => {
    const reviews = activeReviewsFromLog([
      { action: "Requested Changes", user: human("u1"), timestamp: at(1) },
      { action: "Approved", user: human("u2"), timestamp: at(2) },
      { action: "Approved", user: human("u1"), timestamp: at(3) },
    ]);
    expect(reviews).toHaveLength(2);
    expect(reviews.find((r) => r.userId === "u1")).toMatchObject({
      status: "approved",
      timestamp: at(3),
    });
    expect(reviews.find((r) => r.userId === "u2")).toMatchObject({
      status: "approved",
      timestamp: at(2),
    });
  });

  it("keys api_key reviewers by apiKey and preserves the full event user", () => {
    const reviews = activeReviewsFromLog([
      { action: "Approved", user: bot("key_abc123"), timestamp: at(1) },
    ]);
    expect(reviews).toEqual([
      {
        userId: "key_abc123",
        user: { type: "api_key", apiKey: "key_abc123" },
        status: "approved",
        timestamp: at(1),
      },
    ]);
  });

  it("clears all verdicts when a new review cycle starts", () => {
    for (const reset of ["Review Requested", "Recall Review", "reopen"]) {
      const reviews = activeReviewsFromLog([
        { action: "Approved", user: human("u1"), timestamp: at(1) },
        { action: reset, user: human("author"), timestamp: at(2) },
        { action: "Approved", user: human("u2"), timestamp: at(3) },
      ]);
      expect(reviews.map((r) => r.userId)).toEqual(["u2"]);
    }
  });

  it("removes only the retracting reviewer's verdict on Undo Review", () => {
    const reviews = activeReviewsFromLog([
      { action: "Approved", user: human("u1"), timestamp: at(1) },
      { action: "Requested Changes", user: human("u2"), timestamp: at(2) },
      { action: "Undo Review", user: human("u2"), timestamp: at(3) },
    ]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ userId: "u1", status: "approved" });
  });

  it("replays out-of-order entries by timestamp and skips system/null users", () => {
    const reviews = activeReviewsFromLog([
      // New cycle logged "after" the approval but timestamped before it
      { action: "Approved", user: human("u1"), timestamp: at(5) },
      { action: "Review Requested", user: human("author"), timestamp: at(1) },
      { action: "Approved", user: { type: "system" }, timestamp: at(6) },
      { action: "Approved", user: null, timestamp: at(7) },
    ]);
    expect(reviews.map((r) => r.userId)).toEqual(["u1"]);
  });
});

// ---------------------------------------------------------------------------
// computeRevisionUpdate decides what an edit does to the review lifecycle:
// status resets (changes-requested → pending-review on any content change,
// approved → pending-review when resetReview policy applies) must also demote
// the baked `reviews` verdicts to their "-stale" variants, since they were
// given against older content. They stay attributable but no longer count as
// active verdicts.
// ---------------------------------------------------------------------------

describe("computeRevisionUpdate review staleness", () => {
  const reviewer = {
    type: "dashboard" as const,
    id: "u1",
    email: "u1@example.com",
    name: "u1",
  };
  const reviews = [
    {
      userId: "u1",
      user: reviewer,
      status: "approved" as const,
      timestamp: new Date("2024-01-02"),
    },
  ];

  function revisionWithStatus(status: FeatureRevisionInterface["status"]) {
    return {
      ...BASE_REVISION,
      status,
      rules: [],
      reviews,
    } as unknown as FeatureRevisionInterface;
  }

  it("demotes reviews to -stale when resetReview knocks an approved draft back to pending-review", () => {
    const { status, clearReviews, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      { id: FEATURE_ID } as never,
      revisionWithStatus("approved"),
      { defaultValue: "false" },
      true,
    );
    expect(status).toBe("pending-review");
    expect(clearReviews).toBe(true);
    expect(proposedRevision.reviews).toEqual([
      { ...reviews[0], status: "approved-stale" },
    ]);
  });

  it("demotes reviews to -stale when a content change resets changes-requested to pending-review", () => {
    const { status, clearReviews, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      { id: FEATURE_ID } as never,
      {
        ...revisionWithStatus("changes-requested"),
        reviews: [{ ...reviews[0], status: "changes-requested" as const }],
      },
      { defaultValue: "false" },
      false,
    );
    expect(status).toBe("pending-review");
    expect(clearReviews).toBe(true);
    expect(proposedRevision.reviews).toEqual([
      { ...reviews[0], status: "changes-requested-stale" },
    ]);
  });

  it("leaves already-stale verdicts unchanged when demoting", () => {
    const { proposedRevision } = computeRevisionUpdate(
      mockContext(),
      { id: FEATURE_ID } as never,
      {
        ...revisionWithStatus("approved"),
        reviews: [
          ...reviews,
          {
            userId: "u2",
            user: { ...reviewer, id: "u2" },
            status: "changes-requested-stale" as const,
            timestamp: new Date("2024-01-01"),
          },
        ],
      },
      { defaultValue: "false" },
      true,
    );
    expect(proposedRevision.reviews).toEqual([
      { ...reviews[0], status: "approved-stale" },
      expect.objectContaining({
        userId: "u2",
        status: "changes-requested-stale",
      }),
    ]);
  });

  it("keeps verdicts when the org policy does not reset approved drafts", () => {
    const { status, clearReviews, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      { id: FEATURE_ID } as never,
      revisionWithStatus("approved"),
      { defaultValue: "false" },
      false,
    );
    expect(status).toBe("approved");
    expect(clearReviews).toBe(false);
    expect(proposedRevision.reviews).toEqual(reviews);
  });

  it("does not scrub on plain draft edits", () => {
    const { status, clearReviews } = computeRevisionUpdate(
      mockContext(),
      { id: FEATURE_ID } as never,
      revisionWithStatus("draft"),
      { defaultValue: "false" },
      false,
    );
    expect(status).toBe("draft");
    expect(clearReviews).toBe(false);
  });
});
