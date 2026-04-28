import { FeatureRule } from "shared/validators";
import { stemRuleId, suffixRuleId } from "shared/util";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { revisionToApiInterface } from "back-end/src/services/features";

// ---------------------------------------------------------------------------
// REST /v1 response `rule.id` contract. Locked in after removing the
// stem-strip hack from `normalizeRuleForApi`:
//
//   1. v2 rules with a `__<env>` migration suffix emit that suffix verbatim
//      on every exploded per-env copy, so REST clients can echo the id back
//      on PUT/DELETE (mutation endpoints enforce strict id matching).
//   2. Bare (never-suffixed) rule ids pass through unchanged.
//   3. `stemRuleId` still recovers the pre-migration legacy id for any
//      consumer (e.g. usage dashboards) that groups by stem.
//   4. Diverges from the SDK payload contract, which stem-strips — see
//      `getFeatureDefinition` in `util/features.ts` for the SDK side.
// ---------------------------------------------------------------------------

const ORG_ENVS: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

const BASE_REVISION = {
  organization: "org_test",
  featureId: "feat_test",
  version: 1,
  baseVersion: 0,
  dateCreated: new Date("2024-01-01"),
  dateUpdated: new Date("2024-01-01"),
  datePublished: null,
  publishedBy: null,
  createdBy: { type: "dashboard", id: "u1", name: "U", email: "u@x" } as const,
  status: "published" as const,
  comment: "",
  defaultValue: "true",
  environments: [],
};

function rule(id: string, extra: Partial<FeatureRule> = {}): FeatureRule {
  return {
    id,
    type: "force",
    description: "",
    value: "true",
    enabled: true,
    allEnvironments: true,
    ...extra,
  } as unknown as FeatureRule;
}

describe("revisionToApiInterface rule.id contract", () => {
  it("emits full qualified id for __<env>-suffixed rules on every exploded copy", () => {
    const devId = suffixRuleId("fr_abc", "dev");
    const prodId = suffixRuleId("fr_abc", "production");

    const rev = {
      ...BASE_REVISION,
      rules: [
        rule(devId, {
          allEnvironments: false,
          environments: ["dev"],
          value: "A",
        } as Partial<FeatureRule>),
        rule(prodId, {
          allEnvironments: false,
          environments: ["production"],
          value: "B",
        } as Partial<FeatureRule>),
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const api = revisionToApiInterface(rev, ORG_ENVS, "");

    expect(api.rules.dev).toHaveLength(1);
    expect(api.rules.production).toHaveLength(1);
    expect(api.rules.dev[0].id).toBe(devId);
    expect(api.rules.production[0].id).toBe(prodId);
    // Sanity: stems still recover the pre-migration id.
    expect(stemRuleId(api.rules.dev[0].id)).toBe("fr_abc");
    expect(stemRuleId(api.rules.production[0].id)).toBe("fr_abc");
  });

  it("preserves bare (never-suffixed) ids across all envs on a merged rule", () => {
    const rev = {
      ...BASE_REVISION,
      rules: [
        rule("fr_merged", { allEnvironments: true }),
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const api = revisionToApiInterface(rev, ORG_ENVS, "");
    expect(api.rules.dev[0].id).toBe("fr_merged");
    expect(api.rules.production[0].id).toBe("fr_merged");
  });

  it("preserves counter suffixes (__<env>__N) verbatim", () => {
    const suffixed = suffixRuleId("fr_abc", "dev", 2);
    const rev = {
      ...BASE_REVISION,
      rules: [
        rule(suffixed, {
          allEnvironments: false,
          environments: ["dev"],
        } as Partial<FeatureRule>),
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const api = revisionToApiInterface(rev, ORG_ENVS, "");
    expect(api.rules.dev[0].id).toBe(suffixed);
  });

  it("emits empty arrays for applicable envs when feature has no rules", () => {
    const rev = {
      ...BASE_REVISION,
      rules: [] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const api = revisionToApiInterface(rev, ORG_ENVS, "");
    expect(api.rules.dev).toEqual([]);
    expect(api.rules.production).toEqual([]);
  });

  it("drops rules whose footprint has no overlap with applicable envs", () => {
    const envs: Environment[] = [
      { id: "dev", description: "" },
      { id: "production", description: "" },
      { id: "enterprise", description: "", projects: ["proj_other"] },
    ];
    const rev = {
      ...BASE_REVISION,
      rules: [
        rule("r1", {
          allEnvironments: false,
          environments: ["enterprise"],
        } as Partial<FeatureRule>),
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    // featureProject = "proj_main" excludes the enterprise env.
    const api = revisionToApiInterface(rev, envs, "proj_main");
    expect(api.rules.dev).toEqual([]);
    expect(api.rules.production).toEqual([]);
    expect(api.rules.enterprise).toBeUndefined();
  });

  // `scheduleRules`, experiment `value`, experiment-ref `variations` default
  // to `[]` (matches the existing `prerequisites` / `savedGroupTargeting`
  // pattern) so v2 clients don't need `undefined` checks.
  describe("collection-field empty-array defaults", () => {
    it("defaults `scheduleRules` to [] when undefined on a force rule", () => {
      const rev = {
        ...BASE_REVISION,
        rules: [
          rule("fr_force_no_schedule", { allEnvironments: true }),
        ] as unknown as FeatureRule[],
      } as FeatureRevisionInterface;
      const api = revisionToApiInterface(rev, ORG_ENVS, "");
      const apiRule = api.rules.dev[0] as unknown as Record<string, unknown>;
      expect(apiRule.scheduleRules).toEqual([]);
      expect(apiRule.savedGroupTargeting).toEqual([]);
      expect(apiRule.prerequisites).toEqual([]);
    });

    it("defaults `value` to [] for an experiment rule with no variations stored", () => {
      const expRule = {
        id: "fr_exp_no_values",
        type: "experiment",
        description: "",
        enabled: true,
        condition: "",
        hashAttribute: "id",
        trackingKey: "exp1",
        coverage: 1,
        allEnvironments: true,
      } as unknown as FeatureRule;
      const rev = {
        ...BASE_REVISION,
        rules: [expRule],
      } as FeatureRevisionInterface;
      const api = revisionToApiInterface(rev, ORG_ENVS, "");
      const apiRule = api.rules.dev[0] as unknown as Record<string, unknown>;
      expect(apiRule.value).toEqual([]);
    });

    it("defaults `variations` to [] for an experiment-ref rule with no variations stored", () => {
      const expRefRule = {
        id: "fr_expref_no_variations",
        type: "experiment-ref",
        description: "",
        enabled: true,
        condition: "",
        experimentId: "exp_x",
        allEnvironments: true,
      } as unknown as FeatureRule;
      const rev = {
        ...BASE_REVISION,
        rules: [expRefRule],
      } as FeatureRevisionInterface;
      const api = revisionToApiInterface(rev, ORG_ENVS, "");
      const apiRule = api.rules.dev[0] as unknown as Record<string, unknown>;
      expect(apiRule.variations).toEqual([]);
    });
  });

  it("does not mutate the input revision rules", () => {
    const rev = {
      ...BASE_REVISION,
      rules: [
        rule(suffixRuleId("fr_abc", "dev"), {
          allEnvironments: false,
          environments: ["dev"],
        } as Partial<FeatureRule>),
      ] as unknown as FeatureRule[],
    } as FeatureRevisionInterface;

    const snapshot = JSON.parse(JSON.stringify(rev.rules));
    revisionToApiInterface(rev, ORG_ENVS, "");
    expect(JSON.parse(JSON.stringify(rev.rules))).toEqual(snapshot);
  });
});
