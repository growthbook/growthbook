import {
  BlockIntent,
  BuiltInDashboardTemplate,
  DataSourceInterface,
  FactTableInlineSpec,
  FactTableValue,
  MetricExplorationIntent,
  ProductAnalyticsDateRange,
  ProductAnalyticsDimension,
  FactTableExplorationIntent,
} from "back-end/src/enterprise/services/dashboard-templates/types";

const LAST_30_DAYS: ProductAnalyticsDateRange = {
  predefined: "last30Days",
  lookbackValue: 30,
  lookbackUnit: "day",
  startDate: null,
  endDate: null,
};

const LAST_9999_DAYS: ProductAnalyticsDateRange = {
  predefined: "customLookback",
  lookbackValue: 9999,
  lookbackUnit: "month",
  startDate: null,
  endDate: null,
};

const DATE_DIMENSION: ProductAnalyticsDimension[] = [
  { dimensionType: "date", column: "timestamp", dateGranularity: "auto" },
];

function dynamicDimension(
  column: string,
  maxValues: number,
): ProductAnalyticsDimension[] {
  return [{ dimensionType: "dynamic", column, maxValues }];
}

// Required columns for the canonical GA4 events fact table. The seeded
// `GA4 Events` fact table includes every one of these; orgs that built a
// renamed equivalent on the same datasource still match by column shape.
const GA4_EVENTS_REQUIRED_COLUMNS = [
  "event_name",
  "timestamp",
  "user_pseudo_id",
  "page_path",
  "engagement_time",
  "country",
  "device_category",
  "source",
  "medium",
];

// The narrower `GA4 Page Views` fact table omits `event_name` and
// `engagement_time`. We don't use it in Phase 1, but keep the shape
// declared so future intents can opt in.
const _GA4_PAGE_VIEWS_REQUIRED_COLUMNS = [
  "timestamp",
  "user_pseudo_id",
  "page_path",
  "country",
  "device_category",
];

// Inline fact-table-exploration value helpers
function ftValue(
  name: string,
  valueType: "count" | "unit_count" | "sum",
  rowFilters: FactTableValue["rowFilters"] = [],
  valueColumn: string | null = null,
): FactTableValue {
  return {
    type: "fact_table",
    name,
    rowFilters,
    valueType,
    valueColumn,
    unit: null,
  };
}

function eventNameFilter(eventName: string): FactTableValue["rowFilters"] {
  return [{ operator: "=", column: "event_name", values: [eventName] }];
}

// Intent helpers for the simple "fact-table-exploration trend by date" case.
function trendIntent({
  title,
  description,
  values,
}: {
  title: string;
  description?: string;
  values: FactTableValue[];
}): FactTableExplorationIntent {
  return {
    type: "fact-table-exploration",
    factTableMatch: { requiredColumns: GA4_EVENTS_REQUIRED_COLUMNS },
    values,
    dimensions: DATE_DIMENSION,
    chartType: "line",
    dateRange: LAST_9999_DAYS,
    block: { title, description },
  };
}

// Intent helpers for "top N by dimension" bar charts.
function topNIntent({
  title,
  description,
  dimensionColumn,
  maxValues,
  values,
}: {
  title: string;
  description?: string;
  dimensionColumn: string;
  maxValues: number;
  values: FactTableValue[];
}): FactTableExplorationIntent {
  return {
    type: "fact-table-exploration",
    factTableMatch: { requiredColumns: GA4_EVENTS_REQUIRED_COLUMNS },
    values,
    dimensions: dynamicDimension(dimensionColumn, maxValues),
    chartType: "horizontalBar",
    dateRange: LAST_9999_DAYS,
    block: { title, description },
  };
}

// Fact-table fallback used by metric-exploration intents that want to
// degrade gracefully when no matching fact metric exists on the org.
function fallbackTrend(values: FactTableValue[]): FactTableInlineSpec {
  return {
    factTableMatch: { requiredColumns: GA4_EVENTS_REQUIRED_COLUMNS },
    values,
    dimensions: DATE_DIMENSION,
    chartType: "line",
    dateRange: LAST_9999_DAYS,
  };
}

// Per-user mean intent: "<event> per user" -> mean(count of event rows
// per user). Falls back to a raw count trend of the same event when no
// matching fact metric exists.
function perUserMeanIntent({
  title,
  description,
  eventName,
}: {
  title: string;
  description?: string;
  eventName: string;
}): MetricExplorationIntent {
  return {
    type: "metric-exploration",
    matchSpec: {
      metricType: "mean",
      numerator: {
        column: "$$count",
        rowFilters: eventNameFilter(eventName),
      },
    },
    fallback: fallbackTrend([
      ftValue(
        `Total ${title.replace(" per User", "")}`,
        "count",
        eventNameFilter(eventName),
      ),
    ]),
    block: {
      title,
      description,
      chartType: "line",
      dimensions: DATE_DIMENSION,
      dateRange: LAST_9999_DAYS,
    },
  };
}

// Ratio intent: numerator count / denominator count. No fact-table
// fallback because fact-table-exploration's inline values don't natively
// express ratios.
function eventRatioIntent({
  title,
  description,
  numeratorEvent,
  denominatorEvent,
}: {
  title: string;
  description?: string;
  numeratorEvent: string;
  denominatorEvent: string;
}): MetricExplorationIntent {
  return {
    type: "metric-exploration",
    matchSpec: {
      metricType: "ratio",
      numerator: {
        column: "$$count",
        rowFilters: eventNameFilter(numeratorEvent),
      },
      denominator: {
        column: "$$count",
        rowFilters: eventNameFilter(denominatorEvent),
      },
    },
    fallback: null,
    block: {
      title,
      description,
      chartType: "line",
      dimensions: DATE_DIMENSION,
      dateRange: LAST_9999_DAYS,
    },
  };
}

const HEADER_MARKDOWN = `## GA4 Starter Dashboard

This dashboard was generated from your Google Analytics 4 BigQuery export. The blocks below combine fact metrics you've already defined with charts built directly from your events fact table. Edit any block to customize the chart or swap in your own metric.
`.trim();

const FOOTER_MARKDOWN = `### What's next?

- Edit individual blocks to tweak chart types, dimensions, or filters.
- Add new charts from the [SQL Explorer](/sql-explorer) or by saving a [Product Analytics](/product-analytics) exploration to this dashboard.
- Manage your fact metrics on the data source detail page.
`.trim();

function buildGA4Intents(_datasource: DataSourceInterface): BlockIntent[] {
  return [
    {
      type: "markdown",
      block: {
        title: "GA4 Starter Dashboard",
        content: HEADER_MARKDOWN,
      },
    },

    // Trend KPIs
    trendIntent({
      title: "Page Views",
      description: "Daily count of page_view events.",
      values: [ftValue("Page Views", "count", eventNameFilter("page_view"))],
    }),
    trendIntent({
      title: "Daily Active Users",
      description: "Distinct users with any tracked event per day.",
      values: [ftValue("Daily Active Users", "unit_count")],
    }),
    trendIntent({
      title: "Sessions",
      description: "Daily count of session_start events.",
      values: [ftValue("Sessions", "count", eventNameFilter("session_start"))],
    }),
    trendIntent({
      title: "New Users",
      description: "Distinct users firing first_visit per day.",
      values: [
        ftValue("New Users", "unit_count", eventNameFilter("first_visit")),
      ],
    }),

    // Match-only / fallback metric explorations
    {
      type: "metric-exploration",
      matchSpec: {
        metricType: "proportion",
        numerator: {
          column: "$$distinctUsers",
          rowFilters: [
            { operator: "saved_filter", values: ["Engaged Session"] },
          ],
        },
      },
      fallback: null,
      block: {
        title: "Engaged Users",
        description:
          "Share of users with at least one engaged session in the window.",
        chartType: "line",
        dimensions: DATE_DIMENSION,
        dateRange: LAST_9999_DAYS,
      },
    },
    perUserMeanIntent({
      title: "Page Views per User",
      description:
        "Average page_view events per user. Falls back to total page views when no per-user fact metric exists.",
      eventName: "page_view",
    }),
    perUserMeanIntent({
      title: "Sessions per User",
      description:
        "Average session_start events per user. Falls back to total sessions when no per-user fact metric exists.",
      eventName: "session_start",
    }),
    eventRatioIntent({
      title: "Pages per Session",
      description: "Page views per session_start event.",
      numeratorEvent: "page_view",
      denominatorEvent: "session_start",
    }),
    {
      // Session Duration: mean(engagement_time) / count(session_start).
      type: "metric-exploration",
      matchSpec: {
        metricType: "ratio",
        numerator: {
          column: "engagement_time",
          rowFilters: [],
        },
        denominator: {
          column: "$$count",
          rowFilters: eventNameFilter("session_start"),
        },
      },
      fallback: null,
      block: {
        title: "Session Duration",
        description: "Total engagement time divided by sessions.",
        chartType: "line",
        dimensions: DATE_DIMENSION,
        dateRange: LAST_9999_DAYS,
      },
    },

    // Top-N breakouts
    topNIntent({
      title: "Top Visited Pages",
      description: "Page views grouped by page_path (top 20).",
      dimensionColumn: "page_path",
      maxValues: 20,
      values: [ftValue("Page Views", "count", eventNameFilter("page_view"))],
    }),
    topNIntent({
      title: "Time on Page",
      description: "Sum of engagement_time grouped by page_path (top 20).",
      dimensionColumn: "page_path",
      maxValues: 20,
      values: [
        ftValue(
          "Total Time on Page",
          "sum",
          eventNameFilter("user_engagement"),
          "engagement_time",
        ),
      ],
    }),
    topNIntent({
      title: "Top Traffic Sources",
      description: "Sessions grouped by source (top 10).",
      dimensionColumn: "source",
      maxValues: 10,
      values: [ftValue("Sessions", "count", eventNameFilter("session_start"))],
    }),
    topNIntent({
      title: "Top Mediums",
      description: "Sessions grouped by medium (top 10).",
      dimensionColumn: "medium",
      maxValues: 10,
      values: [ftValue("Sessions", "count", eventNameFilter("session_start"))],
    }),
    topNIntent({
      title: "Top Countries",
      description: "Distinct users grouped by country (top 10).",
      dimensionColumn: "country",
      maxValues: 10,
      values: [ftValue("Users", "unit_count")],
    }),
    topNIntent({
      title: "Top Devices",
      description: "Distinct users grouped by device_category.",
      dimensionColumn: "device_category",
      maxValues: 10,
      values: [ftValue("Users", "unit_count")],
    }),

    {
      type: "markdown",
      block: {
        title: "",
        content: FOOTER_MARKDOWN,
      },
    },
  ];
}

export const ga4StarterTemplate: BuiltInDashboardTemplate = {
  id: "ga4-starter",
  name: "GA4 Starter",
  description:
    "Pre-built dashboard for Google Analytics 4 BigQuery datasources. Combines fact metrics from your org with charts built directly off your GA4 events fact table.",
  isEligible: ({ datasource }) => {
    if (datasource.type !== "bigquery") return false;
    if (datasource.settings?.schemaFormat !== "ga4") return false;
    return true;
  },
  build: ({ datasource }) => ({
    title: "GA4 Starter Dashboard",
    blocks: buildGA4Intents(datasource),
  }),
};
