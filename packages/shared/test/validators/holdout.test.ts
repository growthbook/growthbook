import { MAX_HOLDOUT_SIZE } from "../../src/util/holdouts";
import { apiCreateHoldoutBody } from "../../src/validators/holdout";

describe("apiCreateHoldoutBody holdoutSize bounds", () => {
  const parse = (holdoutSize: number) =>
    apiCreateHoldoutBody.safeParse({ name: "Holdout", holdoutSize });

  it("accepts sizes up to the maximum", () => {
    expect(parse(0.05).success).toBe(true);
    expect(parse(MAX_HOLDOUT_SIZE).success).toBe(true);
  });

  it("rejects a size above the maximum", () => {
    expect(parse(0.51).success).toBe(false);
    expect(parse(1).success).toBe(false);
  });

  it("rejects zero and negative sizes", () => {
    expect(parse(0).success).toBe(false);
    expect(parse(-0.01).success).toBe(false);
  });
});
