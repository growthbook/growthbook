import { FeatureRule } from "shared/validators";
import { stemRuleId, suffixRuleId } from "shared/util";
import { FeatureInterface, V1FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import {
  bucketRulesByEnv,
  toLegacyFeature,
  toLegacyRevision,
  toLegacyRule,
} from "back-end/src/util/toLegacy";
import { migrateRawFeatureToV2 } from "back-end/src/models/FeatureModel";
import { buildFeatureRevisionInterface } from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";

// ---------------------------------------------------------------------------
// toLegacyFeature / toLegacyRevision project v2 features and revisions back
// to the v1 shape consumed by /api/v1 REST responses. The critical contracts:
//   1. Per-env explosion: a v2 rule is copied into every env in its footprint.
//   2. id is emitted VERBATIM: v2-only scope fields are stripped, but any
//      `__<env>` migration suffix on `rule.id` is preserved so REST clients
//      can round-trip the id on PUT/DELETE (mutation endpoints enforce exact
//      id matching). The SDK payload is the only surface that stem-strips —
//      see `getFeatureDefinition` in `util/features.ts`.
//   3. Per-env order preserves global v2 order (as a stable projection).
//   4. environmentSettings entries for existing envs keep their enabled flag
//      and prerequisites, gaining a `rules` key in the process.
//   5. Empty/no-rules features produce envSettings with `rules: []` — not a
//      v2 envSettings.
// ---------------------------------------------------------------------------

const FEATURE_ID = "feat_test";

const ORG_ENVS: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

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

const BASE_FEATURE = {
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

function mockContext(envs: Environment[] = ORG_ENVS): ReqContext {
  return {
    org: { settings: { environments: envs } },
  } as unknown as ReqContext;
}

describe("toLegacyRule", () => {
  it("strips allEnvironments and environments and keeps content", () => {
    const v2 = v2Rule("r1", {
      allEnvironments: false,
      environments: ["dev"],
      description: "hello",
    } as Partial<FeatureRule>);
    const v1 = toLegacyRule(v2);
    expect(v1).not.toHaveProperty("allEnvironments");
    expect(v1).not.toHaveProperty("environments");
    expect(v1.id).toBe("r1");
    expect((v1 as unknown as { description?: string }).description).toBe(
      "hello",
    );
  });

  it("preserves the __<env> migration suffix on rule.id", () => {
    const v2 = v2Rule(suffixRuleId("fr_abc", "production"), {
      allEnvironments: false,
      environments: ["production"],
    } as Partial<FeatureRule>);
    const v1 = toLegacyRule(v2);
    // REST clients see the FULL qualified id so they can echo it back on
    // PUT/DELETE (mutation endpoints enforce exact-id matching).
    expect(v1.id).toBe(suffixRuleId("fr_abc", "production"));
    // Sanity: stemming still reveals the original legacy id for clients
    // that want to group-by stem.
    expect(stemRuleId(v1.id)).toBe("fr_abc");
  });

  it("preserves counter suffixes as well (__<env>__N)", () => {
    const suffixed = suffixRuleId("fr_abc", "dev", 2);
    const v2 = v2Rule(suffixed, {
      allEnvironments: false,
      environments: ["dev"],
    } as Partial<FeatureRule>);
    const v1 = toLegacyRule(v2);
    expect(v1.id).toBe(suffixed);
  });

  it("preserves bare (never-suffixed) ids unchanged", () => {
    const v2 = v2Rule("fr_plain", { allEnvironments: true });
    const v1 = toLegacyRule(v2);
    expect(v1.id).toBe("fr_plain");
  });

  it("does not mutate the input", () => {
    const v2 = v2Rule("r1", { environments: ["dev"] });
    const snapshot = JSON.parse(JSON.stringify(v2));
    toLegacyRule(v2);
    expect(v2).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Shared chokepoint for every v2→v1 env-bucketing surface. Pins the contract:
// fan rules over their footprint, drop empty footprints, seed a guaranteed
// env key set, and run the caller-supplied per-rule transform exactly once.
// ---------------------------------------------------------------------------
describe("bucketRulesByEnv", () => {
  it("seeds the output with applicableEnvs by default", () => {
    const out = bucketRulesByEnv([], ["dev", "production"], (r) => r);
    expect(Object.keys(out).sort()).toEqual(["dev", "production"]);
    expect(out.dev).toEqual([]);
    expect(out.production).toEqual([]);
  });

  it("uses seedEnvs when provided", () => {
    const out = bucketRulesByEnv([], ["dev"], (r) => r, [
      "dev",
      "production",
      "staging",
    ]);
    expect(Object.keys(out).sort()).toEqual(["dev", "production", "staging"]);
  });

  it("explodes allEnvironments=true rules into every applicable env", () => {
    const rule = v2Rule("r1", { allEnvironments: true });
    const out = bucketRulesByEnv([rule], ["dev", "production"], (r) => r);
    expect(out.dev).toHaveLength(1);
    expect(out.production).toHaveLength(1);
    expect(out.dev[0]).toBe(rule);
  });

  it("limits explicit-env rules to their declared envs", () => {
    const rule = v2Rule("r1", {
      allEnvironments: false,
      environments: ["dev"],
    });
    const out = bucketRulesByEnv([rule], ["dev", "production"], (r) => r);
    expect(out.dev).toHaveLength(1);
    expect(out.production).toEqual([]);
  });

  it("drops rules whose footprint is empty (pending no-env, all-non-applicable)", () => {
    const pending = v2Rule("pending", {
      allEnvironments: false,
      environments: [],
    });
    const nonApplicable = v2Rule("scoped_out", {
      allEnvironments: false,
      environments: ["staging"],
    });
    const out = bucketRulesByEnv(
      [pending, nonApplicable],
      ["dev", "production"],
      (r) => r,
    );
    expect(out.dev).toEqual([]);
    expect(out.production).toEqual([]);
  });

  it("applies the per-rule transform once per rule, not once per env", () => {
    const transform = jest.fn((r: FeatureRule) => ({ id: r.id }));
    const rule = v2Rule("r1", { allEnvironments: true });
    bucketRulesByEnv([rule], ["dev", "production", "staging"], transform);
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it("preserves global rule order within each env bucket", () => {
    const a = v2Rule("a", { allEnvironments: true });
    const b = v2Rule("b", { allEnvironments: true });
    const c = v2Rule("c", { allEnvironments: true });
    const out = bucketRulesByEnv([a, b, c], ["dev"], (r) => r);
    expect(out.dev.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("handles undefined rules input by returning seeded empty buckets", () => {
    const out = bucketRulesByEnv(undefined, ["dev", "production"], (r) => r);
    expect(out).toEqual({ dev: [], production: [] });
  });

  it("does not mutate input rules", () => {
    const rule = v2Rule("r1", { allEnvironments: true });
    const snapshot = JSON.parse(JSON.stringify(rule));
    bucketRulesByEnv([rule], ["dev", "production"], (r) => r);
    expect(JSON.parse(JSON.stringify(rule))).toEqual(snapshot);
  });
});

describe("toLegacyFeature", () => {
  // ================= Per-env explosion =================

  describe("per-env explosion", () => {
    it("explodes allEnvironments=true rule into every applicable env", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [v2Rule("r1", { allEnvironments: true })],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.rules).toHaveLength(1);
      expect(v1.environmentSettings?.production?.rules).toHaveLength(1);
      expect(v1.environmentSettings?.dev?.rules?.[0].id).toBe("r1");
      expect(v1.environmentSettings?.production?.rules?.[0].id).toBe("r1");
    });

    it("emits env-specific rule only into its declared environments", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["dev"],
          } as Partial<FeatureRule>),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.rules).toHaveLength(1);
      expect(v1.environmentSettings?.production?.rules).toHaveLength(0);
    });

    it("drops rules whose footprint has no overlap with applicable envs", () => {
      // r1 is scoped to an env that isn't applicable to proj_main.
      const envs: Environment[] = [
        { id: "dev", description: "" },
        { id: "production", description: "" },
        {
          id: "enterprise",
          description: "",
          projects: ["proj_other"],
        },
      ];
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        project: "proj_main",
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
          enterprise: { enabled: true },
        },
        rules: [
          v2Rule("r1", {
            allEnvironments: false,
            environments: ["enterprise"],
          } as Partial<FeatureRule>),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, envs);
      expect(v1.environmentSettings?.dev?.rules).toHaveLength(0);
      expect(v1.environmentSettings?.production?.rules).toHaveLength(0);
      // enterprise entry preserved (from existing envSettings) but no rules
      // were emitted into it because enterprise isn't applicable to proj_main.
      expect(v1.environmentSettings?.enterprise?.rules).toEqual([]);
    });

    it("preserves global v2 rule order as per-env order", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [
          v2Rule("r1", { allEnvironments: true }),
          v2Rule("r2", {
            allEnvironments: false,
            environments: ["dev"],
          } as Partial<FeatureRule>),
          v2Rule("r3", { allEnvironments: true }),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.rules?.map((r) => r.id)).toEqual([
        "r1",
        "r2",
        "r3",
      ]);
      expect(
        v1.environmentSettings?.production?.rules?.map((r) => r.id),
      ).toEqual(["r1", "r3"]);
    });
  });

  // ================= envSettings preservation =================

  describe("environmentSettings preservation", () => {
    it("preserves enabled flag per env", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: false },
        },
        rules: [],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.enabled).toBe(true);
      expect(v1.environmentSettings?.production?.enabled).toBe(false);
    });

    it("preserves prerequisites per env", () => {
      const prereq = {
        id: "feat_parent",
        condition: `{"value": true}`,
      };
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true, prerequisites: [prereq] },
          production: { enabled: true, prerequisites: [] },
        },
        rules: [],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.prerequisites).toEqual([prereq]);
    });

    it("defaults enabled=false for envs present in applicable but absent in envSettings", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          // production missing
          dev: { enabled: true },
        },
        rules: [],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.production?.enabled).toBe(false);
      expect(v1.environmentSettings?.production?.rules).toEqual([]);
    });

    it("passes the top-level defaultValueOverrides list through unchanged and never emits a per-env defaultValue", () => {
      // Per-env defaults now live in a top-level ordered, first-match-wins
      // `defaultValueOverrides` list (see `featureDefaultValueOverride`), not in
      // `environmentSettings[env].defaultValue`. toLegacyFeature only strips
      // `rules`/`environmentSettings`, so the override list rides through the
      // v2 -> v1 projection verbatim, and no env gains a `defaultValue` key.
      const overrides = [
        { id: "o1", value: "dev-override", environments: ["dev"] },
      ];
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        defaultValueOverrides: overrides,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      // The ordered override list survives the v2 -> v1 projection verbatim.
      expect(
        (v1 as unknown as { defaultValueOverrides?: unknown })
          .defaultValueOverrides,
      ).toEqual(overrides);
      // The retired per-env defaultValue map is no longer emitted on any env.
      expect(
        v1.environmentSettings?.dev as unknown as Record<string, unknown>,
      ).not.toHaveProperty("defaultValue");
      expect(
        v1.environmentSettings?.production as unknown as Record<
          string,
          unknown
        >,
      ).not.toHaveProperty("defaultValue");
    });

    it("retains entries for non-applicable envs if they exist in envSettings", () => {
      const envs: Environment[] = [
        { id: "dev", description: "" },
        { id: "production", description: "" },
        { id: "legacy", description: "", projects: ["proj_other"] },
      ];
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        project: "proj_main",
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
          legacy: { enabled: false },
        },
        rules: [],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, envs);
      expect(v1.environmentSettings?.legacy?.enabled).toBe(false);
      expect(v1.environmentSettings?.legacy?.rules).toEqual([]);
    });
  });

  // ================= Shape signals =================

  describe("v1-shape markers", () => {
    it("produces envSettings with a rules key on every env (the v1 signal)", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [v2Rule("r1", { allEnvironments: true })],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      for (const env of Object.values(v1.environmentSettings || {})) {
        expect(env).toHaveProperty("rules");
      }
    });

    it("emits no top-level rules array on the output", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
        },
        rules: [v2Rule("r1", { allEnvironments: true })],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      // V1FeatureInterface.rules is optional (v0 crust). We never emit it.
      expect(v1.rules).toBeUndefined();
    });
  });

  // ================= Empty / degenerate =================

  describe("empty features", () => {
    it("handles a zero-rule feature by emitting empty rule lists per env", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.rules).toEqual([]);
      expect(v1.environmentSettings?.production?.rules).toEqual([]);
    });
  });

  // ================= id preservation on down-conversion =================

  describe("id preservation", () => {
    it("keeps the same legacy id on every exploded copy of a merged rule", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [v2Rule("fr_merged", { allEnvironments: true })],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.rules?.[0].id).toBe("fr_merged");
      expect(v1.environmentSettings?.production?.rules?.[0].id).toBe(
        "fr_merged",
      );
    });

    it("preserves __<env> suffixes on split rules (REST clients echo the qualified id)", () => {
      // A non-mergeable collision pair coming out of the flattener: two rules
      // with the same stem `fr_abc` but different env-suffixes. REST surfaces
      // must expose the full qualified id so clients can PUT/DELETE against
      // the correct rule without ambiguity.
      const devId = suffixRuleId("fr_abc", "dev");
      const prodId = suffixRuleId("fr_abc", "production");
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [
          v2Rule(devId, {
            allEnvironments: false,
            environments: ["dev"],
            value: "A",
          } as Partial<FeatureRule>),
          v2Rule(prodId, {
            allEnvironments: false,
            environments: ["production"],
            value: "B",
          } as Partial<FeatureRule>),
        ],
        prerequisites: [],
      } as unknown as FeatureInterface;

      const v1 = toLegacyFeature(v2, ORG_ENVS);
      expect(v1.environmentSettings?.dev?.rules?.[0].id).toBe(devId);
      expect(v1.environmentSettings?.production?.rules?.[0].id).toBe(prodId);
      // Stems still recover the original legacy id for clients that want to
      // group-by stem (e.g. usage dashboards).
      expect(stemRuleId(v1.environmentSettings!.dev.rules![0].id)).toBe(
        "fr_abc",
      );
      expect(stemRuleId(v1.environmentSettings!.production.rules![0].id)).toBe(
        "fr_abc",
      );
    });
  });

  // ================= Immutability =================

  describe("purity", () => {
    it("does not mutate the input feature", () => {
      const v2: FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: { enabled: true },
          production: { enabled: true },
        },
        rules: [v2Rule("r1", { allEnvironments: true })],
        prerequisites: [],
      } as unknown as FeatureInterface;
      const snapshot = JSON.parse(JSON.stringify(v2));

      toLegacyFeature(v2, ORG_ENVS);
      expect(JSON.parse(JSON.stringify(v2))).toEqual(snapshot);
    });
  });
});

describe("toLegacyRevision", () => {
  it("explodes v2 rules into a Record<env, V1FeatureRule[]>", () => {
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
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const v1 = toLegacyRevision(raw, ORG_ENVS, "");
    expect(v1.rules.dev).toHaveLength(1);
    expect(v1.rules.production).toHaveLength(1);
    expect(v1.rules.dev[0].id).toBe("r1");
  });

  it("preserves __<env> suffixes during down-conversion", () => {
    const qualifiedId = suffixRuleId("fr_abc", "dev");
    const raw = {
      ...BASE_REVISION,
      rules: [
        {
          id: qualifiedId,
          type: "force",
          description: "",
          value: "A",
          enabled: true,
          allEnvironments: false,
          environments: ["dev"],
        },
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const v1 = toLegacyRevision(raw, ORG_ENVS, "");
    expect(v1.rules.dev).toHaveLength(1);
    // Full qualified id is preserved so REST clients can echo it back on
    // PUT/DELETE; stemming still recovers the legacy stem for grouping.
    expect(v1.rules.dev[0].id).toBe(qualifiedId);
    expect(stemRuleId(v1.rules.dev[0].id)).toBe("fr_abc");
  });

  it("emits only the declared env for split rules", () => {
    const raw = {
      ...BASE_REVISION,
      rules: [
        {
          id: "r1",
          type: "force",
          description: "",
          value: "true",
          enabled: true,
          allEnvironments: false,
          environments: ["dev"],
        },
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const v1 = toLegacyRevision(raw, ORG_ENVS, "");
    expect(v1.rules.dev).toHaveLength(1);
    expect(v1.rules.production).toHaveLength(0);
  });

  it("emits empty arrays for applicable envs when feature has no rules", () => {
    const raw = {
      ...BASE_REVISION,
      rules: [] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const v1 = toLegacyRevision(raw, ORG_ENVS, "");
    expect(v1.rules.dev).toEqual([]);
    expect(v1.rules.production).toEqual([]);
  });

  it("includes envs referenced by environmentsEnabled even when outside applicable envs", () => {
    // Union semantics: the legacy shape keys the rules map by (applicable
    // envs ∪ environmentsEnabled keys). This lets v1 clients that iterate
    // `Object.keys(revision.rules)` see every env the revision tracks, even
    // env ids no longer in the org's applicable set (e.g. a since-archived
    // env referenced by the revision's `environmentsEnabled`).
    const raw = {
      ...BASE_REVISION,
      environmentsEnabled: {
        dev: true,
        production: false,
        archived_env: true,
      },
      rules: [] as unknown as FeatureRule[],
    } as unknown as FeatureRevisionInterface;

    const v1 = toLegacyRevision(raw, ORG_ENVS, "");
    expect(Object.keys(v1.rules).sort()).toEqual([
      "archived_env",
      "dev",
      "production",
    ]);
    expect(v1.rules.archived_env).toEqual([]);
  });

  it("respects featureProject to scope applicable envs", () => {
    const envs: Environment[] = [
      { id: "dev", description: "" },
      { id: "production", description: "" },
      { id: "enterprise", description: "", projects: ["proj_other"] },
    ];
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
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    // enterprise is scoped to proj_other, so proj_main sees only dev+production.
    const v1 = toLegacyRevision(raw, envs, "proj_main");
    expect(Object.keys(v1.rules).sort()).toEqual(["dev", "production"]);
    expect(v1.rules.enterprise).toBeUndefined();
  });

  it("preserves non-rule revision fields (version, comment, status, etc.)", () => {
    const raw = {
      ...BASE_REVISION,
      comment: "hello world",
      version: 7,
      baseVersion: 6,
      status: "draft" as const,
      rules: [] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const v1 = toLegacyRevision(raw, ORG_ENVS, "");
    expect(v1.comment).toBe("hello world");
    expect(v1.version).toBe(7);
    expect(v1.baseVersion).toBe(6);
    expect(v1.status).toBe("draft");
  });

  it("does not mutate the input revision", () => {
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
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;
    const snapshot = JSON.parse(JSON.stringify(raw));
    toLegacyRevision(raw, ORG_ENVS, "");
    expect(JSON.parse(JSON.stringify(raw))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Round-trip stability: migrateRawFeatureToV2(toLegacyFeature(x)) should
// produce a doc whose rules align with x on shape (ids, allEnvironments,
// environments). With uid retired, the contract simplifies — we just need
// rule.id to be stable modulo the deterministic __<env> suffixing the
// flattener applies on legacy data.
// ---------------------------------------------------------------------------

describe("toLegacyFeature -> migrateRawFeatureToV2 shape round-trip", () => {
  it("preserves rule ids and allEnvironments=true flag through the round-trip", () => {
    const v2: FeatureInterface = {
      ...BASE_FEATURE,
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
      rules: [v2Rule("r1", { allEnvironments: true })],
      prerequisites: [],
    } as unknown as FeatureInterface;

    const v1 = toLegacyFeature(v2, ORG_ENVS);
    const roundTripped = migrateRawFeatureToV2(
      v1 as unknown as V1FeatureInterface,
      mockContext(),
    );
    expect(roundTripped.rules).toHaveLength(1);
    expect(roundTripped.rules[0].id).toBe("r1");
    expect(roundTripped.rules[0].allEnvironments).toBe(true);
  });

  it("preserves the top-level defaultValueOverrides list through the v2 -> v1 -> v2 round-trip", () => {
    // The ordered override list is a top-level field neither projection touches,
    // so it must survive the v2 -> v1 -> v2 cycle byte-stable. (Serving
    // precedence of these overrides is covered in
    // getFeatureDefinition.environmentDefaults.test.ts.)
    const overrides = [
      { id: "o1", value: "dev-override", environments: ["dev"] },
    ];
    const v2: FeatureInterface = {
      ...BASE_FEATURE,
      defaultValueOverrides: overrides,
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
      rules: [],
      prerequisites: [],
    } as unknown as FeatureInterface;

    const v1 = toLegacyFeature(v2, ORG_ENVS);
    const roundTripped = migrateRawFeatureToV2(
      v1 as unknown as V1FeatureInterface,
      mockContext(),
    );
    expect(
      (roundTripped as unknown as { defaultValueOverrides?: unknown })
        .defaultValueOverrides,
    ).toEqual(overrides);
  });

  // Pending v2 rules carry an empty `environments: []` footprint — the user
  // is staging the rule but hasn't targeted any env yet. v1 has no concept of
  // a "pending" rule, so toLegacyFeature drops them. This test pins the lossy
  // behavior: after a v2 -> v1 -> v2 cycle, the pending rule disappears.
  // Documented v1 limitation; v1 callers doing GET-modify-PUT will lose
  // pending rules silently.
  // KNOWN LOSSY: v1 has no representation for a "pending" rule, so
  // toLegacyFeature silently drops them. v1 GET-modify-PUT loses pending
  // rules with no warning. Pinned to catch accidental change of semantics —
  // not because silent loss is the desired long-term behavior. Future fix
  // candidates: warn-log, release-note, or a v1 extension field.
  it("v2 -> v1 -> v2 round-trip silently drops pending rules (lossy by design — revisit)", () => {
    const v2: FeatureInterface = {
      ...BASE_FEATURE,
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
      rules: [
        v2Rule("r_active", { allEnvironments: true }),
        v2Rule("r_pending", {
          allEnvironments: false,
          environments: [],
        } as Partial<FeatureRule>),
      ],
      prerequisites: [],
    } as unknown as FeatureInterface;

    const v1 = toLegacyFeature(v2, ORG_ENVS);
    // Pending rule has zero footprint → not present in any v1 env.
    for (const env of Object.values(v1.environmentSettings)) {
      expect(env.rules.find((r) => r.id === "r_pending")).toBeUndefined();
    }

    const roundTripped = migrateRawFeatureToV2(
      v1 as unknown as V1FeatureInterface,
      mockContext(),
    );
    // Only the active rule survives the round-trip.
    expect(roundTripped.rules).toHaveLength(1);
    expect(roundTripped.rules[0].id).toBe("r_active");
    expect(
      roundTripped.rules.find((r) => r.id === "r_pending"),
    ).toBeUndefined();
  });

  it("preserves split rules through the round-trip (with __<env> suffixes)", () => {
    // Two non-mergeable rules with the same stem id, different values per env.
    // After a down-then-up cycle, the flattener will re-suffix them.
    const v2: FeatureInterface = {
      ...BASE_FEATURE,
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
      rules: [
        v2Rule(suffixRuleId("fr_abc", "dev"), {
          allEnvironments: false,
          environments: ["dev"],
          value: "A",
        } as Partial<FeatureRule>),
        v2Rule(suffixRuleId("fr_abc", "production"), {
          allEnvironments: false,
          environments: ["production"],
          value: "B",
        } as Partial<FeatureRule>),
      ],
      prerequisites: [],
    } as unknown as FeatureInterface;

    const v1 = toLegacyFeature(v2, ORG_ENVS);
    const roundTripped = migrateRawFeatureToV2(
      v1 as unknown as V1FeatureInterface,
      mockContext(),
    );
    expect(roundTripped.rules).toHaveLength(2);
    const devRule = roundTripped.rules.find(
      (r) => r.environments?.[0] === "dev",
    );
    const prodRule = roundTripped.rules.find(
      (r) => r.environments?.[0] === "production",
    );
    expect(devRule).toBeDefined();
    expect(prodRule).toBeDefined();
    expect((devRule as FeatureRule & { value?: string }).value).toBe("A");
    expect((prodRule as FeatureRule & { value?: string }).value).toBe("B");
    // Both rules re-flattened end up with __<env> suffixed ids; stems match.
    expect(stemRuleId(devRule!.id)).toBe("fr_abc");
    expect(stemRuleId(prodRule!.id)).toBe("fr_abc");
  });
});

// ---------------------------------------------------------------------------
// Multi-cycle stability
//
// Every read from disk goes through the JIT, and v1 REST responses go through
// toLegacy. A writer that opens a feature, saves, re-opens, saves again etc.
// will walk many cycles. Every cycle must converge to a fixed point —
// otherwise rule ids churn forever and external references (ramp targets,
// audit log anchors) break silently.
//
// Stability invariants we assert:
//   1. Mergeable legacy rules (same id + identical content across envs)
//      converge to a single allEnvironments=true v2 rule and stay there.
//   2. Non-mergeable legacy rules (same id but different content per env)
//      get __<env> suffixes on the first flatten; subsequent cycles are
//      identity because toLegacy preserves the suffixed id verbatim and
//      the flattener's stem-based grouping (via `stemRuleId`) re-applies
//      the same deterministic suffixing regardless of whether the input
//      id was bare or already-suffixed.
//   3. Revisions follow the same rules as features.
// ---------------------------------------------------------------------------

describe("multi-cycle v1/v2 conversion stability", () => {
  // Helper: run migrateRawFeatureToV2 -> toLegacyFeature N times and return
  // the v2 snapshots from each cycle. snapshots[0] = after first flatten.
  function cycleFeature(
    raw: V1FeatureInterface,
    n: number,
  ): FeatureInterface[] {
    const snapshots: FeatureInterface[] = [];
    let current: V1FeatureInterface = raw;
    for (let i = 0; i < n; i++) {
      const v2 = migrateRawFeatureToV2(current, mockContext());
      snapshots.push(v2);
      current = toLegacyFeature(v2, ORG_ENVS) as unknown as V1FeatureInterface;
    }
    return snapshots;
  }

  // ================= Mergeable rules =================

  describe("mergeable legacy rules collapse and stay collapsed", () => {
    it("allEnvironments rule: stable across 4 cycles", () => {
      const rawV1: V1FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              {
                id: "r1",
                type: "force",
                description: "",
                value: "true",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
          production: {
            enabled: true,
            rules: [
              {
                id: "r1",
                type: "force",
                description: "",
                value: "true",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
        },
        prerequisites: [],
      } as unknown as V1FeatureInterface;

      const [c1, c2, c3, c4] = cycleFeature(rawV1, 4);
      expect(c2.rules).toEqual(c1.rules);
      expect(c3.rules).toEqual(c1.rules);
      expect(c4.rules).toEqual(c1.rules);
      expect(c1.rules).toHaveLength(1);
      expect(c1.rules[0].id).toBe("r1");
      expect(c1.rules[0].allEnvironments).toBe(true);
    });
  });

  // ================= Non-mergeable rules =================

  describe("non-mergeable legacy rules get suffixed and stay stable", () => {
    it("env-specific split: distinct suffixed ids stable across 4 cycles", () => {
      const rawV1: V1FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              {
                id: "r1",
                type: "force",
                description: "",
                value: "A",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
          production: {
            enabled: true,
            rules: [
              {
                id: "r1",
                type: "force",
                description: "",
                value: "B",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
        },
        prerequisites: [],
      } as unknown as V1FeatureInterface;

      const [c1, c2, c3, c4] = cycleFeature(rawV1, 4);
      expect(c2.rules).toEqual(c1.rules);
      expect(c3.rules).toEqual(c1.rules);
      expect(c4.rules).toEqual(c1.rules);
      expect(c1.rules).toHaveLength(2);
      const ids = c1.rules.map((r) => r.id).sort();
      expect(ids).toEqual(
        [suffixRuleId("r1", "dev"), suffixRuleId("r1", "production")].sort(),
      );
      // Every rule has the same stem.
      expect(c1.rules.every((r) => stemRuleId(r.id) === "r1")).toBe(true);
    });

    it("mixed (merged + split + env-only): stable across cycles", () => {
      const rawV1: V1FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              {
                id: "m1",
                type: "force",
                description: "",
                value: "true",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
              {
                id: "d1",
                type: "force",
                description: "",
                value: "dev-only",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
              {
                id: "s1",
                type: "force",
                description: "",
                value: "split-A",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
          production: {
            enabled: true,
            rules: [
              {
                id: "m1",
                type: "force",
                description: "",
                value: "true",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
              {
                id: "s1",
                type: "force",
                description: "",
                value: "split-B",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
        },
        prerequisites: [],
      } as unknown as V1FeatureInterface;

      const [c1, c2, c3] = cycleFeature(rawV1, 3);
      expect(c2.rules).toEqual(c1.rules);
      expect(c3.rules).toEqual(c1.rules);
      // Expected: m1 merged (allEnvironments), d1 dev-only, s1 split into two
      // __<env>-suffixed rules.
      expect(c1.rules).toHaveLength(4);
      const merged = c1.rules.find((r) => r.id === "m1");
      expect(merged?.allEnvironments).toBe(true);
      const splits = c1.rules.filter((r) => stemRuleId(r.id) === "s1");
      expect(splits).toHaveLength(2);
      expect(splits.map((r) => r.id).sort()).toEqual(
        [suffixRuleId("s1", "dev"), suffixRuleId("s1", "production")].sort(),
      );
    });

    it("v2 output reaches fixed point after the first cycle (not just convergent)", () => {
      const rawV1: V1FeatureInterface = {
        ...BASE_FEATURE,
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              {
                id: "r1",
                type: "force",
                description: "",
                value: "true",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
          production: {
            enabled: true,
            rules: [
              {
                id: "r1",
                type: "force",
                description: "",
                value: "true",
                enabled: true,
              } as unknown as V1FeatureInterface["environmentSettings"][string]["rules"][number],
            ],
          },
        },
        prerequisites: [],
      } as unknown as V1FeatureInterface;

      // After the first flatten we've assigned ids (merged or __<env>-suffixed).
      // Everything after c1 is a read of already-flattened data, so c2..cN
      // must be identity on rules.
      const snapshots = cycleFeature(rawV1, 5);
      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i].rules).toEqual(snapshots[0].rules);
      }
    });
  });

  // ================= Revisions =================

  describe("FeatureRevision multi-cycle stability", () => {
    function cycleRevision(
      raw: FeatureRevisionInterface,
      featureProject: string,
      n: number,
    ): FeatureRevisionInterface[] {
      const snapshots: FeatureRevisionInterface[] = [];
      let current: FeatureRevisionInterface = raw;
      for (let i = 0; i < n; i++) {
        const v2 = buildFeatureRevisionInterface(current, mockContext(), {
          project: featureProject,
        });
        snapshots.push(v2);
        current = toLegacyRevision(
          v2,
          ORG_ENVS,
          featureProject,
        ) as unknown as FeatureRevisionInterface;
      }
      return snapshots;
    }

    it("merged revision rules stable across 4 cycles", () => {
      // Start from a v1-shaped revision (rules is a Record<env, rules[]>).
      const rawV1Rev = {
        ...BASE_REVISION,
        rules: {
          dev: [
            {
              id: "r1",
              type: "force",
              description: "",
              value: "true",
              enabled: true,
            },
          ],
          production: [
            {
              id: "r1",
              type: "force",
              description: "",
              value: "true",
              enabled: true,
            },
          ],
        },
      } as unknown as FeatureRevisionInterface;

      const [c1, c2, c3, c4] = cycleRevision(rawV1Rev, "", 4);
      expect(c2.rules).toEqual(c1.rules);
      expect(c3.rules).toEqual(c1.rules);
      expect(c4.rules).toEqual(c1.rules);
    });

    it("split revision rules stable across cycles", () => {
      const rawV1Rev = {
        ...BASE_REVISION,
        rules: {
          dev: [
            {
              id: "r1",
              type: "force",
              description: "",
              value: "A",
              enabled: true,
            },
          ],
          production: [
            {
              id: "r1",
              type: "force",
              description: "",
              value: "B",
              enabled: true,
            },
          ],
        },
      } as unknown as FeatureRevisionInterface;

      const [c1, c2, c3] = cycleRevision(rawV1Rev, "", 3);
      expect(c2.rules).toEqual(c1.rules);
      expect(c3.rules).toEqual(c1.rules);
      expect((c1.rules as FeatureRule[]).length).toBe(2);
      // Both rules share the stem `r1`.
      expect(
        (c1.rules as FeatureRule[]).every((r) => stemRuleId(r.id) === "r1"),
      ).toBe(true);
    });
  });
});
