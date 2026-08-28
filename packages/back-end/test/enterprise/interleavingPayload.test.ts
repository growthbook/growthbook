import { InterleavingInterface } from "shared/validators";
import { buildInterleaveControllerFeature } from "back-end/src/enterprise/services/interleavingPayload";

const baseInterleaving: InterleavingInterface = {
  id: "il_abc123",
  organization: "org_1",
  owner: "user_1",
  project: "",
  datasource: "ds_1",
  interleavingQueryId: "ilq_1",
  name: "Featured products ranker",
  description: "",
  trackingKey: "featured-products-ranker",
  variationNames: ["buyers-picks", "price-low"],
  metrics: [],
  status: "running",
  archived: false,
  measurementArmPercent: 0,
  dateCreated: new Date(),
  dateUpdated: new Date(),
};

describe("buildInterleaveControllerFeature", () => {
  it("emits a controller feature with the interleave rule", () => {
    const def = buildInterleaveControllerFeature(baseInterleaving);
    expect(def).toEqual({
      defaultValue: "buyers-picks",
      rules: [
        {
          interleave: {
            lists: ["buyers-picks", "price-low"],
            fallbackValue: "buyers-picks",
          },
        },
      ],
    });
  });

  it("includes the rule id only when requested", () => {
    const def = buildInterleaveControllerFeature(baseInterleaving, {
      includeRuleIds: true,
    });
    expect(def.rules?.[0]?.id).toBe("il_abc123");
  });

  it("includes measurementArmPercent only when set", () => {
    const def = buildInterleaveControllerFeature({
      ...baseInterleaving,
      measurementArmPercent: 30,
    });
    expect(def.rules?.[0]?.interleave).toEqual({
      lists: ["buyers-picks", "price-low"],
      fallbackValue: "buyers-picks",
      measurementArmPercent: 30,
    });
  });

  it("emits a rule-less feature for connections without the capability", () => {
    const def = buildInterleaveControllerFeature(baseInterleaving, {
      includeRule: false,
    });
    expect(def).toEqual({ defaultValue: "buyers-picks" });
  });
});
