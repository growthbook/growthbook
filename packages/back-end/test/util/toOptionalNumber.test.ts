import { toOptionalNumber } from "back-end/src/util/integration";

describe("toOptionalNumber", () => {
  it("parses numbers and numeric strings", () => {
    expect(toOptionalNumber(12)).toBe(12);
    expect(toOptionalNumber("4644879984")).toBe(4644879984);
    expect(toOptionalNumber("0")).toBe(0);
  });

  it("returns undefined instead of NaN for missing or non-numeric values", () => {
    expect(toOptionalNumber(undefined)).toBeUndefined();
    expect(toOptionalNumber(null)).toBeUndefined();
    expect(toOptionalNumber("abc")).toBeUndefined();
  });
});
