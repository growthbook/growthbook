import type { Response } from "express";
import { snapToMinuteEnd, snapToMinuteStart } from "shared/dates";
import { SQL_ROW_LIMIT } from "shared/sql";
import type { ExperimentExposureRecord } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import { formatQueryExecutionErrorForApi, parseOptionalInt } from "shared/util";
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
  truncated: boolean;
  sql?: string;
  error?: string;
  cached?: boolean;
  /** When the query actually ran — the cached run's time on a cache hit. */
  ranAt?: string;
};

const BUFFER_SIZE = SQL_ROW_LIMIT;

export async function postExposures(
  req: AuthRequest<
    {
      startDate: string;
      endDate: string;
      rowFilters?: RowFilter[];
    },
    { id: string }
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

  const startDate = snapToMinuteStart(new Date(req.body.startDate));
  const endDate = snapToMinuteEnd(new Date(req.body.endDate));
  const windowMs = endDate.getTime() - startDate.getTime();
  if (windowMs <= 0) {
    context.throwBadRequestError("End date must be after start date.");
  }
  const dimensions = exposureQuery.dimensions || [];

  const rowFilters = req.body.rowFilters ?? [];

  const integration = getSourceIntegrationObject(context, datasource);

  const emptyBody = {
    records: [],
    dimensions,
    extraColumns: [],
    truncated: false,
  };

  // Outside the try below, whose catch turns throws into a 200 + error body.
  if (!integration.getExperimentExposuresQuery) {
    context.throwBadRequestError(
      "Exposure logs are not supported for this data source type.",
    );
    return;
  }

  let sql: string;
  try {
    sql = integration.getExperimentExposuresQuery({
      experimentId: experiment.id,
      experimentTrackingKey: experiment.trackingKey,
      exposureQuerySql: exposureQuery.query,
      userIdType: exposureQuery.userIdType,
      startDate,
      endDate,
      dimensions,
      rowFilters,
      limit: BUFFER_SIZE,
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
        dimensions,
        rowFilters,
        limit: BUFFER_SIZE,
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

  // The query fetches BUFFER_SIZE + 1 rows so the extra one reports truncation.
  const truncated = rawRows.length > BUFFER_SIZE;
  const bufferRows = truncated ? rawRows.slice(0, BUFFER_SIZE) : rawRows;

  const { records, extraColumns } = shapeExposureRows({
    rows: bufferRows,
    userIdType: exposureQuery.userIdType,
    dimensions,
    caseSensitive: integration.columnNamesAreCaseSensitive,
  });

  res.status(200).json({
    records,
    dimensions,
    extraColumns,
    truncated,
    sql,
    cached,
    ranAt: ranAt.toISOString(),
  });
}
