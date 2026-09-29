import { cleanCompletion } from "back-end/src/routers/agent/agent.controller";

describe("cleanCompletion", () => {
  it("spaces a new word when the model echoes the draft", () => {
    expect(
      cleanCompletion(
        "I want to explore the data behind our checkout funnel",
        "I want to explore the data",
      ),
    ).toBe(" behind our checkout funnel");
  });
  it("finishes a partial word without a space", () => {
    expect(
      cleanCompletion("show me the feature flags", "show me the feat"),
    ).toBe("ure flags");
  });
  it("matches the echoed draft case-insensitively and strips quotes", () => {
    expect(
      cleanCompletion('"Create a flag for checkout"', "create a flag"),
    ).toBe(" for checkout");
  });
  it("adds a space when the model sends only a continuation", () => {
    expect(cleanCompletion("for the checkout page\n", "create a flag")).toBe(
      " for the checkout page",
    );
    expect(cleanCompletion("for the page", "create a flag ")).toBe(
      "for the page",
    );
  });
  it("returns nothing for an unchanged draft and keeps only the first line", () => {
    expect(cleanCompletion("create a flag", "create a flag")).toBe("");
    expect(
      cleanCompletion("create a flag now\nSecond thought", "create a flag"),
    ).toBe(" now");
  });
});
