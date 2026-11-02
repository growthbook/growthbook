import { holdoutSizeTip, holdoutStatusLabel } from "@/hooks/useHoldouts";

describe("holdoutStatusLabel", () => {
  it.each([
    ["draft", null, "Draft"],
    ["running", null, "Running"],
    ["running", "2026-01-01", "Running: Analysis Phase"],
    ["stopped", "2026-01-01", "Stopped"],
  ] as const)("%s with analysis start %s reads %s", (status, start, label) => {
    expect(
      holdoutStatusLabel(
        { analysisStartDate: start ? new Date(start) : undefined },
        { status },
      ),
    ).toBe(label);
  });
});

describe("holdoutSizeTip", () => {
  it("splits held out, comparison and unmeasured", () => {
    expect(holdoutSizeTip(0.1)).toBe(
      "Of users the holdout targets, 10% are held out and never reach this experiment. Another 10% reach it as the holdout's comparison group, and the other 80% reach it unmeasured.",
    );
  });

  it("keeps fractional sizes", () => {
    const tip = holdoutSizeTip(0.025);
    expect(tip).toContain(", 2.5% are held out");
    expect(tip).toContain("the other 95% reach it unmeasured");
  });
});
