import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FactMetricInterface } from "shared/types/fact-table";
import {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import { getDateGranularity, getEffectiveMetricValue } from "shared/enterprise";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  CacheOption,
  useExploreData,
} from "@/enterprise/components/ProductAnalytics/useExploreData";
import {
  getMetricPreviewConfig,
  getMetricPreviewUnits,
} from "@/components/FactTables/MetricEditor/metricPreview";
import { pollDelayForExploration } from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/ProductAnalyticsExplorerBlock";
import { MetricSeriesPoint } from "./impactData";

// Scaled impact exists only for these, so they're the only ones charted
const CHARTABLE_TYPES: FactMetricInterface["metricType"][] = [
  "mean",
  "proportion",
];

export type MetricSeriesStatus =
  | "unsupported"
  | "loading"
  | "not-run"
  | "running"
  | "error"
  | "success";

const DAY_MS = 24 * 60 * 60 * 1000;

function nextBucket(
  date: Date,
  granularity: ReturnType<typeof getDateGranularity>,
): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (granularity === "year") return new Date(Date.UTC(y + 1, 0, 1));
  if (granularity === "month") return new Date(Date.UTC(y, m + 1, 1));
  const step = { week: 7 * DAY_MS, day: DAY_MS, hour: DAY_MS / 24 }[
    granularity
  ];
  return new Date(date.getTime() + step);
}

function toSeries(
  exploration: ProductAnalyticsExploration,
  config: ExplorationConfig,
): MetricSeriesPoint[] {
  const perUnit = config.showAs === "per_unit";
  const start = new Date(exploration.dateStart);
  const end = new Date(exploration.dateEnd);
  // Ranges over ~3 months come back monthly even when daily is requested
  const granularity = getDateGranularity("day", {
    startDate: start,
    endDate: end,
  });
  return exploration.result.rows
    .flatMap((row) => {
      const day = String(row.dimensions[0] ?? "").slice(0, 10);
      const cell = row.values?.[0];
      const date = new Date(`${day}T00:00:00Z`);
      if (!cell || isNaN(date.getTime())) return [];
      // Days of the window this bucket covers, to turn its total into a daily one
      const days = Math.max(
        (Math.min(nextBucket(date, granularity).getTime(), end.getTime()) -
          Math.max(date.getTime(), start.getTime())) /
          DAY_MS,
        1 / 24,
      );
      return [
        {
          date,
          value: getEffectiveMetricValue(cell, {
            showAs: perUnit ? "per_unit" : "total",
            isRatio: false,
          }),
          total: (cell.numerator ?? 0) / days,
        },
      ];
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Reads the Metric Explorer's cache, querying the warehouse when it's empty
export function useMetricSeries(
  metric: FactMetricInterface | null,
  dateRange: ExplorationDateRange,
) {
  const { getFactTableById, getDatasourceById } = useDefinitions();
  const permissions = usePermissionsUtil();
  const { fetchData } = useExploreData();

  const config = useMemo<ExplorationConfig | null>(() => {
    if (!metric || !CHARTABLE_TYPES.includes(metric.metricType)) return null;
    const units = getMetricPreviewUnits(metric, getFactTableById);
    return {
      ...getMetricPreviewConfig(metric, {
        draft: false,
        unit: units.numerator[0] ?? null,
        denominatorUnit: units.denominator[0] ?? null,
        dateRange,
      }),
      chartType: "line",
      dimensions: [
        { dimensionType: "date", column: "date", dateGranularity: "day" },
      ],
    };
  }, [metric, dateRange, getFactTableById]);
  const configKey = config ? JSON.stringify(config) : "";
  const datasource = metric ? getDatasourceById(metric.datasource) : null;
  const canRun = !!datasource && permissions.canRunMetricQueries(datasource);

  const [state, setState] = useState<{
    key: string;
    pending: boolean;
    exploration: ProductAnalyticsExploration | null;
    error: string | null;
  } | null>(null);
  // Drops responses for a config the user has since changed
  const latestKey = useRef(configKey);
  latestKey.current = configKey;

  const load = useCallback(
    async (cache: CacheOption) => {
      if (!config) return;
      const key = JSON.stringify(config);
      setState({ key, pending: true, exploration: null, error: null });
      let { data, error } = await fetchData(config, { cache });
      if (cache === "required" && !data && !error && canRun) {
        ({ data, error } = await fetchData(config, { cache: "preferred" }));
      }
      if (latestKey.current === key) {
        setState({ key, pending: false, exploration: data, error });
      }
    },
    [config, fetchData, canRun],
  );

  useEffect(() => {
    load("required");
  }, [load]);

  const current = state?.key === configKey ? state : null;
  const runningId =
    current?.exploration?.status === "running" ? current.exploration.id : "";
  const { data: polled } = useApi<{ exploration: ProductAnalyticsExploration }>(
    `/product-analytics/exploration/${runningId}`,
    {
      shouldRun: () => !!runningId,
      refreshInterval: (latest) => pollDelayForExploration(latest?.exploration),
    },
  );
  const exploration =
    runningId && polled?.exploration?.id === runningId
      ? polled.exploration
      : (current?.exploration ?? null);

  let status: MetricSeriesStatus;
  if (!config) status = "unsupported";
  else if (!current || current.pending) status = "loading";
  else if (current.error || exploration?.status === "error") status = "error";
  else if (!exploration) status = "not-run";
  else if (exploration.status === "running") status = "running";
  else status = "success";

  const series = useMemo(
    () =>
      status === "success" && exploration && config
        ? toSeries(exploration, config)
        : null,
    [status, exploration, config],
  );

  return {
    status,
    series,
    error: current?.error ?? exploration?.error ?? null,
    lastUpdated: exploration?.dateUpdated ?? null,
    canRun,
    run: () => load("never"),
  };
}
