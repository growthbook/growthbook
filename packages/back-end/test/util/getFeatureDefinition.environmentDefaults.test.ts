import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getFeatureDefinition } from "back-end/src/util/features";

// Pure (non-Mongo) coverage of the per-environment default-value override
// serving precedence inside `getFeatureDefinition`:
//
//   revision.environmentDefaults[env]
//     ?? feature.environmentSettings[env].defaultValue   (published override)
//     ?? revision.defaultValue
//     ?? feature.defaultValue
//
// plus the interactions with rules, value types, and disabled envs.

function makeFeature(overrides?: Partial<FeatureInterface>): FeatureInterface {
  return {
    id: "feat_test",
    project: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "base",
    organization: "org-1",
    owner: "",
    valueType: "string" as const,
    archived: false,
    description: "",
    version: 1,
    environmentSettings: {
      production: { enabled: true },
      staging: { enabled: true },
    },
    rules: [],
    ...overrides,
  } as FeatureInterface;
}

function getDef(
  feature: FeatureInterface,
  environment = "production",
  revision?: FeatureRevisionInterface,
) {
  return getFeatureDefinition({
    feature,
    environment,
    groupMap: new Map(),
    experimentMap: new Map(),
    safeRolloutMap: new Map(),
    revision,
  });
}

// Minimal draft revision carrying the (complete) per-env override snapshot.
function makeRevision(
  overrides?: Partial<FeatureRevisionInterface>,
): FeatureRevisionInterface {
  return {
    featureId: "feat_test",
    organization: "org-1",
    baseVersion: 0,
    version: 2,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: null,
    publishedBy: null,
    createdBy: null,
    comment: "",
    status: "draft",
    defaultValue: "base",
    rules: [],
    ...overrides,
  } as FeatureRevisionInterface;
}

describe("getFeatureDefinition per-environment default overrides", () => {
  describe("serving precedence", () => {
    it("serves the published per-env override over the base default", () => {
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: true, defaultValue: "prod-override" },
          staging: { enabled: true },
        },
      });
      expect(getDef(feature)?.defaultValue).toBe("prod-override");
      // staging has no override -> falls back to the base default.
      expect(getDef(feature, "staging")?.defaultValue).toBe("base");
    });

    it("falls back to the base default when no override exists", () => {
      expect(getDef(makeFeature())?.defaultValue).toBe("base");
    });

    it("serves the draft revision override over the published override", () => {
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: true, defaultValue: "published-override" },
          staging: { enabled: true },
        },
      });
      const revision = makeRevision({
        environmentDefaults: { production: "draft-override" },
      });
      expect(getDef(feature, "production", revision)?.defaultValue).toBe(
        "draft-override",
      );
    });

    it("serves the draft revision override over the base default", () => {
      const revision = makeRevision({
        environmentDefaults: { production: "draft-override" },
      });
      expect(getDef(makeFeature(), "production", revision)?.defaultValue).toBe(
        "draft-override",
      );
    });

    it("falls back to the published override when the draft snapshot omits the env (cleared in draft)", () => {
      // The draft's complete snapshot has NO production key (it inherits), so the
      // published per-env override is the next precedence step.
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: true, defaultValue: "published-override" },
          staging: { enabled: true },
        },
      });
      const revision = makeRevision({ environmentDefaults: {} });
      expect(getDef(feature, "production", revision)?.defaultValue).toBe(
        "published-override",
      );
    });

    it("falls back to the draft base default when neither override is present", () => {
      const revision = makeRevision({
        defaultValue: "draft-base",
        environmentDefaults: {},
      });
      expect(getDef(makeFeature(), "production", revision)?.defaultValue).toBe(
        "draft-base",
      );
    });

    it("uses each env's own override independently within a single feature", () => {
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: true, defaultValue: "prod-val" },
          staging: { enabled: true, defaultValue: "staging-val" },
        },
      });
      expect(getDef(feature, "production")?.defaultValue).toBe("prod-val");
      expect(getDef(feature, "staging")?.defaultValue).toBe("staging-val");
    });
  });

  describe("rules still win over the env override", () => {
    it("a matching force rule short-circuits the env override", () => {
      const forceRule: FeatureRule = {
        type: "force",
        id: "rule_force",
        description: "",
        enabled: true,
        value: "forced",
        allEnvironments: true,
      } as FeatureRule;
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: true, defaultValue: "prod-override" },
          staging: { enabled: true },
        },
        rules: [forceRule],
      });
      const def = getDef(feature);
      // The override is still the def's defaultValue, but the force rule serves
      // first (the SDK evaluates rules before falling back to defaultValue).
      expect(def?.defaultValue).toBe("prod-override");
      expect(def?.rules?.[0]).toMatchObject({ force: "forced" });
    });
  });

  describe("value types", () => {
    it("resolves a boolean override", () => {
      const feature = makeFeature({
        valueType: "boolean",
        defaultValue: "false",
        environmentSettings: {
          production: { enabled: true, defaultValue: "true" },
        },
      });
      expect(getDef(feature)?.defaultValue).toBe(true);
    });

    it("resolves a number override", () => {
      const feature = makeFeature({
        valueType: "number",
        defaultValue: "1",
        environmentSettings: {
          production: { enabled: true, defaultValue: "42" },
        },
      });
      expect(getDef(feature)?.defaultValue).toBe(42);
    });

    it("resolves a string override", () => {
      const feature = makeFeature({
        valueType: "string",
        defaultValue: "base",
        environmentSettings: {
          production: { enabled: true, defaultValue: "hello" },
        },
      });
      expect(getDef(feature)?.defaultValue).toBe("hello");
    });

    it("resolves a json override and a sparse rule merges onto the override base", () => {
      const sparseRule: FeatureRule = {
        type: "force",
        id: "rule_sparse",
        description: "",
        enabled: true,
        value: JSON.stringify({ b: 2 }),
        sparse: true,
        allEnvironments: true,
      } as FeatureRule;
      const feature = makeFeature({
        valueType: "json",
        defaultValue: JSON.stringify({ a: 0 }),
        environmentSettings: {
          production: {
            enabled: true,
            defaultValue: JSON.stringify({ a: 1 }),
          },
        },
        rules: [sparseRule],
      });
      const def = getDef(feature);
      // The override object is the JSON default.
      expect(def?.defaultValue).toEqual({ a: 1 });
      // The sparse rule merges onto the override base (a:1) not the feature base.
      expect(def?.rules?.[0]).toMatchObject({ force: { a: 1, b: 2 } });
    });

    it("treats a JSON override of the literal `null` as a real override, not a clear", () => {
      // The exact bug the full-map-replace design avoids: the encoded string
      // "null" is a legitimate JSON value, not an absent override.
      const feature = makeFeature({
        valueType: "json",
        defaultValue: JSON.stringify({ a: 1 }),
        environmentSettings: {
          production: { enabled: true, defaultValue: "null" },
        },
      });
      expect(getDef(feature)?.defaultValue).toBeNull();
    });
  });

  describe("disabled environments", () => {
    it("returns null for a disabled env regardless of any override", () => {
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: false, defaultValue: "prod-override" },
          staging: { enabled: true },
        },
      });
      expect(getDef(feature, "production")).toBeNull();
    });

    it("returns null for a disabled env even with a draft override", () => {
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: false },
          staging: { enabled: true },
        },
      });
      const revision = makeRevision({
        environmentDefaults: { production: "draft-override" },
      });
      expect(getDef(feature, "production", revision)).toBeNull();
    });

    it("returns null when the feature is archived even with an override", () => {
      const feature = makeFeature({
        archived: true,
        environmentSettings: {
          production: { enabled: true, defaultValue: "prod-override" },
        },
      });
      expect(getDef(feature)).toBeNull();
    });
  });
});
