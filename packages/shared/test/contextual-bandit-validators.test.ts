import {
  apiCreateContextualBanditBody,
  apiUpdateContextualBanditBody,
  MAX_CONTEXTUAL_BANDIT_LEAVES,
} from "../src/validators/contextual-bandit";

const baseCreate = {
  name: "cb",
  trackingKey: "cb_tk",
  decisionMetric: "met_1",
  variations: [{ key: "0", name: "A" }],
  datasource: "ds_1",
  contextualBanditQueryId: "cbq_1",
  contextualAttributes: ["country"],
};

describe("maxLeaves request-boundary cap", () => {
  it("accepts maxLeaves up to the cap on create", () => {
    expect(() =>
      apiCreateContextualBanditBody.parse({
        ...baseCreate,
        maxLeaves: MAX_CONTEXTUAL_BANDIT_LEAVES,
      }),
    ).not.toThrow();
  });

  it("rejects maxLeaves above the cap on create", () => {
    expect(() =>
      apiCreateContextualBanditBody.parse({
        ...baseCreate,
        maxLeaves: MAX_CONTEXTUAL_BANDIT_LEAVES + 1,
      }),
    ).toThrow();
  });

  it("rejects maxLeaves above the cap on update", () => {
    expect(() =>
      apiUpdateContextualBanditBody.parse({ maxLeaves: 5000 }),
    ).toThrow();
  });

  it("still rejects non-positive values", () => {
    expect(() =>
      apiUpdateContextualBanditBody.parse({ maxLeaves: 0 }),
    ).toThrow();
  });
});
