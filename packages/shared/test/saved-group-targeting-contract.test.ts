import {
  postExperimentValidator,
  postFeatureRevisionRuleAddV2Validator,
  postFeatureV2Validator,
  postFeatureValidator,
  updateExperimentValidator,
  updateFeatureV2Validator,
  updateFeatureValidator,
} from "../src/validators";

// `savedGroups: [{ match, ids }]` is the storage shape and the spelling the
// feature revision rule endpoints take. The bulk write endpoints used to accept
// only the response spelling (`savedGroupTargeting`) and silently strip
// `savedGroups`, publishing rules with no targeting at all. They now take both,
// with `savedGroups` winning.

const STORAGE = [{ match: "all" as const, ids: ["sg_beta"] }];
const RESPONSE_SHAPED = [
  { matchType: "all" as const, savedGroups: ["sg_beta"] },
];

const forceRule = (targeting: Record<string, unknown>) => ({
  type: "force",
  value: "true",
  ...targeting,
});

// Create bodies carry id/valueType; update bodies reject them.
const featureBodyV2 = (targeting: Record<string, unknown>) => ({
  id: "flag",
  owner: "o",
  valueType: "boolean" as const,
  defaultValue: "false",
  rules: [forceRule(targeting)],
});

const updateFeatureBodyV2 = (targeting: Record<string, unknown>) => ({
  rules: [forceRule(targeting)],
});

const featureBodyV1 = (targeting: Record<string, unknown>) => ({
  id: "flag",
  owner: "o",
  valueType: "boolean" as const,
  defaultValue: "false",
  environments: { dev: { enabled: true, rules: [forceRule(targeting)] } },
});

const updateFeatureBodyV1 = (targeting: Record<string, unknown>) => ({
  environments: { dev: { enabled: true, rules: [forceRule(targeting)] } },
});

const experimentBody = (targeting: Record<string, unknown>) => ({
  datasourceId: "ds",
  assignmentQueryId: "q",
  trackingKey: "t",
  name: "exp",
  variations: [
    { key: "0", name: "control" },
    { key: "1", name: "treatment" },
  ],
  phases: [{ name: "p", dateStarted: "2026-01-01", ...targeting }],
});

const bulkSurfaces = [
  ["POST /v2/features", postFeatureV2Validator, featureBodyV2],
  ["POST /v2/features/:id", updateFeatureV2Validator, updateFeatureBodyV2],
  ["POST /v1/features", postFeatureValidator, featureBodyV1],
  ["POST /v1/features/:id", updateFeatureValidator, updateFeatureBodyV1],
  ["POST /v1/experiments", postExperimentValidator, experimentBody],
  ["POST /v1/experiments/:id", updateExperimentValidator, experimentBody],
] as const;

describe("saved-group targeting write contract", () => {
  describe.each(bulkSurfaces)("%s (bulk)", (_name, validator, build) => {
    it("accepts the storage spelling instead of dropping it", () => {
      const result = validator.bodySchema.safeParse(
        build({ savedGroups: STORAGE }),
      );
      expect(result.success).toBe(true);
      expect(JSON.stringify(result.data)).toContain("sg_beta");
    });

    it("still accepts the response spelling, so GET round-trips work", () => {
      expect(
        validator.bodySchema.safeParse(
          build({ savedGroupTargeting: RESPONSE_SHAPED }),
        ).success,
      ).toBe(true);
    });

    it("keeps both spellings when sent together, for the mapper to resolve", () => {
      const result = validator.bodySchema.safeParse(
        build({ savedGroups: STORAGE, savedGroupTargeting: RESPONSE_SHAPED }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("POST /v2/features/:id/revisions/:version/rules (revision)", () => {
    const parse = (targeting: Record<string, unknown>) =>
      postFeatureRevisionRuleAddV2Validator.bodySchema.safeParse({
        rule: forceRule(targeting),
      });

    it("accepts the storage spelling", () => {
      expect(parse({ savedGroups: STORAGE }).success).toBe(true);
    });

    it("rejects the response spelling, since it is strict", () => {
      expect(parse({ savedGroupTargeting: RESPONSE_SHAPED }).success).toBe(
        false,
      );
    });
  });
});
