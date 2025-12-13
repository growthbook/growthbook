import {
  ExperimentDimension,
  ExperimentDimensionWithSpecifiedSlices,
} from "shared/types/integrations";
import { IncrementalRefreshInterface } from "shared/validators";
import { ExposureQuery } from "back-end/types/datasource";

// Gets all Dimensions from the exposure query
export function getExposureQueryDimensions({
  exposureQuery,
}: {
  exposureQuery: ExposureQuery;
}): ExperimentDimension[] {
  return exposureQuery.dimensions.map((d) => {
    return {
      type: "experiment",
      id: d,
    };
  });
}

// Gets all exposure query dimensions with specified slices
export function getDimensionsWithSpecifiedSlices({
  dimensions,
  exposureQuery,
}: {
  dimensions: ExperimentDimension[];
  exposureQuery: ExposureQuery;
}): ExperimentDimensionWithSpecifiedSlices[] {
  return (
    exposureQuery.dimensionMetadata?.flatMap((d) => {
      if (
        d.specifiedSlices &&
        dimensions.some((dim) => dim.id === d.dimension)
      ) {
        return [
          {
            type: "experiment",
            id: d.dimension,
            specifiedSlices: d.specifiedSlices,
          },
        ];
      }
      return [];
    }) ?? []
  );
}

export function trimPrecomputedDimensionsToMaxCells(
  dimensions: ExperimentDimensionWithSpecifiedSlices[],
  nVariations: number,
): ExperimentDimensionWithSpecifiedSlices[] {
  let totalLevels = countDimensionLevels(dimensions, nVariations);
  const maxCells = 1000;
  while (totalLevels > maxCells) {
    dimensions = dimensions.slice(0, -1);
    if (dimensions.length === 0) {
      break;
    }
    totalLevels = countDimensionLevels(dimensions, nVariations);
  }

  return dimensions;
}

export function countDimensionLevels(
  dimensions: ExperimentDimensionWithSpecifiedSlices[],
  nVariations: number,
): number {
  const nLevels: number[] = [];
  dimensions.forEach((dim) => {
    // add 1 for __other__ slice
    nLevels.push(dim.specifiedSlices.length + 1);
  });

  return nLevels.reduce((acc, n) => acc * n, 1) * nVariations;
}

type EligibleDimensions = {
  eligibleDimensions: ExperimentDimension[];
  // Use for traffic analysis
  eligibleDimensionsWithSlices: ExperimentDimensionWithSpecifiedSlices[];
  // Use for pre-computing/post-stratification
  eligibleDimensionsWithSlicesUnderMaxCells: ExperimentDimensionWithSpecifiedSlices[];
};

export function getExposureQueryEligibleDimensions({
  exposureQuery,
  incrementalRefreshModel,
  nVariations,
}: {
  exposureQuery: ExposureQuery;
  incrementalRefreshModel: IncrementalRefreshInterface | null;
  nVariations: number;
}): EligibleDimensions {
  const allDimensions = getExposureQueryDimensions({ exposureQuery });
  const eligibleDimensions = incrementalRefreshModel
    ? allDimensions.filter((d) =>
        incrementalRefreshModel.unitsDimensions.includes(d.id),
      )
    : allDimensions;
  const eligibleDimensionsWithSlices = getDimensionsWithSpecifiedSlices({
    dimensions: eligibleDimensions,
    exposureQuery,
  });
  const eligibleDimensionsWithSlicesUnderMaxCells =
    trimPrecomputedDimensionsToMaxCells(
      eligibleDimensionsWithSlices,
      nVariations,
    );
  return {
    eligibleDimensions,
    eligibleDimensionsWithSlices,
    eligibleDimensionsWithSlicesUnderMaxCells,
  };
}
