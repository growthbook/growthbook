// Minimal types for SeriesAnalysis
// TODO: Replace with real types when backend is implemented

export interface SeriesDataPoint {
  date: Date;
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
}

export interface SeriesAnalysisGroup {
  group: string;
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
  dates?: SeriesDataPoint[];
}

export interface SeriesAnalysisResult {
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
  dates?: SeriesDataPoint[];
  groups?: SeriesAnalysisGroup[];
}

export interface SeriesAnalysis {
  id: string;
  organization: string;
  metric: string;
  factMetricId: string;
  valueType: "sum" | "avg";
  status: "pending" | "running" | "succeeded" | "error" | "queued";
  result?: SeriesAnalysisResult;
  error?: string;
  settings: any;
  dateCreated: Date;
  dateUpdated: Date;
  runStarted: Date | null;
}

/**
 * Converts series analysis data to chart format
 * TODO: Implement when backend returns real data
 */
export function getSeriesChartData(
  analysis: SeriesAnalysis | null,
  valueType: "sum" | "avg",
): { x: Date; y: number }[] {
  if (!analysis?.result?.dates) return [];
  return analysis.result.dates.map((d) => ({
    x: d.date,
    y: valueType === "sum" ? (d.numerator ?? d.mean * d.units) : d.mean,
  }));
}

/**
 * Converts series analysis data to table format
 * TODO: Implement when backend returns real data
 */
export function getSeriesTableData(
  analysis: SeriesAnalysis | null,
  valueType: "sum" | "avg",
): Array<{
  date: Date;
  mean: number;
  units: number;
  value: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
}> {
  if (!analysis?.result?.dates) return [];
  return analysis.result.dates.map((d) => ({
    date: d.date,
    mean: d.mean,
    units: d.units,
    value: valueType === "sum" ? (d.numerator ?? d.mean * d.units) : d.mean,
    stddev: d.stddev,
    numerator: d.numerator,
    denominator: d.denominator,
  }));
}

/**
 * Gets grouped data from analysis
 * TODO: Implement when backend returns real data
 */
export function getSeriesGroups(
  analysis: SeriesAnalysis | null,
): SeriesAnalysisGroup[] {
  return analysis?.result?.groups ?? [];
}

/**
 * Gets histogram data from analysis
 * TODO: Implement when backend returns real data
 */
export function getSeriesHistogram(analysis: SeriesAnalysis | null): any[] {
  return [];
}
