import {
  apiCreateContextualBanditBody,
  apiUpdateContextualBanditBody,
  contextualBanditValidator,
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

describe("stored contextual bandit variation keys", () => {
  const variation = { id: "var_control", name: "Control", screenshots: [] };

  it.each([undefined, null, "", " ", "\t\n"])(
    "rejects a missing or blank key: %j",
    (key) => {
      expect(
        contextualBanditValidator.shape.variations.safeParse([
          { ...variation, key },
        ]).success,
      ).toBe(false);
    },
  );

  it.each(["0", "1", "A0", "a'b", " control "])(
    "preserves a non-empty key: %j",
    (key) => {
      expect(
        contextualBanditValidator.shape.variations.parse([
          { ...variation, key },
        ])[0].key,
      ).toBe(key);
    },
  );
});

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

describe("namespace non-support is explicit", () => {
  // CBs intentionally don't support namespaces. Both body validators are
  // strict, so a `namespace` key (or any unknown key) errors loudly instead
  // of being silently stripped.
  it("rejects a namespace key on create", () => {
    expect(() =>
      apiCreateContextualBanditBody.parse({
        ...baseCreate,
        namespace: { enabled: true, name: "ns1", range: [0, 0.5] },
      }),
    ).toThrow(/namespace/);
  });

  it("rejects a namespace key on update", () => {
    expect(() =>
      apiUpdateContextualBanditBody.parse({
        name: "renamed",
        namespace: { enabled: true, name: "ns1", range: [0, 0.5] },
      }),
    ).toThrow(/namespace/);
  });
});
