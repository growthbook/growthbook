// Types for Explore API Response
// These types define the structure of data returned from the explore API endpoint

/**
 * Data point for time series (line chart)
 */
export interface ExploreDataPoint {
  date: string; // ISO date string
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
}

/**
 * Group for line chart with time series data per group
 */
export interface ExploreLineChartGroup {
  group: string;
  dates: ExploreDataPoint[];
}

/**
 * Series for line chart (timeseries visualization)
 * Contains either:
 * - An array of data points over time (when no groupBy)
 * - An array of groups, each with their own dates (when groupBy is used)
 */
export interface ExploreLineChartSeries {
  id: string;
  title: string;
  data?: ExploreDataPoint[]; // Used when no groupBy
  groups?: ExploreLineChartGroup[]; // Used when groupBy is specified
}

/**
 * Series for bar chart (grouped visualization)
 * Contains grouped data with amounts
 */
export interface ExploreBarChartSeries {
  id: string;
  title: string;
  groups: Array<{
    group: string;
    amount: number;
    units: number;
    mean: number;
    stddev?: number;
    numerator?: number;
    denominator?: number;
  }>;
}

/**
 * Response for big number visualization
 * Contains a single aggregated value
 */
export interface ExploreBigNumberResponse {
  value: number;
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
}

/**
 * Union type for all explore response types
 */
export type ExploreQueryResponse =
  | {
      type: "linechart";
      series: ExploreLineChartSeries[];
    }
  | {
      type: "bar";
      series: ExploreBarChartSeries[];
    }
  | {
      type: "bigNumber";
      data: ExploreBigNumberResponse;
    };
