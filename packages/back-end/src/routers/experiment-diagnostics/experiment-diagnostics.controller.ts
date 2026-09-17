import type { Response } from "express";
import type {
  ExperimentDiagnosticsAggregatedSummary,
  ExperimentDiagnosticsRecord,
} from "shared/validators";
import { parseIntWithDefaultCapped } from "shared/util";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import {
  getSourceIntegrationObject,
  runExperimentDiagnosticsSummaryQuery,
  runExperimentDiagnosticsRecordsQuery,
} from "back-end/src/services/datasource";

type SummaryResponse = { summary: ExperimentDiagnosticsAggregatedSummary };
type RecordsResponse = { records: ExperimentDiagnosticsRecord[] };

const MAX_SUMMARY_WINDOW_DAYS = 30;
const MAX_RECORDS_WINDOW_HOURS = 24 * 7;
const PAGE_SIZE = 100;

export async function getSummary(
  req: AuthRequest<
    unknown,
    { id: string },
    { startDate: string; endDate: string; dimension?: string }
  >,
  res: Response<SummaryResponse>,
) {
  const context = getContextFromReq(req);

  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    res.status(404).json({ summary: emptySummary() } as SummaryResponse);
    return;
  }

  if (!experiment.datasource) {
    res.status(400).json({ summary: emptySummary() } as SummaryResponse);
    return;
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    res.status(404).json({ summary: emptySummary() } as SummaryResponse);
    return;
  }

  if (!context.permissions.canRunHealthQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const exposureQuery = getExposureQuery(
    datasource,
    experiment.exposureQueryId || "",
  );

  // Validate the dimension param against the exposure query's dimensions
  const dimension = req.query.dimension;
  if (dimension && !(exposureQuery.dimensions || []).includes(dimension)) {
    context.throwBadRequestError(
      `Dimension "${dimension}" is not available on this exposure query.`,
    );
  }

  const startDate = new Date(req.query.startDate);
  const endDate = new Date(req.query.endDate);
  const windowMs = endDate.getTime() - startDate.getTime();

  if (windowMs <= 0) {
    context.throwBadRequestError("End date must be after start date.");
  }
  if (windowMs > MAX_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    context.throwBadRequestError(
      `Summary time window cannot exceed ${MAX_SUMMARY_WINDOW_DAYS} days.`,
    );
  }

  const integration = getSourceIntegrationObject(context, datasource);
  const { rows } = await runExperimentDiagnosticsSummaryQuery(integration, {
    experimentTrackingKey: experiment.trackingKey,
    exposureQuerySql: exposureQuery.query,
    userIdType: exposureQuery.userIdType,
    startDate,
    endDate,
    dimension,
  });

  const summary = aggregateSummaryRows(rows, !!dimension);
  res.status(200).json({ summary });
}

export async function getRecords(
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
  res: Response<RecordsResponse>,
) {
  const context = getContextFromReq(req);

  const experiment = await getExperimentById(context, req.params.id);
  if (!experiment) {
    res.status(404).json({ records: [] });
    return;
  }

  if (!experiment.datasource) {
    res.status(400).json({ records: [] });
    return;
  }

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    res.status(404).json({ records: [] });
    return;
  }

  if (!context.permissions.canRunHealthQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const exposureQuery = getExposureQuery(
    datasource,
    experiment.exposureQueryId || "",
  );

  const startDate = new Date(req.query.startDate);
  const endDate = new Date(req.query.endDate);
  const windowMs = endDate.getTime() - startDate.getTime();

  if (windowMs <= 0) {
    context.throwBadRequestError("End date must be after start date.");
  }
  if (windowMs > MAX_RECORDS_WINDOW_HOURS * 60 * 60 * 1000) {
    context.throwBadRequestError(
      `Records time window cannot exceed ${MAX_RECORDS_WINDOW_HOURS} hours.`,
    );
  }

  const page = parseIntWithDefaultCapped(req.query.page, 1, 1_000);
  const offset = (page - 1) * PAGE_SIZE;

  // Parse dimension filters from JSON string
  let dimensionFilters: Record<string, string> | undefined;
  if (req.query.dimensionFilters) {
    try {
      const parsed: unknown = JSON.parse(req.query.dimensionFilters);
      if (typeof parsed === "object" && parsed !== null) {
        dimensionFilters = {};
        for (const [k, v] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (typeof v === "string") dimensionFilters[k] = v;
        }
      }
    } catch {
      // Ignore malformed JSON — treat as no dimension filters
    }
  }

  const integration = getSourceIntegrationObject(context, datasource);
  const { rows } = await runExperimentDiagnosticsRecordsQuery(integration, {
    experimentTrackingKey: experiment.trackingKey,
    exposureQuerySql: exposureQuery.query,
    userIdType: exposureQuery.userIdType,
    startDate,
    endDate,
    userId: req.query.userId,
    variationId: req.query.variationId,
    dimensions: exposureQuery.dimensions || [],
    dimensionFilters,
    limit: PAGE_SIZE,
    offset,
  });

  const records: ExperimentDiagnosticsRecord[] = rows.map((row) => {
    const dimensions: Record<string, string | null> = {};
    for (const dim of exposureQuery.dimensions || []) {
      dimensions[dim] = row[dim] != null ? String(row[dim]) : null;
    }
    return {
      timestamp: normalizeTimestamp(row.timestamp),
      userId: row.user_id,
      variationId: row.variation_id,
      dimensions,
    };
  });

  res.status(200).json({ records });
}

function aggregateSummaryRows(
  rows: {
    day: string;
    variation_id: string;
    dimension_value?: string;
    exposure_count: string;
    user_count: string;
  }[],
  hasDimension: boolean,
): ExperimentDiagnosticsAggregatedSummary {
  let totalExposures = 0;
  let totalUsers = 0;
  const variationMap = new Map<
    string,
    { exposureCount: number; userCount: number }
  >();
  const dayMap = new Map<string, number>();
  const dimMap = new Map<
    string,
    { exposureCount: number; userCount: number }
  >();
  const varDimRows: {
    variationId: string;
    dimensionValue: string;
    exposureCount: number;
    userCount: number;
  }[] = [];

  for (const row of rows) {
    const exposures = Number(row.exposure_count) || 0;
    const users = Number(row.user_count) || 0;

    totalExposures += exposures;
    totalUsers += users;

    const existing = variationMap.get(row.variation_id);
    if (existing) {
      existing.exposureCount += exposures;
      existing.userCount += users;
    } else {
      variationMap.set(row.variation_id, {
        exposureCount: exposures,
        userCount: users,
      });
    }

    if (hasDimension && row.dimension_value != null) {
      const dimVal = row.dimension_value;
      const dimExisting = dimMap.get(dimVal);
      if (dimExisting) {
        dimExisting.exposureCount += exposures;
        dimExisting.userCount += users;
      } else {
        dimMap.set(dimVal, { exposureCount: exposures, userCount: users });
      }
      varDimRows.push({
        variationId: row.variation_id,
        dimensionValue: dimVal,
        exposureCount: exposures,
        userCount: users,
      });
    } else {
      dayMap.set(row.day, (dayMap.get(row.day) ?? 0) + exposures);
    }
  }

  const variationBreakdown = Array.from(variationMap.entries())
    .map(([variationId, data]) => ({ variationId, ...data }))
    .sort((a, b) => a.variationId.localeCompare(b.variationId));

  const dailyTrend = Array.from(dayMap.entries())
    .map(([date, exposureCount]) => ({ date, exposureCount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const result: ExperimentDiagnosticsAggregatedSummary = {
    totalExposures,
    totalUsers,
    variationBreakdown,
    dailyTrend,
  };

  if (hasDimension) {
    result.dimensionBreakdown = Array.from(dimMap.entries())
      .map(([dimensionValue, data]) => ({ dimensionValue, ...data }))
      .sort((a, b) => b.exposureCount - a.exposureCount);

    result.variationDimensionBreakdown = varDimRows.sort((a, b) =>
      a.variationId === b.variationId
        ? b.exposureCount - a.exposureCount
        : a.variationId.localeCompare(b.variationId),
    );
  }

  return result;
}

function emptySummary(): ExperimentDiagnosticsAggregatedSummary {
  return {
    totalExposures: 0,
    totalUsers: 0,
    variationBreakdown: [],
    dailyTrend: [],
  };
}

function normalizeTimestamp(value: string): string {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
