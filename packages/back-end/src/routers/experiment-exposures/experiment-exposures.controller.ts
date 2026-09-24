import type { Response } from "express";
import type { ExperimentExposureRecord } from "shared/validators";
import {
  formatQueryExecutionErrorForApi,
  parseIntWithDefaultCapped,
  parseOptionalInt,
} from "shared/util";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  createCompletedQuery,
  getRecentQuery,
} from "back-end/src/models/QueryModel";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import {
  getSourceIntegrationObject,
  runExperimentExposuresQuery,
} from "back-end/src/services/datasource";
import { shapeExposureRows } from "back-end/src/services/experiment-exposures";
import { logger } from "back-end/src/util/logger";

type ExposuresResponse = {
  records: ExperimentExposureRecord[];
  dimensions: string[];
  extraColumns: string[];
  hasMore: boolean;
  sql?: string;
  error?: string;
  cached?: boolean;
  /** When the query actually ran — the cached run's time on a cache hit. */
  ranAt?: string;
};

const MAX_WINDOW_HOURS = 24 * 7;
const PAGE_SIZE = 100;
// The client derives its window from the current clock, so the SQL text would
// otherwise differ on every request and never hit the query cache.
const DATE_QUANTIZATION_MS = 5 * 60 * 1000;

function quantizeWindow(
  startDate: Date,
  endDate: Date,
): { startDate: Date; endDate: Date } {
  const windowMs = endDate.getTime() - startDate.getTime();
  const quantizedEnd = new Date(
    Math.ceil(endDate.getTime() / DATE_QUANTIZATION_MS) * DATE_QUANTIZATION_MS,
  );
  return {
    startDate: new Date(quantizedEnd.getTime() - windowMs),
    endDate: quantizedEnd,
  };
}

export async function getExposures(
  req: AuthRequest<
    unknown,
    { id: string },
    {
      startDate: string;
      endDate: string;
      userId?: string;
      variationId?: string;
      dimensionFilters?: string;
      page?: string;
    }
  >,
  res: Response<ExposuresResponse>,
) {
  const context = getContextFromReq(req);

  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    context.throwNotFoundError("Experiment not found");
    return;
  }
  if (!experiment.datasource) {
    context.throwBadRequestError(
      "This experiment is not connected to a data source.",
    );
    return;
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    context.throwNotFoundError("Data source not found");
    return;
  }

  if (!context.permissions.canRunHealthQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  // Throws when the experiment has no assignment table configured; the raw
  // message is warehouse jargon, so replace it with something actionable.
  let exposureQuery;
  try {
    exposureQuery = getExposureQuery(
      datasource,
      experiment.exposureQueryId || "",
    );
  } catch {
    context.throwBadRequestError(
      "This experiment has no experiment assignment table configured. Set one in the experiment's Analysis Settings.",
    );
    return;
  }

  const rawStart = new Date(req.query.startDate);
  const rawEnd = new Date(req.query.endDate);
  const windowMs = rawEnd.getTime() - rawStart.getTime();
  if (windowMs <= 0) {
    context.throwBadRequestError("End date must be after start date.");
  }
  if (windowMs > MAX_WINDOW_HOURS * 60 * 60 * 1000) {
    context.throwBadRequestError(
      `Time window cannot exceed ${MAX_WINDOW_HOURS / 24} days.`,
    );
  }
  const { startDate, endDate } = quantizeWindow(rawStart, rawEnd);

  const dimensions = exposureQuery.dimensions || [];

  let dimensionFilters: Record<string, string> | undefined;
  if (req.query.dimensionFilters) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.query.dimensionFilters);
    } catch {
      context.throwBadRequestError("Could not parse dimension filters.");
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      context.throwBadRequestError("Could not parse dimension filters.");
      return;
    }
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || !value) continue;
      // Silently dropping an unknown key would show unfiltered data as though
      // it had been filtered.
      if (!dimensions.includes(key)) {
        context.throwBadRequestError(
          `Dimension "${key}" is not available on this exposure query.`,
        );
        return;
      }
      entries[key] = value;
    }
    if (Object.keys(entries).length) dimensionFilters = entries;
  }

  const page = parseIntWithDefaultCapped(req.query.page, 1, 1_000);
  const offset = (page - 1) * PAGE_SIZE;

  const integration = getSourceIntegrationObject(context, datasource);

  const emptyBody = {
    records: [],
    dimensions,
    extraColumns: [],
    hasMore: false,
  };

  let sql: string;
  try {
    if (!integration.getExperimentExposuresQuery) {
      context.throwBadRequestError(
        "Exposure logs are not supported for this data source type.",
      );
      return;
    }
    sql = integration.getExperimentExposuresQuery({
      experimentId: experiment.id,
      experimentTrackingKey: experiment.trackingKey,
      exposureQuerySql: exposureQuery.query,
      userIdType: exposureQuery.userIdType,
      startDate,
      endDate,
      userId: req.query.userId,
      variationId: req.query.variationId,
      dimensions,
      dimensionFilters,
      limit: PAGE_SIZE,
      offset,
    });
  } catch (e) {
    res.status(200).json({
      ...emptyBody,
      error: formatQueryExecutionErrorForApi(e),
    });
    return;
  }

  let rawRows: Record<string, unknown>[];
  let cached = false;
  let ranAt = new Date();
  try {
    const recent = await getRecentQuery(
      context.org.id,
      datasource.id,
      sql,
      parseOptionalInt(datasource.settings?.queryCacheTTLMins),
    );
    if (recent?.status === "succeeded" && recent.rawResult) {
      rawRows = recent.rawResult;
      cached = true;
      if (recent.createdAt) ranAt = recent.createdAt;
    } else {
      const result = await runExperimentExposuresQuery(integration, {
        experimentId: experiment.id,
        experimentTrackingKey: experiment.trackingKey,
        exposureQuerySql: exposureQuery.query,
        userIdType: exposureQuery.userIdType,
        startDate,
        endDate,
        userId: req.query.userId,
        variationId: req.query.variationId,
        dimensions,
        dimensionFilters,
        limit: PAGE_SIZE,
        offset,
      });
      rawRows = result.rows;
      try {
        await createCompletedQuery({
          organization: context.org.id,
          datasource: datasource.id,
          language: "sql",
          query: sql,
          displayTitle: "Experiment Exposures",
          queryType: "experimentExposures",
          rawResult: rawRows,
          statistics: result.statistics,
        });
      } catch (e) {
        // Caching is best-effort; never fail the request because of it.
        logger.warn(e, "Failed to cache experiment exposures query");
      }
    }
  } catch (e) {
    res.status(200).json({
      ...emptyBody,
      sql,
      error: formatQueryExecutionErrorForApi(e),
    });
    return;
  }

  // The query fetches PAGE_SIZE + 1 rows so we can report a next page.
  const hasMore = rawRows.length > PAGE_SIZE;
  const pageRows = hasMore ? rawRows.slice(0, PAGE_SIZE) : rawRows;

  const { records, extraColumns } = shapeExposureRows({
    rows: pageRows,
    userIdType: exposureQuery.userIdType,
    dimensions,
    caseSensitive: integration.columnNamesAreCaseSensitive,
  });

  res.status(200).json({
    records,
    dimensions,
    extraColumns,
    hasMore,
    sql,
    cached,
    ranAt: ranAt.toISOString(),
  });
}
