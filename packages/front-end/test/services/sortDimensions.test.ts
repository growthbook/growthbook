import { NULL_DIMENSION_VALUE } from "shared/constants";
import { ExperimentReportResultDimension } from "shared/types/report";
import {
  sortDimensionsByAlpha,
  sortDimensionsByTraffic,
} from "@/services/experiments";

function makeDim(
  name: string,
  usersPerVariation: number[] = [100, 50],
): ExperimentReportResultDimension {
  return {
    name,
    srm: 1,
    variations: usersPerVariation.map((users) => ({
      users,
      metrics: {},
    })),
  };
}

describe("sortDimensionsByTraffic", () => {
  it("sorts by total user count descending", () => {
    const dims = [
      makeDim("Safari", [100, 20]),
      makeDim("Chrome", [500, 300]),
      makeDim("Firefox", [50, 10]),
    ];
    const sorted = sortDimensionsByTraffic(dims);
    expect(sorted.map((d) => d.name)).toEqual(["Chrome", "Safari", "Firefox"]);
  });

  it("pushes (other) to the end", () => {
    const dims = [
      makeDim("(other)", [999, 999]),
      makeDim("Chrome", [500, 300]),
      makeDim("Safari", [100, 20]),
    ];
    const sorted = sortDimensionsByTraffic(dims);
    expect(sorted[sorted.length - 1].name).toBe("(other)");
    expect(sorted[0].name).toBe("Chrome");
  });

  it("pushes __NULL_DIMENSION to the end", () => {
    const dims = [
      makeDim(NULL_DIMENSION_VALUE, [999, 999]),
      makeDim("Chrome", [500, 300]),
      makeDim("Safari", [100, 20]),
    ];
    const sorted = sortDimensionsByTraffic(dims);
    expect(sorted[sorted.length - 1].name).toBe(NULL_DIMENSION_VALUE);
    expect(sorted[0].name).toBe("Chrome");
  });

  it("handles empty array", () => {
    expect(sortDimensionsByTraffic([])).toEqual([]);
  });

  it("handles single element", () => {
    const dims = [makeDim("Chrome", [100, 50])];
    expect(sortDimensionsByTraffic(dims)).toEqual(dims);
  });

  it("preserves original array (returns copy)", () => {
    const dims = [makeDim("B", [10]), makeDim("A", [100])];
    const sorted = sortDimensionsByTraffic(dims);
    expect(dims[0].name).toBe("B");
    expect(sorted[0].name).toBe("A");
  });

  it("sums users across all variations", () => {
    const dims = [makeDim("Three", [10, 20, 30]), makeDim("Two", [100, 200])];
    const sorted = sortDimensionsByTraffic(dims);
    expect(sorted[0].name).toBe("Two");
    expect(sorted[1].name).toBe("Three");
  });
});

describe("sortDimensionsByAlpha", () => {
  it("sorts alphabetically A-Z", () => {
    const dims = [
      makeDim("Safari"),
      makeDim("Chrome"),
      makeDim("Firefox"),
      makeDim("Edge"),
    ];
    const sorted = sortDimensionsByAlpha(dims);
    expect(sorted.map((d) => d.name)).toEqual([
      "Chrome",
      "Edge",
      "Firefox",
      "Safari",
    ]);
  });

  it("pushes (other) to the end", () => {
    const dims = [makeDim("(other)"), makeDim("Chrome"), makeDim("Safari")];
    const sorted = sortDimensionsByAlpha(dims);
    expect(sorted[sorted.length - 1].name).toBe("(other)");
    expect(sorted[0].name).toBe("Chrome");
  });

  it("pushes __NULL_DIMENSION to the end", () => {
    const dims = [
      makeDim(NULL_DIMENSION_VALUE),
      makeDim("Chrome"),
      makeDim("Safari"),
    ];
    const sorted = sortDimensionsByAlpha(dims);
    expect(sorted[sorted.length - 1].name).toBe(NULL_DIMENSION_VALUE);
    expect(sorted[0].name).toBe("Chrome");
  });

  it("sorts numeric strings naturally", () => {
    const dims = [
      makeDim("Version 10"),
      makeDim("Version 2"),
      makeDim("Version 1"),
    ];
    const sorted = sortDimensionsByAlpha(dims);
    expect(sorted.map((d) => d.name)).toEqual([
      "Version 1",
      "Version 2",
      "Version 10",
    ]);
  });

  it("handles empty array", () => {
    expect(sortDimensionsByAlpha([])).toEqual([]);
  });

  it("handles single element", () => {
    const dims = [makeDim("Chrome")];
    expect(sortDimensionsByAlpha(dims)).toEqual(dims);
  });

  it("preserves original array (returns copy)", () => {
    const dims = [makeDim("B"), makeDim("A")];
    const sorted = sortDimensionsByAlpha(dims);
    expect(dims[0].name).toBe("B");
    expect(sorted[0].name).toBe("A");
  });

  it("sorts case-insensitively", () => {
    const dims = [makeDim("safari"), makeDim("Chrome"), makeDim("edge")];
    const sorted = sortDimensionsByAlpha(dims);
    expect(sorted.map((d) => d.name)).toEqual(["Chrome", "edge", "safari"]);
  });
});
