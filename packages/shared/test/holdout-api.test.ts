import {
  apiCreateHoldoutBody,
  MAX_HOLDOUT_SIZE,
} from "../src/validators/holdout";

describe("apiCreateHoldoutBody holdoutSize bounds", () => {
  const parse = (holdoutSize: number) =>
    apiCreateHoldoutBody.safeParse({ name: "Holdout", holdoutSize });

  it("accepts sizes up to the maximum", () => {
    expect(parse(0).success).toBe(true);
    expect(parse(0.05).success).toBe(true);
    expect(parse(MAX_HOLDOUT_SIZE).success).toBe(true);
  });

  it("rejects a size above the maximum", () => {
    // Previously reachable through the UI, which clamped the entered percent
    // at 100 and then doubled it into a coverage of 2.
    expect(parse(0.51).success).toBe(false);
    expect(parse(1).success).toBe(false);
  });

  it("rejects a negative size", () => {
    expect(parse(-0.01).success).toBe(false);
  });
});
