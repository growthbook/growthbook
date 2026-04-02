import { shouldRunHealthTrafficQuery } from "back-end/src/queryRunners/snapshotQueryHelpers";

describe("shouldRunHealthTrafficQuery", () => {
  it("returns true for standard snapshots when health traffic is enabled", () => {
    expect(
      shouldRunHealthTrafficQuery({
        snapshotType: "standard",
        snapshotDimensions: [],
        runHealthTrafficQuery: true,
      }),
    ).toBe(true);
  });

  it("returns true for exploratory snapshots with no selected dimensions", () => {
    expect(
      shouldRunHealthTrafficQuery({
        snapshotType: "exploratory",
        snapshotDimensions: [],
        runHealthTrafficQuery: true,
      }),
    ).toBe(true);
  });

  it("returns false for exploratory snapshots with selected dimensions", () => {
    expect(
      shouldRunHealthTrafficQuery({
        snapshotType: "exploratory",
        snapshotDimensions: [{ id: "dim_device_type" }],
        runHealthTrafficQuery: true,
      }),
    ).toBe(false);
  });

  it("returns false when org health traffic query setting is disabled", () => {
    expect(
      shouldRunHealthTrafficQuery({
        snapshotType: "standard",
        snapshotDimensions: [],
        runHealthTrafficQuery: false,
      }),
    ).toBe(false);
  });
});
