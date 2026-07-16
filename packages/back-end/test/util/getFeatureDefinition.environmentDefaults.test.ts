import {
  FeatureInterface,
  FeatureRule,
  FeatureDefaultValueOverride,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getFeatureDefinition } from "back-end/src/util/features";

// Pure (non-Mongo) coverage of the default-value override serving precedence
// inside `getFeatureDefinition`. Overrides are an ordered, first-match-wins list
// resolved at bake time:
//
//   first-match in revision.defaultValueOverrides   (draft snapshot, if passed)
//     ?? revision.defaultValue
//     ?? first-match in feature.defaultValueOverrides  (published, live serving)
//     ?? feature.defaultValue
//
// plus the interactions with rules, value types, and disabled envs.

const ov = (
  id: string,
  value: string,
  environments: string[] = [],
): FeatureDefaultValueOverride => ({ id, value, environments });

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

// Minimal draft revision carrying the (complete) override snapshot.
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

describe("getFeatureDefinition default value overrides", () => {
  describe("serving precedence", () => {
    it("serves the published override over the base default", () => {
      const feature = makeFeature({
        defaultValueOverrides: [ov("a", "prod-override", ["production"])],
      });
      expect(getDef(feature)?.defaultValue).toBe("prod-override");
      // staging is matched by no override -> falls back to the base default.
      expect(getDef(feature, "staging")?.defaultValue).toBe("base");
    });

    it("falls back to the base default when no override matches", () => {
      expect(getDef(makeFeature())?.defaultValue).toBe("base");
    });

    it("serves the first matching override (order wins)", () => {
      const feature = makeFeature({
        defaultValueOverrides: [
          ov("first", "first", ["production"]),
          ov("second", "second", ["production"]),
        ],
      });
      expect(getDef(feature)?.defaultValue).toBe("first");
    });

    it("an empty-scope override matches every environment", () => {
      const feature = makeFeature({
        defaultValueOverrides: [ov("all", "everywhere", [])],
      });
      expect(getDef(feature, "production")?.defaultValue).toBe("everywhere");
      expect(getDef(feature, "staging")?.defaultValue).toBe("everywhere");
    });

    it("serves the draft revision override over the published override", () => {
      const feature = makeFeature({
        defaultValueOverrides: [ov("a", "published-override", ["production"])],
      });
      const revision = makeRevision({
        defaultValueOverrides: [ov("b", "draft-override", ["production"])],
      });
      expect(getDef(feature, "production", revision)?.defaultValue).toBe(
        "draft-override",
      );
    });

    it("serves the draft revision override over the base default", () => {
      const revision = makeRevision({
        defaultValueOverrides: [ov("b", "draft-override", ["production"])],
      });
      expect(getDef(makeFeature(), "production", revision)?.defaultValue).toBe(
        "draft-override",
      );
    });

    it("a draft that cleared the override inherits the base, NOT the published override", () => {
      // When a revision is passed its `defaultValueOverrides` snapshot is the
      // AUTHORITATIVE complete picture: an empty list means the revision has no
      // overrides, so the preview must inherit the base (draft, then feature) and
      // must NOT fall back to the stale published overrides.
      const feature = makeFeature({
        defaultValueOverrides: [ov("a", "published-override", ["production"])],
      });
      const revision = makeRevision({ defaultValueOverrides: [] });
      expect(getDef(feature, "production", revision)?.defaultValue).toBe(
        "base",
      );
    });

    it("falls back to the draft base default when no override matches", () => {
      const revision = makeRevision({
        defaultValue: "draft-base",
        defaultValueOverrides: [],
      });
      expect(getDef(makeFeature(), "production", revision)?.defaultValue).toBe(
        "draft-base",
      );
    });

    it("uses each env's own first-match override within a single feature", () => {
      const feature = makeFeature({
        defaultValueOverrides: [
          ov("p", "prod-val", ["production"]),
          ov("s", "staging-val", ["staging"]),
        ],
      });
      expect(getDef(feature, "production")?.defaultValue).toBe("prod-val");
      expect(getDef(feature, "staging")?.defaultValue).toBe("staging-val");
    });
  });

  describe("rules still win over the override", () => {
    it("a matching force rule short-circuits the override", () => {
      const forceRule: FeatureRule = {
        type: "force",
        id: "rule_force",
        description: "",
        enabled: true,
        value: "forced",
        allEnvironments: true,
      } as FeatureRule;
      const feature = makeFeature({
        defaultValueOverrides: [ov("a", "prod-override", ["production"])],
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
        defaultValueOverrides: [ov("a", "true", ["production"])],
      });
      expect(getDef(feature)?.defaultValue).toBe(true);
    });

    it("resolves a number override", () => {
      const feature = makeFeature({
        valueType: "number",
        defaultValue: "1",
        defaultValueOverrides: [ov("a", "42", ["production"])],
      });
      expect(getDef(feature)?.defaultValue).toBe(42);
    });

    it("resolves a string override", () => {
      const feature = makeFeature({
        valueType: "string",
        defaultValue: "base",
        defaultValueOverrides: [ov("a", "hello", ["production"])],
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
        defaultValueOverrides: [
          ov("a", JSON.stringify({ a: 1 }), ["production"]),
        ],
        rules: [sparseRule],
      });
      const def = getDef(feature);
      // The override object is the JSON default.
      expect(def?.defaultValue).toEqual({ a: 1 });
      // The sparse rule merges onto the override base (a:1) not the feature base.
      expect(def?.rules?.[0]).toMatchObject({ force: { a: 1, b: 2 } });
    });

    it("treats a JSON override of the literal `null` as a real override", () => {
      const feature = makeFeature({
        valueType: "json",
        defaultValue: JSON.stringify({ a: 1 }),
        defaultValueOverrides: [ov("a", "null", ["production"])],
      });
      expect(getDef(feature)?.defaultValue).toBeNull();
    });
  });

  describe("disabled environments", () => {
    it("returns null for a disabled env regardless of any override", () => {
      const feature = makeFeature({
        environmentSettings: {
          production: { enabled: false },
          staging: { enabled: true },
        },
        defaultValueOverrides: [ov("a", "prod-override", ["production"])],
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
        defaultValueOverrides: [ov("a", "draft-override", ["production"])],
      });
      expect(getDef(feature, "production", revision)).toBeNull();
    });

    it("returns null when the feature is archived even with an override", () => {
      const feature = makeFeature({
        archived: true,
        defaultValueOverrides: [ov("a", "prod-override", ["production"])],
      });
      expect(getDef(feature)).toBeNull();
    });
  });
});
