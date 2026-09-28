import { proportionToPercentInputValue } from "@/components/Forms/percentFieldUtils";

describe("proportionToPercentInputValue", () => {
  it("returns canonical percent values with the existing display precision", () => {
    expect(proportionToPercentInputValue(undefined)).toBeUndefined();
    expect(proportionToPercentInputValue(0.153)).toBe(15.3);
    expect(proportionToPercentInputValue(0.00015)).toBe(0.02);
    expect(proportionToPercentInputValue(-0.25)).toBe(-25);
    expect(proportionToPercentInputValue(5)).toBe(500);
  });
});
