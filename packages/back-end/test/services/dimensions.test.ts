import { ExperimentDimensionWithSpecifiedSlices } from "shared/types/integrations";
import {
  countDimensionLevels,
  trimPrecomputedDimensionsToMaxCells,
} from "back-end/src/services/dimensions";

describe("trimPrecomputedDimensionsToMaxCells", () => {
  it("returns correct number of slices", () => {
    const dimensions: ExperimentDimensionWithSpecifiedSlices[] = [
      {
        type: "experiment" as const,
        id: "dim1",
        specifiedSlices: ["a", "b", "c"],
      },
      {
        type: "experiment" as const,
        id: "dim2",
        specifiedSlices: ["d", "e", "f"],
      },
    ];
    // with 2 variations, we should return all dimensions (2 * 4 * 4 = 32 < 1000)
    expect(trimPrecomputedDimensionsToMaxCells(dimensions, 2)).toEqual(
      dimensions,
    );
    // with 100 variations (just as an example) (100 * 4 * 4 = 1600 > 1000), so we only get the
    // first dimension
    expect(trimPrecomputedDimensionsToMaxCells(dimensions, 100)).toEqual([
      dimensions[0],
    ]);
    // with 1000 variations (just as an example) (1000 * 4 * 4 = 16000 > 1000), so we get no dimensions
    expect(trimPrecomputedDimensionsToMaxCells(dimensions, 1000)).toEqual([]);
  });

  it("computes dimension levels correctly", () => {
    const specifiedSlices = [
      {
        type: "experiment" as const,
        id: "dim1",
        specifiedSlices: ["a", "b", "c"],
      },
      {
        type: "experiment" as const,
        id: "dim2",
        specifiedSlices: ["d", "e", "f"],
      },
    ];

    expect(countDimensionLevels(specifiedSlices, 2)).toEqual(32);
    expect(countDimensionLevels(specifiedSlices, 100)).toEqual(1600);
    expect(countDimensionLevels(specifiedSlices, 1000)).toEqual(16000);
  });
});
