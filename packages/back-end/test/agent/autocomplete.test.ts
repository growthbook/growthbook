import {
  cleanCompletion,
  contextKindsFor,
  firstSentence,
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
  it("returns nothing when the output is a truncated echo of the draft", () => {
    expect(cleanCompletion("I want to under", "I want to understand")).toBe("");
  });
});

describe("contextKindsFor", () => {
  const typed = (text: string, currentPage = "/") =>
    contextKindsFor({ currentPage, text });

  it("narrows to what the page is about", () => {
    expect(typed("anything", "/features/checkout-v2")).toEqual(["features"]);
    expect(typed("anything", "/experiment/exp_123?tab=results")).toEqual([
      "experiments",
      "metrics",
    ]);
    expect(typed("anything", "/fact-metrics/fact_1")).toEqual([
      "datasources",
      "metrics",
    ]);
    expect(typed("anything", "/product-analytics/dashboards/d1")).toEqual([
      "datasources",
      "metrics",
    ]);
  });
  it("falls back to the words in the draft", () => {
    expect(typed("create a flag for")).toEqual(["features"]);
    expect(typed("show me the revenue metric")).toEqual([
      "datasources",
      "metrics",
    ]);
    expect(typed("compare the experiment results")).toEqual([
      "experiments",
      "metrics",
    ]);
  });
  it("combines the draft with the recent conversation", () => {
    expect(
      contextKindsFor({
        currentPage: "/",
        text: "I want to",
        historyText:
          "user: which flag controls checkout?\nassistant: checkout-v2.",
      }),
    ).toEqual(["features"]);
    expect(
      contextKindsFor({
        currentPage: "/",
        text: "and the revenue metric",
        historyText: "user: which flag controls checkout?",
      }),
    ).toEqual(["datasources", "features", "metrics"]);
  });
  it("returns null when nothing gives context yet", () => {
    expect(typed("I want to understand")).toBeNull();
    expect(typed("tell me how", "/settings")).toBeNull();
  });
});

describe("firstSentence", () => {
  it("keeps the first sentence and caps its length", () => {
    expect(
      firstSentence("Chart product data. Build dashboards. Use for X."),
    ).toBe("Chart product data.");
    expect(firstSentence("x".repeat(200))).toHaveLength(160);
  });
});
