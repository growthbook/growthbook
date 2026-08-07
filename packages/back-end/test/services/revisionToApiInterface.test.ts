import { FeatureRule } from "shared/validators";
import { stemRuleId, suffixRuleId } from "shared/util";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import {
  eventUserToApiEventUser,
  revisionToApiInterface,
  revisionToApiInterfaceV2,
} from "back-end/src/services/features";

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

describe("revision author serialization", () => {
  const dashboardUser = {
    type: "dashboard",
    id: "u1",
    name: "U",
    email: "u@x",
  } as const;
  const apiKeyUser = {
    type: "api_key",
    apiKey: "key_abc123",
    id: "u2",
    name: "CI Bot",
  } as const;
  const systemUser = { type: "system" } as const;

  const revWith = (
    createdBy: FeatureRevisionInterface["createdBy"],
    publishedBy: FeatureRevisionInterface["publishedBy"],
  ) =>
    ({
      ...BASE_REVISION,
      createdBy,
      publishedBy,
      rules: [],
    }) as unknown as FeatureRevisionInterface;

  describe("eventUserToApiEventUser", () => {
    it("maps a dashboard user with id, name, and email", () => {
      expect(eventUserToApiEventUser(dashboardUser)).toEqual({
        type: "dashboard",
        id: "u1",
        name: "U",
        email: "u@x",
      });
    });

    it("maps an api_key actor without exposing the apiKey field", () => {
      const mapped = eventUserToApiEventUser(apiKeyUser);
      expect(mapped).toEqual({ type: "api_key", id: "u2", name: "CI Bot" });
      expect(mapped).not.toHaveProperty("apiKey");
    });

    it("maps a system actor", () => {
      expect(eventUserToApiEventUser(systemUser)).toEqual({ type: "system" });
    });

    it("returns undefined for null or missing users", () => {
      expect(eventUserToApiEventUser(null)).toBeUndefined();
      expect(eventUserToApiEventUser(undefined)).toBeUndefined();
    });

    it("returns undefined for an unrecognized legacy type (fail closed)", () => {
      expect(
        eventUserToApiEventUser({
          type: "unknown_legacy",
        } as unknown as FeatureRevisionInterface["createdBy"]),
      ).toBeUndefined();
    });
  });

  it("keeps legacy display-name strings on v1", () => {
    const api = revisionToApiInterface(
      revWith(dashboardUser, apiKeyUser),
      ORG_ENVS,
      "",
    );
    expect(api.createdBy).toBe("U");
    expect(api.publishedBy).toBe("API");
    expect(api).not.toHaveProperty("createdByUser");
  });

  it("emits structured authors on v2", () => {
    const api = revisionToApiInterfaceV2(revWith(systemUser, dashboardUser));
    expect(api.createdBy).toEqual({ type: "system" });
    expect(api.publishedBy).toEqual({
      type: "dashboard",
      id: "u1",
      name: "U",
      email: "u@x",
    });
  });

  it("never exposes the api_key actor's apiKey on v2", () => {
    const api = revisionToApiInterfaceV2(revWith(apiKeyUser, null));
    expect(api.createdBy).toEqual({
      type: "api_key",
      id: "u2",
      name: "CI Bot",
    });
    expect(api.createdBy).not.toHaveProperty("apiKey");
    expect(api.publishedBy).toBeUndefined();
  });

  it("omits authors for null users on v2", () => {
    const api = revisionToApiInterfaceV2(revWith(null, null));
    expect(api.createdBy).toBeUndefined();
    expect(api.publishedBy).toBeUndefined();
  });
});
