const PRESET_DAYS: Record<string, string> = {
  "30": "last30Days",
  "90": "last90Days",
  "365": "last12Months",
};

// Where an old /dashboard link goes: Impact when it named a metric, else Health
export function getLegacyDashboardRedirect(
  query: Record<string, string | string[] | undefined>,
): string {
  const get = (key: string) => {
    const value = query[key];
    return typeof value === "string" && value ? value : null;
  };
  const params = new URLSearchParams();
  const range = get("dateRange");
  const start = get("startDate");
  const end = get("endDate");
  if (range === "custom" && start && end) {
    params.set("range", "customDateRange");
    params.set("start", start);
    params.set("end", end);
  } else if (range && range !== "90" && Number(range) > 0) {
    if (PRESET_DAYS[range]) {
      params.set("range", PRESET_DAYS[range]);
    } else {
      params.set("range", "customLookback");
      params.set("lookback", range);
      params.set("unit", "day");
    }
  }

  const metric = get("selectedMetric");
  const search = get("q");
  if (metric) {
    params.set("metric", metric);
    if (search) params.set("q", search);
  }
  const path = metric ? "/insights/impact" : "/insights/health";
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}
