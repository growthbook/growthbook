import {
  customDimensionDraftError,
  isCutoffWithinBounds,
} from "@/components/Dimensions/CustomDimensionFields";

describe("isCutoffWithinBounds", () => {
  const min = new Date("2026-01-01T00:00:00.000Z");
  const max = new Date("2026-02-01T00:00:00.000Z");

  it("accepts an instant strictly inside the window", () => {
    expect(
      isCutoffWithinBounds(new Date("2026-01-15T00:00:00.000Z"), min, max),
    ).toBe(true);
  });

  it("rejects the boundaries and anything outside", () => {
    expect(isCutoffWithinBounds(min, min, max)).toBe(false);
    expect(isCutoffWithinBounds(max, min, max)).toBe(false);
    expect(
      isCutoffWithinBounds(new Date("2025-12-31T23:59:00.000Z"), min, max),
    ).toBe(false);
    expect(
      isCutoffWithinBounds(new Date("2026-02-01T00:01:00.000Z"), min, max),
    ).toBe(false);
  });

  it("treats missing bounds as unbounded", () => {
    expect(isCutoffWithinBounds(new Date("1999-01-01T00:00:00.000Z"))).toBe(
      true,
    );
  });
});

describe("customDimensionDraftError", () => {
  const min = new Date("2026-01-01T00:00:00.000Z");
  const max = new Date("2026-02-01T00:00:00.000Z");

  it("explains why a cutoff draft can't be applied", () => {
    expect(
      customDimensionDraftError({ kind: "cutoff", constituentIds: [] }),
    ).toBe("Choose a cutoff time");
    expect(
      customDimensionDraftError(
        {
          kind: "cutoff",
          cutoff: new Date("2026-03-01T00:00:00.000Z"),
          constituentIds: [],
        },
        min,
        max,
      ),
    ).toBe("Choose a cutoff time within the experiment window");
    expect(
      customDimensionDraftError(
        {
          kind: "cutoff",
          cutoff: new Date("2026-01-15T00:00:00.000Z"),
          constituentIds: [],
        },
        min,
        max,
      ),
    ).toBe(null);
  });

  it("explains why a combo draft can't be applied", () => {
    expect(
      customDimensionDraftError({ kind: "combo", constituentIds: ["dim_a"] }),
    ).toBe("Choose two different dimensions");
    expect(
      customDimensionDraftError({
        kind: "combo",
        constituentIds: ["dim_a", "dim_a"],
      }),
    ).toBe("Choose two different dimensions");
    expect(
      customDimensionDraftError({
        kind: "combo",
        constituentIds: ["dim_a", "dim_b"],
      }),
    ).toBe(null);
  });
});
