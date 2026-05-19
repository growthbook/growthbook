import {
  ExperimentDimension,
  ExperimentDimensionWithSpecifiedSlices,
} from "shared/types/integrations";
import {
  ExperimentInterface,
  IncrementalRefreshInterface,
} from "shared/validators";
import { DataSourceInterface, ExposureQuery } from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import { ReqContext } from "back-end/types/request";
import { findDimensionsByIds } from "back-end/src/models/DimensionModel";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { logger } from "back-end/src/util/logger";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";

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
        d.specifiedSlices?.length &&
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

type PrecomputedUnitDimensionSkip = {
  reason:
    | "missing-datasource"
    | "not-found"
    | "missing-exposure-query"
    | "datasource-mismatch"
    | "user-id-type-mismatch";
  dimensionId?: string;
};

async function resolvePrecomputedUnitDimensions({
  context,
  datasource,
  exposureQueryId,
  dimensionIds,
}: {
  context: ReqContext;
  datasource: DataSourceInterface | null;
  exposureQueryId: string | undefined;
  dimensionIds: string[];
}): Promise<{
  dimensions: DimensionInterface[];
  skipped: PrecomputedUnitDimensionSkip[];
}> {
  if (dimensionIds.length === 0) {
    return { dimensions: [], skipped: [] };
  }

  if (!datasource) {
    return {
      dimensions: [],
      skipped: [{ reason: "missing-datasource" }],
    };
  }

  const dims = await findDimensionsByIds(dimensionIds, context.org.id);
  const found = new Set(dims.map((d) => d.id));
  const skipped: PrecomputedUnitDimensionSkip[] = dimensionIds
    .filter((id) => !found.has(id))
    .map((dimensionId) => ({ reason: "not-found", dimensionId }));

  let exposureQueryUserIdType: string;
  try {
    exposureQueryUserIdType = getExposureQuery(
      datasource,
      exposureQueryId ?? "",
    ).userIdType;
  } catch {
    return {
      dimensions: [],
      skipped: [
        ...skipped,
        {
          reason: "missing-exposure-query",
        },
      ],
    };
  }

  const dimensions = dims.filter((dimension) => {
    if (dimension.datasource !== datasource.id) {
      skipped.push({
        reason: "datasource-mismatch",
        dimensionId: dimension.id,
      });
      return false;
    }

    if (dimension.userIdType !== exposureQueryUserIdType) {
      skipped.push({
        reason: "user-id-type-mismatch",
        dimensionId: dimension.id,
      });
      return false;
    }

    return true;
  });

  return { dimensions, skipped };
}

/**
 * Resolves "always compute" unit dimensions into the subset still valid for
 * this experiment's datasource and exposure-query identifier type.
 */
export async function getEligiblePrecomputedUnitDimensionIds({
  context,
  experiment,
  datasource,
  dimensionIds,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  dimensionIds: string[];
}): Promise<string[]> {
  const { dimensions, skipped } = await resolvePrecomputedUnitDimensions({
    context,
    datasource,
    exposureQueryId: experiment.exposureQueryId,
    dimensionIds,
  });

  if (skipped.length > 0) {
    logger.warn(
      {
        experimentId: experiment.id,
        skipped,
      },
      "Eager unit-dim skipped ineligible dimensions",
    );
  }

  return dimensions.map((dimension) => dimension.id);
}

/**
 * Precomputed unit dimensions are only supported on datasources with a
 * writable ephemeral pipeline. This mirrors the `useUnitsTable` gate in
 * `ExperimentResultsQueryRunner`: an ephemeral pipeline guarantees a shared
 * units table the per-dimension metric queries can read.
 */
export function datasourceHasWritableEphemeralPipeline({
  context,
  datasource,
}: {
  context: ReqContext;
  datasource: DataSourceInterface;
}): boolean {
  const integration = getSourceIntegrationObject(context, datasource);
  const pipelineSettings = datasource.settings.pipelineSettings;
  return (
    !!integration.getSourceProperties().supportsWritingTables &&
    !!pipelineSettings?.allowWriting &&
    pipelineSettings?.mode === "ephemeral" &&
    !!pipelineSettings?.writeDataset &&
    orgHasPremiumFeature(context.org, "pipeline-mode")
  );
}

/**
 * Validates the precomputed unit dimension ids are valid for the experiment.
 *
 * @throws {Error} if the precomputed unit dimension ids are not valid
 */
export async function assertExperimentPrecomputedUnitDimensionIdsAreValid({
  context,
  datasource,
  exposureQueryId,
  dimensionIds,
}: {
  context: ReqContext;
  datasource: DataSourceInterface | null;
  exposureQueryId: string | undefined;
  dimensionIds: string[];
}): Promise<void> {
  // Nothing to validate when clearing the config
  if (dimensionIds.length === 0) {
    return;
  }

  // Bounds the per-snapshot warehouse query fan-out: each id adds one
  // isolated metric query per metric-group on every refresh.
  if (dimensionIds.length > 5) {
    throw new Error("A maximum of 5 precomputed unit dimensions are allowed");
  }

  const { skipped } = await resolvePrecomputedUnitDimensions({
    context,
    datasource,
    exposureQueryId,
    dimensionIds,
  });

  const missingDatasource = skipped.find(
    (s) => s.reason === "missing-datasource",
  );

  if (missingDatasource || !datasource) {
    throw new Error(
      "precomputedUnitDimensionIds requires the experiment to have a datasource",
    );
  }

  if (!datasourceHasWritableEphemeralPipeline({ context, datasource })) {
    throw new Error(
      "Precomputed unit dimensions require a datasource with ephemeral Pipeline Mode enabled",
    );
  }

  const missing = skipped.filter((s) => s.reason === "not-found");
  if (missing.length > 0) {
    throw new Error(
      `Unknown precomputedUnitDimensionIds: ${missing
        .map((s) => s.dimensionId)
        .join(", ")}`,
    );
  }

  const missingExposureQuery = skipped.find(
    (s) => s.reason === "missing-exposure-query",
  );
  if (missingExposureQuery) {
    throw new Error(
      "precomputedUnitDimensionIds requires a valid experiment exposure query",
    );
  }

  const invalidDimension = skipped.find(
    (s) =>
      s.reason === "datasource-mismatch" ||
      s.reason === "user-id-type-mismatch",
  );
  if (invalidDimension) {
    if (invalidDimension.reason === "datasource-mismatch") {
      throw new Error(
        `precomputedUnitDimension "${invalidDimension.dimensionId}" datasource does not match the experiment datasource`,
      );
    }
    throw new Error(
      `precomputedUnitDimension "${invalidDimension.dimensionId}" userIdType does not match the experiment exposure query`,
    );
  }
}

export function getExposureQueryEligibleDimensions({
  exposureQuery,
  incrementalRefreshModel,
  nVariations,
}: {
  exposureQuery: ExposureQuery;
  // Should be null if full refresh
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
