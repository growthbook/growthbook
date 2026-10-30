import type { Response } from "express";
import { getValidDate, snapToMinuteEnd, snapToMinuteStart } from "shared/dates";
import { SQL_ROW_LIMIT } from "shared/sql";
import { getActivePhaseIndex } from "shared/experiments";
import type { ExperimentExposureRecord } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import type {
  ExperimentExposuresQueryParams,
  ResolvedExposureQuery,
} from "shared/types/integrations";
import {
  formatQueryExecutionErrorForApi,
  getExposureQueryExperimentIdColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
  parseOptionalInt,
  resolveExposureQueryForAnalysis,
} from "shared/util";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  createCompletedQuery,
  getLatestQueryByCacheKey,
  getRecentQuery,
} from "back-end/src/models/QueryModel";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import {
  getSourceIntegrationObject,
  runExperimentExposuresQuery,
} from "back-end/src/services/datasource";
import {
  getExposuresCacheKey,
  shapeExposureRows,
  type ExposuresWindow,
} from "back-end/src/services/experiment-exposures";
import { logger } from "back-end/src/util/logger";

type ExposuresResponse = {
  records: ExperimentExposureRecord[];
  dimensions: string[];
  extraColumns: string[];
  truncated: boolean;
  /** A filterable value was shortened, so the client must not filter locally. */
  valuesTruncated?: boolean;
  sql?: string;
  error?: string;
  cached?: boolean;
  /** When the query actually ran — the cached run's time on a cache hit. */
  ranAt?: string;
  startDate?: string;
  endDate?: string;
  /** A `cache: "required"` read found nothing, and nothing was run. */
  noCachedResult?: boolean;
};

const BUFFER_SIZE = SQL_ROW_LIMIT;

export async function postExposures(
  req: AuthRequest<
    {
      startDate: string;
      endDate: string;
      /** The window ends at "now" and moves with the clock (a lookback). */
      rollingWindow?: boolean;
      rowFilters?: RowFilter[];
      /** Phase to compile `{{phase.index}}` for; defaults to the active one. */
      phase?: number;
      cache?: "preferred" | "required" | "never";
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
      "This experiment is not connected to a Data Source.",
    );
    return;
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    context.throwNotFoundError("Data Source not found");
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

  // The logs have to read the identifier the experiment analyzes on, not the
  // query's frozen legacy one. Throws when the query stopped declaring it.
  let resolvedExposureQuery: ResolvedExposureQuery;
  try {
    resolvedExposureQuery = resolveExposureQueryForAnalysis(
      exposureQuery,
      experiment.exposureQueryIdentifierType,
    );
  } catch (e) {
    context.throwBadRequestError(
      e instanceof Error ? e.message : "Could not resolve the identifier type.",
    );
    return;
  }

  const windowMs =
    new Date(req.body.endDate).getTime() -
    new Date(req.body.startDate).getTime();
  if (windowMs <= 0) {
    context.throwBadRequestError("End date must be after start date.");
  }

  const phaseIndex = req.body.phase ?? getActivePhaseIndex(experiment);
  if (phaseIndex >= experiment.phases.length) {
    context.throwBadRequestError("Phase not found.");
    return;
  }

  const startDate = snapToMinuteStart(new Date(req.body.startDate));
  const endDate = snapToMinuteEnd(new Date(req.body.endDate));
  const window: ExposuresWindow = req.body.rollingWindow
    ? { kind: "rolling", windowMs }
    : { kind: "fixed", startDate, endDate };
  const dimensions = exposureQuery.dimensions || [];

  const rowFilters = req.body.rowFilters ?? [];
  const cache = req.body.cache ?? "preferred";

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
      "Exposure logs are not supported for this Data Source type.",
    );
    return;
  }

  const queryParams: ExperimentExposuresQueryParams = {
    experimentId: experiment.id,
    experimentTrackingKey: experiment.trackingKey,
    exposureQuery: resolvedExposureQuery,
    startDate,
    endDate,
    dimensions,
    phase: { index: String(phaseIndex) },
    customFields: experiment.customFields,
    rowFilters,
    limit: BUFFER_SIZE,
  };

  let sql: string;
  try {
    sql = integration.getExperimentExposuresQuery(queryParams);
  } catch (e) {
    res.status(200).json({
      ...emptyBody,
      error: formatQueryExecutionErrorForApi(e),
    });
    return;
  }

  const columnMapping = {
    identifierColumn: getExposureQueryIdentifierColumn(
      resolvedExposureQuery,
      resolvedExposureQuery.identifierType,
    ),
    timestampColumn: getExposureQueryTimestampColumn(resolvedExposureQuery),
    variationIdColumn: getExposureQueryVariationIdColumn(resolvedExposureQuery),
  };
  const cacheKey = getExposuresCacheKey({
    experimentId: experiment.id,
    experimentTrackingKey: experiment.trackingKey,
    exposureQueryId: exposureQuery.id,
    exposureQuerySql: resolvedExposureQuery.query,
    identifierType: resolvedExposureQuery.identifierType,
    columnMapping: {
      ...columnMapping,
      experimentIdColumn: getExposureQueryExperimentIdColumn(
        resolvedExposureQuery,
      ),
    },
    dimensions,
    window,
    rowFilters,
    limit: BUFFER_SIZE,
    phase: queryParams.phase,
    customFields: queryParams.customFields,
  });
  const cacheTTLMins = parseOptionalInt(datasource.settings?.queryCacheTTLMins);

  let rawRows: Record<string, unknown>[];
  let cached = false;
  let ranAt = new Date();
  let ranSql = sql;
  let ranWindow: { startDate: Date; endDate: Date } | undefined = {
    startDate,
    endDate,
  };
  try {
    const recent =
      cache === "required"
        ? await getLatestQueryByCacheKey(
            context,
            datasource.id,
            "experimentExposures",
            cacheKey,
            cacheTTLMins,
          )
        : cache === "preferred"
          ? await getRecentQuery(
              context.org.id,
              datasource.id,
              sql,
              cacheTTLMins,
            )
          : null;

    if (cache === "preferred" && recent?.hasChunkedResults) {
      await context.models.sqlResultChunks.addResultsToQueries([recent]);
    }
    if (recent?.status === "succeeded" && recent.rawResult) {
      rawRows = recent.rawResult;
      cached = true;
      if (recent.createdAt) ranAt = recent.createdAt;
      ranSql = recent.query;
      const cachedWindow = recent.resolvedWindow;
      ranWindow =
        cachedWindow?.startDate && cachedWindow?.endDate
          ? cachedWindow
          : undefined;
    } else if (cache === "required") {
      res.status(200).json({ ...emptyBody, sql, noCachedResult: true });
      return;
    } else {
      const result = await runExperimentExposuresQuery(
        integration,
        queryParams,
      );
      rawRows = result.rows;
      ranSql = result.sql;
      try {
        await createCompletedQuery(context, {
          datasource: datasource.id,
          language: "sql",
          query: ranSql,
          displayTitle: "Experiment Exposures",
          queryType: "experimentExposures",
          rawResult: rawRows,
          statistics: result.statistics,
          cacheKey,
          resolvedWindow: { startDate, endDate },
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

  const { records, extraColumns, valuesTruncated } = shapeExposureRows({
    rows: bufferRows,
    ...columnMapping,
    dimensions,
    caseSensitive: integration.columnNamesAreCaseSensitive,
  });

  res.status(200).json({
    records,
    dimensions,
    extraColumns,
    truncated,
    valuesTruncated,
    sql: ranSql,
    cached,
    ranAt: ranAt.toISOString(),
    startDate: ranWindow && getValidDate(ranWindow.startDate).toISOString(),
    endDate: ranWindow && getValidDate(ranWindow.endDate).toISOString(),
  });
}
