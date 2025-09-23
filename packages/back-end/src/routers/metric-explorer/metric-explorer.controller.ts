import { getValidDate } from "shared/dates";
import type { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  MetricExplorerCachedResult,
  MetricExplorerConfig,
} from "back-end/types/metric-explorer";

export const postGetCachedResult = async (
  req: AuthRequest<{ config: MetricExplorerConfig }>,
  res: Response<{
    status: 200;
    score: number;
    result: MetricExplorerCachedResult | null;
  }>,
) => {
  const context = getContextFromReq(req);

  // 1. Get all cached results that might match (same datasource, at least 1 matching metric id)
  const results = await context.models.metricExplorerCache.getRecentByConfig(
    req.body.config,
  );

  // 2. Score them based on how well they match the config
  let bestScore = 0;
  let bestResult: MetricExplorerCachedResult | null = null;

  for (const r of results) {
    // If there's a requested dimension, that's a hard requirement
    if (req.body.config.dimension) {
      if (r.config.dimension !== req.body.config.dimension) {
        continue;
      }
    }

    // If there are filters, require them to match
    if (req.body.config.filters.length > 0) {
      const savedFilters = req.body.config.filters.filter(
        (f) => f.filterType === "saved",
      );
      const cachedSavedFilters = r.config.filters.filter(
        (f) => f.filterType === "saved",
      );
      // All saved filters must exactly match
      if (cachedSavedFilters.length !== savedFilters.length) {
        continue;
      }
      if (
        !savedFilters.every((f) =>
          cachedSavedFilters.some((rf) => rf.id === f.id),
        )
      ) {
        continue;
      }

      // For inline filters, we can ignore them if the column matches the cached result's dimension
      const inlineFilters = req.body.config.filters.filter(
        (f) =>
          f.filterType === "inline" && f.column !== req.body.config.dimension,
      );
      const cachedInlineFilters = r.config.filters.filter(
        (f) => f.filterType === "inline" && f.column !== r.config.dimension,
      );

      // There must be no extra inline filters
      if (cachedInlineFilters.length !== inlineFilters.length) {
        continue;
      }
      // Every inline filter must exactly match
      const cachedHashes = new Set(
        cachedInlineFilters.map((f) => JSON.stringify(f)),
      );
      if (!inlineFilters.every((f) => cachedHashes.has(JSON.stringify(f)))) {
        continue;
      }
    }

    const scores: number[] = [];

    // How much of the date range is covered
    scores.push(
      getDateRangeRelevanceScore(
        getDateRange(req.body.config),
        getDateRange(r.config, getValidDate(r.dateCreated)),
      ),
    );

    // If there is enough date granularity
    if (req.body.config.dateGranularity && r.config.dateGranularity) {
      const granularityScoreMap = {
        "1hour": 1,
        "6hours": 2,
        "1day": 4,
      };

      const rawScore =
        granularityScoreMap[req.body.config.dateGranularity] /
        granularityScoreMap[r.config.dateGranularity];
      scores.push(Math.min(1, rawScore));
    }

    const score = Math.min(...scores);
    if (score > bestScore) {
      bestScore = score;
      bestResult = r;
    }
  }

  res.status(200).json({
    status: 200,
    score: bestScore,
    result: bestResult,
  });
};

function getDateRangeRelevanceScore(
  requested: { start: Date; end: Date } | null,
  actual: { start: Date; end: Date } | null,
): number {
  if (!requested || !actual) return 0;

  // Return 0 when none of the requested range is covered
  // Return 1 when the full requested range is covered
  // Return a value between 0 and 1 based on the overlap otherwise
  const latestStart =
    requested.start > actual.start ? requested.start : actual.start;
  const earliestEnd = requested.end < actual.end ? requested.end : actual.end;

  if (latestStart >= earliestEnd) {
    return 0;
  }

  const overlap = earliestEnd.getTime() - latestStart.getTime();
  const requestedRange = requested.end.getTime() - requested.start.getTime();

  return overlap / requestedRange;
}

function getDateRange(
  config: MetricExplorerConfig,
  baseDate: Date = new Date(),
): { start: Date; end: Date } | null {
  const end = getValidDate(baseDate);
  const start = new Date(end);
  switch (config.dateRange) {
    case "last30d":
      start.setDate(end.getDate() - 30);
      return { start, end };
    case "last7d":
      start.setDate(end.getDate() - 7);
      return { start, end };
    case "last24h":
      start.setDate(end.getDate() - 1);
      return { start, end };
    case "custom":
      if (config.customDateRange?.start && config.customDateRange?.end) {
        return {
          start: getValidDate(config.customDateRange.start),
          end: getValidDate(config.customDateRange.end),
        };
      }
      return null;
  }
}
