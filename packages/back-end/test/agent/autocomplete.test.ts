import { cleanCompletion } from "back-end/src/routers/agent/agent.controller";

describe("cleanCompletion", () => {
  it("keeps a leading space and drops trailing whitespace", () => {
    expect(cleanCompletion(" for the checkout page\n", "create a flag")).toBe(
      " for the checkout page",
    );
  });
  it("strips wrapping quotes and an echoed draft", () => {
    expect(
      cleanCompletion('"create a flag for checkout"', "create a flag"),
    ).toBe(" for checkout");
  });
  it("keeps only the first line", () => {
    expect(cleanCompletion("ing\nSecond thought", "show me the feat")).toBe(
      "ing",
    );
  });
});
