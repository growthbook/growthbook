import {
  ExperimentDimension,
  ExperimentDimensionWithSpecifiedSlices,
} from "shared/types/integrations";
import { ExposureQuery } from "shared/types/datasource";
import {
  countDimensionLevels,
  getDimensionsWithSpecifiedSlices,
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

describe("getDimensionsWithSpecifiedSlices", () => {
  const dimensions: ExperimentDimension[] = [
    { type: "experiment", id: "country" },
    { type: "experiment", id: "release_channel" },
    { type: "experiment", id: "browser" },
  ];

  const baseExposureQuery: ExposureQuery = {
    id: "exposure",
    name: "Exposure",
    userIdType: "user_id",
    query: "SELECT user_id, timestamp, experiment_id, variation_id",
    dimensions: ["country", "release_channel", "browser"],
  };

  // The traffic query and the precomputation pipeline both require dimensions
  // with actual slice *values*. Dimensions whose `specifiedSlices` is an empty
  // array are treated as "not configured" and must be filtered out here —
  // otherwise downstream SQL generation emits `IN ()`, which is a syntax
  // error on every standard SQL engine, and the precomputation path bypasses
  // its own `maxCells = 1000` cell-cardinality guard.
  it("excludes dimensions whose specifiedSlices is an empty array", () => {
    const result = getDimensionsWithSpecifiedSlices({
      dimensions,
      exposureQuery: {
        ...baseExposureQuery,
        dimensionMetadata: [
          { dimension: "country", specifiedSlices: ["US", "CA"] },
          { dimension: "release_channel", specifiedSlices: [] },
          { dimension: "browser", specifiedSlices: ["Chrome"] },
        ],
      },
    });

    expect(result).toEqual<ExperimentDimensionWithSpecifiedSlices[]>([
      { type: "experiment", id: "country", specifiedSlices: ["US", "CA"] },
      { type: "experiment", id: "browser", specifiedSlices: ["Chrome"] },
    ]);
  });

  it("returns an empty array when dimensionMetadata is missing", () => {
    expect(
      getDimensionsWithSpecifiedSlices({
        dimensions,
        exposureQuery: baseExposureQuery,
      }),
    ).toEqual([]);
  });

  it("excludes dimensions not present in the provided dimension list", () => {
    const result = getDimensionsWithSpecifiedSlices({
      dimensions: [{ type: "experiment", id: "country" }],
      exposureQuery: {
        ...baseExposureQuery,
        dimensionMetadata: [
          { dimension: "country", specifiedSlices: ["US"] },
          { dimension: "release_channel", specifiedSlices: ["stable"] },
        ],
      },
    });

    expect(result).toEqual<ExperimentDimensionWithSpecifiedSlices[]>([
      { type: "experiment", id: "country", specifiedSlices: ["US"] },
    ]);
  });
});
