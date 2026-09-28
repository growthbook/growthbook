import { getComputeErrorMessage } from "@/services/experiments";

describe("getComputeErrorMessage", () => {
  it("returns analysis-level compute failures", () => {
    expect(
      getComputeErrorMessage({
        computeFailed: true,
        errorMessage: "Metric analysis failed",
      }),
    ).toBe("Metric analysis failed");
  });

  it("ignores expected per-variation stats errors", () => {
    expect(
      getComputeErrorMessage({
        errorMessage: "ZERO_NEGATIVE_VARIANCE",
      }),
    ).toBeNull();
  });

  it("ignores no-data placeholders", () => {
    expect(
      getComputeErrorMessage({
        computeFailed: true,
        errorMessage: "No data",
      }),
    ).toBeNull();
  });
});
