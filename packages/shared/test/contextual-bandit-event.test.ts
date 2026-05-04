import {
  CONTEXTUAL_BANDIT_EVENT_CELL_CAP,
  contextualBanditEventValidator,
} from "../src/validators/contextual-bandit-event";

describe("contextualBanditEventValidator", () => {
  const baseLeaf = {
    leafId: "leaf_0",
    rule: "country in [US]",
    condition: { country: { $in: ["US"] } },
    n: 1000,
    contextIds: ["ctx_us"],
    weights: [0.5, 0.5],
  };

  it("parses a valid CBE document", () => {
    const doc = {
      id: "cbe_001",
      organization: "org_1",
      experiment: "exp_1",
      phase: 0,
      cbaqId: "cbaq_1",
      date: new Date(),
      contextResults: [
        {
          contextId: "ctx_us",
          leafId: "leaf_0",
          n: 1000,
          weights: [0.5, 0.5],
        },
      ],
      tree: {
        leaves: [baseLeaf],
        splitFeatures: ["country"],
        treeModel: "regression_tree" as const,
      },
      weightsWereUpdated: true,
      reweight: true,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    expect(() => contextualBanditEventValidator.parse(doc)).not.toThrow();
  });

  it("exposes the documented cell cap", () => {
    expect(CONTEXTUAL_BANDIT_EVENT_CELL_CAP).toBe(3000);
  });
});
