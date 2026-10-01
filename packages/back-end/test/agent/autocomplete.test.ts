import {
  cleanCompletion,
  contextKindsForPage,
} from "back-end/src/routers/agent/agent.controller";

describe("cleanCompletion", () => {
  it("spaces a new word when the model echoes the draft", () => {
    expect(
      cleanCompletion(
        "I want to explore the data behind our checkout funnel.",
        "I want to explore the data",
      ),
    ).toBe(" behind our checkout funnel.");
  });
  it("finishes a partial word without a space", () => {
    expect(
      cleanCompletion("show me the feature flags?", "show me the feat"),
    ).toBe("ure flags?");
  });
  it("matches the echoed draft case-insensitively and strips quotes", () => {
    expect(
      cleanCompletion('"Create a flag for checkout."', "create a flag"),
    ).toBe(" for checkout.");
  });
  it("adds a space when the model sends only a continuation", () => {
    expect(cleanCompletion("for the checkout page.\n", "create a flag")).toBe(
      " for the checkout page.",
    );
    expect(cleanCompletion("for the page.", "create a flag ")).toBe(
      "for the page.",
    );
  });
  it("ends every suggestion as a full sentence", () => {
    expect(cleanCompletion("create a flag for checkout", "create a flag")).toBe(
      " for checkout.",
    );
    expect(
      cleanCompletion("create a flag now\nSecond thought", "create a flag"),
    ).toBe(" now.");
  });
  it("returns nothing for an unchanged draft", () => {
    expect(cleanCompletion("create a flag", "create a flag")).toBe("");
  });
});

describe("contextKindsForPage", () => {
  it("narrows to what the page is about", () => {
    expect(contextKindsForPage("/features/checkout-v2")).toEqual(["features"]);
    expect(contextKindsForPage("/experiment/exp_123?tab=results")).toEqual([
      "experiments",
      "metrics",
    ]);
    expect(contextKindsForPage("/fact-metrics/fact_1")).toEqual([
      "metrics",
      "datasources",
    ]);
    expect(contextKindsForPage("/product-analytics/dashboards/d1")).toEqual([
      "datasources",
      "metrics",
    ]);
  });
  it("sends everything when the page has no clear subject", () => {
    expect(contextKindsForPage("/")).toHaveLength(4);
    expect(contextKindsForPage("/settings")).toHaveLength(4);
    expect(contextKindsForPage(undefined)).toHaveLength(4);
  });
});
