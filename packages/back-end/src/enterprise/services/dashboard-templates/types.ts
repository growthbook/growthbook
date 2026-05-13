import {
  DashboardBlockType,
  BlockLayout,
  MarkdownBlockInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
} from "shared/enterprise";
import {
  chartTypes,
  dateRangePredefined,
  dimensionValidator,
  factMetricValidator,
  FactTableExplorationConfig,
  MetricExplorationConfig,
  ExplorationConfig,
} from "shared/validators";
import { z } from "zod";
import {
  FactMetricInterface,
  FactTableInterface,
  RowFilter,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

// Re-export aliases so template definitions can stay tidy
export type ProductAnalyticsChartType = (typeof chartTypes)[number];
export type DatePredefined = (typeof dateRangePredefined)[number];
export type ProductAnalyticsDimension = z.infer<typeof dimensionValidator>;
export type ProductAnalyticsDateRange = ExplorationConfig["dateRange"];
// Concrete FactTableValue used in inline fact-table-exploration configs
export type FactTableValue =
  FactTableExplorationConfig["dataset"]["values"][number];
export type FactMetricType = z.infer<typeof factMetricValidator>["metricType"];

// Canonical fact-metric definition shape used both for matching and for
// generating fact-table fallbacks. We deliberately constrain it to the
// fields that actually differentiate metric semantics: aggregation type,
// numerator and (optional) denominator column references with row filters.
export type FactMetricMatchSpec = {
  metricType: FactMetricType;
  numerator: { column: string; rowFilters: RowFilter[] };
  denominator?: { column: string; rowFilters: RowFilter[] };
};

// Fact-table column-shape requirement. A table is a match when its
// non-deleted columns contain every name in `requiredColumns`.
export type FactTableMatch = {
  requiredColumns: string[];
};

// Inline fact-table-exploration spec used by both:
// 1) `fact-table-exploration` intents directly
// 2) `metric-exploration` intents as an optional fallback when no fact
//    metric in the org matches the intent's matchSpec
export type FactTableInlineSpec = {
  factTableMatch: FactTableMatch;
  values: FactTableValue[];
  dimensions: ProductAnalyticsDimension[];
  chartType: ProductAnalyticsChartType;
  dateRange: ProductAnalyticsDateRange;
};

type CommonBlockOverrides = {
  title: string;
  description?: string;
  layout?: BlockLayout;
};

export type MetricExplorationBlockOverrides = CommonBlockOverrides & {
  chartType: ProductAnalyticsChartType;
  dimensions: ProductAnalyticsDimension[];
  dateRange: ProductAnalyticsDateRange;
};

export type FactTableExplorationBlockOverrides = CommonBlockOverrides;
export type MarkdownBlockOverrides = Pick<
  MarkdownBlockInterface,
  "title" | "content"
> & { description?: string; layout?: BlockLayout };

export type MarkdownIntent = {
  type: "markdown";
  block: MarkdownBlockOverrides;
};

export type MetricExplorationIntent = {
  type: "metric-exploration";
  matchSpec: FactMetricMatchSpec;
  fallback?: FactTableInlineSpec | null;
  block: MetricExplorationBlockOverrides;
};

export type FactTableExplorationIntent = {
  type: "fact-table-exploration";
  factTableMatch: FactTableMatch;
  values: FactTableValue[];
  dimensions: ProductAnalyticsDimension[];
  chartType: ProductAnalyticsChartType;
  dateRange: ProductAnalyticsDateRange;
  block: FactTableExplorationBlockOverrides;
};

export type BlockIntent =
  | MarkdownIntent
  | MetricExplorationIntent
  | FactTableExplorationIntent;

export type BlockIntentType = BlockIntent["type"];

// Public-facing template metadata returned to the frontend (no internals)
export type DashboardTemplateMetadata = {
  id: string;
  name: string;
  description: string;
};

// Context the template's `build` and `isEligible` receive
export type TemplateBuildContext = {
  datasource: DataSourceInterface;
};

export type BuiltInDashboardTemplate = {
  id: string;
  name: string;
  description: string;
  // Cheap synchronous check used to gate the template suggestion banner.
  // Should rely only on the datasource shape so it can be evaluated without
  // loading the org's fact tables/metrics.
  isEligible: (ctx: TemplateBuildContext) => boolean;
  // Produce the ordered intent list. Pure with respect to the datasource;
  // no DB access. Matching/resolution happens later in the instantiator.
  build: (ctx: TemplateBuildContext) => {
    title: string;
    blocks: BlockIntent[];
  };
};

// Re-exports the consumers most often need
export type {
  DashboardBlockType,
  BlockLayout,
  MarkdownBlockInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceInterface,
  FactMetricInterface,
  FactTableInterface,
  RowFilter,
  MetricExplorationConfig,
  FactTableExplorationConfig,
};
