import { useState, useEffect, useCallback, useMemo } from "react";
import { MetricAnalysisSettings } from "shared/types/metric-analysis";

/**
 * Series Analysis Service
 *
 * This module provides hooks for fetching analysis data for explore series.
 * Currently uses mock data, but is structured to easily swap with real API calls.
 *
 * To swap to real API:
 * 1. Replace generateMockSeriesData with actual apiCall
 * 2. Update useSeriesAnalysis to use useApi hook
 * 3. Add polling logic if queries are async (like DashboardSnapshotProvider)
 */

// ============================================================================
// Types (aligned with MetricAnalysisInterface from shared/types/metric-analysis)
// ============================================================================

/**
 * Data point for a single date in the time series.
 * Matches the structure from metricAnalysisResultValidator.
 */
export interface SeriesDataPoint {
  date: Date;
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
}

/**
 * Histogram bucket for distribution visualization.
 */
export interface HistogramBucket {
  start: number;
  end: number;
  units: number;
}

/**
 * Grouped result structure.
 */
export interface SeriesAnalysisGroup {
  group: string;
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
  dates?: SeriesDataPoint[];
  histogram?: HistogramBucket[];
}

/**
 * Result structure matching MetricAnalysisResult from the real API.
 */
export interface SeriesAnalysisResult {
  // Aggregate metrics
  units: number;
  mean: number;
  stddev?: number;
  numerator?: number;
  denominator?: number;
  // Time series data
  dates?: SeriesDataPoint[];
  // Distribution data
  histogram?: HistogramBucket[];
  // Grouped data
  groups?: SeriesAnalysisGroup[];
}

/**
 * Full analysis response matching MetricAnalysisInterface structure.
 */
export interface SeriesAnalysis {
  id: string;
  organization: string;
  metric: string; // factMetricId - matches real API field name
  status: "pending" | "running" | "succeeded" | "error" | "queued";
  result?: SeriesAnalysisResult;
  error?: string;
  settings: Partial<MetricAnalysisSettings>;
  dateCreated: Date;
  dateUpdated: Date;
  runStarted: Date | null;
  // Additional fields for backward compatibility
  factMetricId: string; // Alias for metric
  valueType: "sum" | "avg";
}

export interface RunSeriesAnalysisParams {
  factMetricId: string;
  valueType: "sum" | "avg";
  settings: Partial<MetricAnalysisSettings>;
  rowFilters?: {
    id: string;
    key: string;
    value: string;
    type: string;
  }[];
}

export interface RunFactTableAnalysisParams {
  seriesId: string; // Unique identifier for this series
  factTableId: string;
  valueType: "unit_count" | "count" | "sum";
  unitType?: string; // For unit_count
  valueColumn?: string; // For sum
  settings: Partial<MetricAnalysisSettings>;
  rowFilters?: {
    id: string;
    key: string;
    value: string;
    type: string;
  }[];
}

// ============================================================================
// Mock Data Generation (Replace with real API calls)
// ============================================================================

/**
 * Generates a deterministic hash from a string.
 * Used to create consistent but different data per metric.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Seeded random number generator for deterministic "randomness".
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Data pattern types for generating varied mock data.
 */
type DataPattern =
  | "steady"           // Relatively flat with small noise
  | "growing"          // Upward trend
  | "declining"        // Downward trend
  | "seasonal"         // Weekly seasonality pattern
  | "volatile"         // High variance
  | "spiky"           // Occasional large spikes
  | "weekend_dip"     // Lower on weekends
  | "hockey_stick";   // Flat then sudden growth

/**
 * Configuration for different metric archetypes.
 */
interface MetricArchetype {
  pattern: DataPattern;
  baseMean: number;
  baseUnits: number;
  volatility: number; // 0-1 scale
  isRatio: boolean;   // Whether to include numerator/denominator
  ratioBase?: number; // Base denominator for ratio metrics
}

/**
 * Predefined metric archetypes for realistic data patterns.
 */
const METRIC_ARCHETYPES: MetricArchetype[] = [
  // Revenue per user - steady with some growth
  { pattern: "growing", baseMean: 45.50, baseUnits: 12500, volatility: 0.15, isRatio: false },
  // Conversion rate - ratio metric with weekend dips
  { pattern: "weekend_dip", baseMean: 0.032, baseUnits: 85000, volatility: 0.08, isRatio: true, ratioBase: 100000 },
  // Page views - high volume, seasonal pattern
  { pattern: "seasonal", baseMean: 3.2, baseUnits: 450000, volatility: 0.25, isRatio: false },
  // Cart abandonment rate - volatile ratio
  { pattern: "volatile", baseMean: 0.68, baseUnits: 15000, volatility: 0.2, isRatio: true, ratioBase: 22000 },
  // New signups - hockey stick growth
  { pattern: "hockey_stick", baseMean: 1, baseUnits: 500, volatility: 0.3, isRatio: false },
  // Average session duration - steady
  { pattern: "steady", baseMean: 245, baseUnits: 180000, volatility: 0.1, isRatio: false },
  // Error rate - low with occasional spikes
  { pattern: "spiky", baseMean: 0.002, baseUnits: 500000, volatility: 0.5, isRatio: true, ratioBase: 500000 },
  // Churn rate - declining (improving)
  { pattern: "declining", baseMean: 0.045, baseUnits: 25000, volatility: 0.12, isRatio: true, ratioBase: 25000 },
  // Orders per day - weekend dip pattern
  { pattern: "weekend_dip", baseMean: 2.1, baseUnits: 8500, volatility: 0.18, isRatio: false },
  // Feature adoption - growing
  { pattern: "growing", baseMean: 0.15, baseUnits: 45000, volatility: 0.1, isRatio: true, ratioBase: 50000 },
];

/**
 * Applies a data pattern to generate variation for a specific day.
 */
function applyPattern(
  pattern: DataPattern,
  dayIndex: number,
  totalDays: number,
  random: () => number,
  baseValue: number,
  volatility: number
): number {
  const progress = dayIndex / Math.max(totalDays - 1, 1);
  const dayOfWeek = dayIndex % 7;
  const noise = (random() - 0.5) * 2 * volatility;

  switch (pattern) {
    case "steady":
      return baseValue * (1 + noise * 0.5);

    case "growing":
      // 20-40% growth over the period
      const growthRate = 0.2 + random() * 0.2;
      return baseValue * (1 + progress * growthRate + noise * 0.3);

    case "declining":
      // 15-30% decline over the period
      const declineRate = 0.15 + random() * 0.15;
      return baseValue * (1 - progress * declineRate + noise * 0.3);

    case "seasonal":
      // Weekly cycle with amplitude
      const weeklyPhase = Math.sin((dayIndex / 7) * 2 * Math.PI);
      return baseValue * (1 + weeklyPhase * 0.2 + noise * 0.3);

    case "volatile":
      // High variance
      return baseValue * (1 + noise);

    case "spiky":
      // Occasional spikes (10% chance of 2-5x spike)
      const isSpike = random() < 0.1;
      const spikeMultiplier = isSpike ? 2 + random() * 3 : 1;
      return baseValue * spikeMultiplier * (1 + noise * 0.3);

    case "weekend_dip":
      // Saturday (5) and Sunday (6) have 30-50% lower values
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
      const weekendFactor = isWeekend ? 0.5 + random() * 0.2 : 1;
      return baseValue * weekendFactor * (1 + noise * 0.3);

    case "hockey_stick":
      // Flat for first 70%, then exponential growth
      if (progress < 0.7) {
        return baseValue * (1 + noise * 0.2);
      }
      const adjustedProgress = (progress - 0.7) / 0.3;
      const exponentialGrowth = Math.pow(3, adjustedProgress);
      return baseValue * exponentialGrowth * (1 + noise * 0.2);

    default:
      return baseValue * (1 + noise * 0.5);
  }
}

/**
 * Generates a histogram from the data points.
 */
function generateHistogram(
  dataPoints: SeriesDataPoint[],
  bucketCount: number = 20
): HistogramBucket[] {
  const values = dataPoints.map((d) => d.mean);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const bucketSize = (max - min) / bucketCount || 1;

  const buckets: HistogramBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = min + i * bucketSize;
    const end = start + bucketSize;
    const units = values.filter((v) => v >= start && v < end).length;
    buckets.push({ start, end, units });
  }

  // Last bucket should include max value
  if (buckets.length > 0) {
    buckets[buckets.length - 1].units += values.filter((v) => v === max).length;
  }

  return buckets;
}

function generateDataPoints(
  startDate: Date,
  endDate: Date,
  granularity: string,
  archetype: MetricArchetype,
  random: () => number,
  baseMeanOverride?: number,
  baseUnitsOverride?: number
): {
  dates: SeriesDataPoint[];
  totalUnits: number;
  sumOfMeans: number;
  totalNumerator: number;
  totalDenominator: number;
} {
  const dates: SeriesDataPoint[] = [];
  let totalNumerator = 0;
  let totalDenominator = 0;
  let totalUnits = 0;
  let sumOfMeans = 0;

  const totalDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  const granularityMultiplier = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  }[granularity] || 1;

  const incrementDate = (d: Date) => {
    switch (granularity) {
      case "week":
        d.setDate(d.getDate() + 7);
        break;
      case "month":
        d.setMonth(d.getMonth() + 1);
        break;
      case "year":
        d.setFullYear(d.getFullYear() + 1);
        break;
      default:
        d.setDate(d.getDate() + 1);
    }
  };

  const baseMean = baseMeanOverride ?? archetype.baseMean;
  const baseUnits = baseUnitsOverride ?? archetype.baseUnits;

  for (let d = new Date(startDate); d <= endDate; incrementDate(d)) {
    const dayIndex = Math.floor(
      (d.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Apply pattern to get the mean value
    const mean = applyPattern(
      archetype.pattern,
      dayIndex,
      totalDays,
      random,
      baseMean,
      archetype.volatility
    );

    // Generate units with some correlation to mean
    const unitsVariation = 1 + (random() - 0.5) * 0.4;
    const units = Math.floor(baseUnits * unitsVariation * granularityMultiplier);

    // Calculate stddev as percentage of mean
    const stddevPercent = 0.1 + random() * 0.15; // 10-25% of mean
    const stddev = Math.abs(mean * stddevPercent);

    // For ratio metrics, calculate numerator and denominator
    let numerator: number | undefined;
    let denominator: number | undefined;
    if (archetype.isRatio && archetype.ratioBase) {
      denominator = Math.floor(archetype.ratioBase * unitsVariation * granularityMultiplier);
      numerator = Math.floor(mean * denominator);
    }

    const dataPoint: SeriesDataPoint = {
      date: new Date(d),
      mean,
      units,
      stddev,
      ...(numerator !== undefined && { numerator }),
      ...(denominator !== undefined && { denominator }),
    };

    dates.push(dataPoint);

    // Accumulate totals
    totalUnits += units;
    sumOfMeans += mean;
    if (numerator !== undefined) totalNumerator += numerator;
    if (denominator !== undefined) totalDenominator += denominator;
  }

  return { dates, totalUnits, sumOfMeans, totalNumerator, totalDenominator };
}

function calculateAggregates(
  dates: SeriesDataPoint[],
  totalUnits: number,
  sumOfMeans: number,
  totalNumerator: number,
  totalDenominator: number,
  isRatio: boolean
) {
  const aggMean = sumOfMeans / (dates.length || 1);
  let sumOfSquaredDiffs = 0;
  for (const d of dates) {
    sumOfSquaredDiffs += Math.pow(d.mean - aggMean, 2);
  }
  const aggStddev = Math.sqrt(sumOfSquaredDiffs / (dates.length || 1));

  return {
    units: totalUnits,
    mean: aggMean,
    stddev: aggStddev,
    ...(isRatio && {
      numerator: totalNumerator,
      denominator: totalDenominator,
    }),
  };
}

/**
 * Generates mock series data based on the metric ID and value type.
 */
export function generateMockSeriesData(params: RunSeriesAnalysisParams): SeriesAnalysis {
  const { factMetricId, valueType, settings } = params;

  // Create a unique ID for this analysis
  const analysisId = `mock_${factMetricId}_${valueType}_${Date.now()}`;

  // Use metric ID hash to select archetype and seed randomness
  const metricHash = hashString(factMetricId);
  const archetypeIndex = Math.abs(metricHash) % METRIC_ARCHETYPES.length;
  const archetype = METRIC_ARCHETYPES[archetypeIndex];
  const random = seededRandom(metricHash);

  // Generate date range
  const endDate = settings.endDate ? new Date(settings.endDate) : new Date();
  const startDate = settings.startDate
    ? new Date(settings.startDate)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const granularity = settings.granularity || "day";

  // Generate main series data
  const mainData = generateDataPoints(startDate, endDate, granularity, archetype, random);
  const mainAggregates = calculateAggregates(
    mainData.dates,
    mainData.totalUnits,
    mainData.sumOfMeans,
    mainData.totalNumerator,
    mainData.totalDenominator,
    archetype.isRatio
  );
  const histogram = generateHistogram(mainData.dates);

  // Generate grouped data if groupBy is set
  let groups: SeriesAnalysisGroup[] | undefined;
  if (settings.groupBy && settings.groupBy.length > 0) {
    // For mock data, we'll just use the first group by dimension to generate names
    // In reality, this would be a combination of all dimensions
    const primaryDimension = settings.groupBy[0];
    let groupNames = ["Group A", "Group B", "Group C", "Group D", "Other"];
    
    // Generate realistic group names based on the dimension
    const dimension = primaryDimension.toLowerCase();
    if (dimension.includes("browser")) {
      groupNames = ["Chrome", "Firefox", "Safari", "Edge", "Other"];
    } else if (dimension.includes("device") || dimension.includes("mobile")) {
      groupNames = ["Desktop", "Mobile", "Tablet", "Other"];
    } else if (dimension.includes("country") || dimension.includes("geo")) {
      groupNames = ["US", "UK", "CA", "DE", "FR", "AU", "JP", "Other"];
    } else if (dimension.includes("os") || dimension.includes("platform")) {
      groupNames = ["Windows", "macOS", "iOS", "Android", "Linux", "Other"];
    } else if (dimension.includes("source") || dimension.includes("referrer")) {
      groupNames = ["Google", "Direct", "Facebook", "Twitter", "Email", "Other"];
    } else if (dimension.includes("status")) {
      groupNames = ["Active", "Inactive", "Pending", "Archived"];
    } else if (dimension.includes("plan") || dimension.includes("subscription")) {
      groupNames = ["Free", "Starter", "Pro", "Enterprise"];
    } else if (dimension.includes("category")) {
      groupNames = ["Electronics", "Clothing", "Home", "Sports", "Books"];
    } else if (dimension.includes("action")) {
      groupNames = ["Add", "Remove", "Update", "Checkout", "Abandon"];
    }

    // If multiple dimensions, create combinations for a few
    if (settings.groupBy.length > 1) {
      const secondDim = settings.groupBy[1].toLowerCase();
      const suffixes = ["A", "B"];
      if (secondDim.includes("device")) suffixes.splice(0, 2, "Desktop", "Mobile");
      else if (secondDim.includes("status")) suffixes.splice(0, 2, "Active", "Inactive");
      
      const newGroupNames: string[] = [];
      groupNames.slice(0, 3).forEach(g => {
        suffixes.forEach(s => newGroupNames.push(`${g} / ${s}`));
      });
      groupNames = newGroupNames;
    }

    groups = groupNames.map((name, i) => {
      // Vary the base mean/units slightly for each group
      const groupRandom = seededRandom(metricHash + i + 1);
      const groupBaseMean = archetype.baseMean * (0.8 + groupRandom() * 0.4);
      const groupBaseUnits = archetype.baseUnits * (0.2 + groupRandom() * 0.2); // Groups are smaller than total

      const groupData = generateDataPoints(
        startDate,
        endDate,
        granularity,
        archetype,
        groupRandom,
        groupBaseMean,
        groupBaseUnits
      );
      const groupAggregates = calculateAggregates(
        groupData.dates,
        groupData.totalUnits,
        groupData.sumOfMeans,
        groupData.totalNumerator,
        groupData.totalDenominator,
        archetype.isRatio
      );

      return {
        group: name,
        ...groupAggregates,
        dates: groupData.dates,
        histogram: generateHistogram(groupData.dates),
      };
    });
  }

  // Build result matching real API structure
  const result: SeriesAnalysisResult = {
    ...mainAggregates,
    dates: mainData.dates,
    histogram,
    groups,
  };

  return {
    id: analysisId,
    organization: "org_mock123",
    metric: factMetricId,
    factMetricId, // Backward compatibility alias
    valueType,
    status: "succeeded",
    result,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    runStarted: new Date(Date.now() - 1000), // 1 second ago
  };
}

/**
 * Fact table archetypes for generating realistic data patterns.
 */
const FACT_TABLE_ARCHETYPES: Record<string, MetricArchetype> = {
  ft_orders: { pattern: "weekend_dip", baseMean: 125, baseUnits: 8500, volatility: 0.18, isRatio: false },
  ft_sessions: { pattern: "seasonal", baseMean: 3.2, baseUnits: 450000, volatility: 0.25, isRatio: false },
  ft_signups: { pattern: "growing", baseMean: 1, baseUnits: 2500, volatility: 0.22, isRatio: false },
  ft_errors: { pattern: "spiky", baseMean: 15, baseUnits: 500, volatility: 0.5, isRatio: false },
  ft_cart: { pattern: "volatile", baseMean: 85, baseUnits: 15000, volatility: 0.2, isRatio: false },
};

/**
 * Generates mock data for a fact table series query.
 */
export function generateMockFactTableData(params: RunFactTableAnalysisParams): SeriesAnalysis {
  const { seriesId, factTableId, valueType, unitType, valueColumn, settings } = params;

  // Create a unique ID for this analysis
  const analysisId = `mock_ft_${seriesId}_${Date.now()}`;

  // Get archetype based on fact table, with fallback
  const archetype = FACT_TABLE_ARCHETYPES[factTableId] || {
    pattern: "steady" as DataPattern,
    baseMean: 100,
    baseUnits: 10000,
    volatility: 0.15,
    isRatio: false,
  };

  // Adjust base values based on value type
  let adjustedBaseMean = archetype.baseMean;
  let adjustedBaseUnits = archetype.baseUnits;

  if (valueType === "count") {
    // Count is just row count
    adjustedBaseMean = archetype.baseUnits * 0.01; // Scale down for display
    adjustedBaseUnits = archetype.baseUnits;
  } else if (valueType === "unit_count") {
    // Distinct unit count - typically lower than row count
    adjustedBaseMean = archetype.baseUnits * 0.008; // Fewer unique units than rows
    adjustedBaseUnits = Math.floor(archetype.baseUnits * 0.7);
  } else if (valueType === "sum") {
    // Sum of a numeric column
    adjustedBaseMean = archetype.baseMean * archetype.baseUnits * 0.01;
    adjustedBaseUnits = archetype.baseUnits;
  }

  // Use a combination of params for seeding
  const seedString = `${factTableId}_${valueType}_${unitType || ""}_${valueColumn || ""}`;
  const metricHash = hashString(seedString);
  const random = seededRandom(metricHash);

  // Generate date range
  const endDate = settings.endDate ? new Date(settings.endDate) : new Date();
  const startDate = settings.startDate
    ? new Date(settings.startDate)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const granularity = settings.granularity || "day";

  // Generate main series data
  const mainData = generateDataPoints(
    startDate,
    endDate,
    granularity,
    archetype,
    random,
    adjustedBaseMean,
    adjustedBaseUnits
  );
  const mainAggregates = calculateAggregates(
    mainData.dates,
    mainData.totalUnits,
    mainData.sumOfMeans,
    mainData.totalNumerator,
    mainData.totalDenominator,
    archetype.isRatio
  );
  const histogram = generateHistogram(mainData.dates);

  // Generate grouped data if groupBy is set
  let groups: SeriesAnalysisGroup[] | undefined;
  if (settings.groupBy) {
    const groupNames = ["Mobile", "Desktop", "Tablet"];
    groups = groupNames.map((name, i) => {
      const groupRandom = seededRandom(metricHash + i + 1);
      const groupBaseMean = adjustedBaseMean * (0.8 + groupRandom() * 0.4);
      const groupBaseUnits = adjustedBaseUnits * (0.3 + groupRandom() * 0.2);

      const groupData = generateDataPoints(
        startDate,
        endDate,
        granularity,
        archetype,
        groupRandom,
        groupBaseMean,
        groupBaseUnits
      );
      const groupAggregates = calculateAggregates(
        groupData.dates,
        groupData.totalUnits,
        groupData.sumOfMeans,
        groupData.totalNumerator,
        groupData.totalDenominator,
        archetype.isRatio
      );

      return {
        group: name,
        ...groupAggregates,
        dates: groupData.dates,
        histogram: generateHistogram(groupData.dates),
      };
    });
  }

  const result: SeriesAnalysisResult = {
    ...mainAggregates,
    dates: mainData.dates,
    histogram,
    groups,
  };

  return {
    id: analysisId,
    organization: "org_mock123",
    metric: factTableId,
    factMetricId: factTableId, // Using factTableId as the metric identifier
    valueType: valueType === "sum" ? "sum" : "avg", // Map to existing value types
    status: "succeeded",
    result,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    runStarted: new Date(Date.now() - 1000),
  };
}

/**
 * Simulates an async API call with a small delay.
 * This mimics the behavior of a real API call.
 *
 * TODO: Replace with actual API call using apiCall from useAuth()
 */
async function fetchSeriesAnalysis(
  params: RunSeriesAnalysisParams
): Promise<SeriesAnalysis> {
  console.log("Requesting series analysis data...", params);
  // Simulate network delay (50-150ms)
  await new Promise((resolve) =>
    setTimeout(resolve, 50 + Math.random() * 100)
  );

  const result = generateMockSeriesData(params);
  console.log("Received series analysis data:", result);
  return result;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch analysis data for a single series.
 *
 * Usage:
 * ```
 * const { data, loading, error, refresh } = useSeriesAnalysis({
 *   factMetricId: "fact_abc123",
 *   valueType: "avg",
 *   settings: { startDate, endDate },
 * });
 * ```
 *
 * To migrate to real API:
 * 1. Replace fetchSeriesAnalysis with useApi hook
 * 2. Add shouldRun condition based on factMetricId
 * 3. Use mutate() for refresh
 */
export function useSeriesAnalysis(
  params: RunSeriesAnalysisParams | null
): {
  data: SeriesAnalysis | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<SeriesAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!params?.factMetricId) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetchSeriesAnalysis(params);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [params?.factMetricId, params?.valueType, params?.settings?.startDate?.toString(), params?.settings?.endDate?.toString(), params?.settings?.granularity, params?.settings?.groupBy]);

  // Fetch on mount and when params change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}

/**
 * Hook to fetch analysis data for multiple series at once.
 * Useful when displaying a chart with multiple metrics.
 *
 * Usage:
 * ```
 * const { dataMap, loading, errors, refreshAll } = useMultiSeriesAnalysis([
 *   { factMetricId: "fact_abc", valueType: "avg", settings },
 *   { factMetricId: "fact_xyz", valueType: "sum", settings },
 * ]);
 *
 * const seriesAData = dataMap.get("fact_abc");
 * ```
 */
export function useMultiSeriesAnalysis(
  paramsList: RunSeriesAnalysisParams[]
): {
  dataMap: Map<string, SeriesAnalysis>;
  loading: boolean;
  errors: Map<string, Error>;
  refreshAll: () => Promise<void>;
} {
  const [dataMap, setDataMap] = useState<Map<string, SeriesAnalysis>>(new Map());
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Map<string, Error>>(new Map());

  // Create a stable key for the params list
  const paramsKey = useMemo(
    () =>
      paramsList
        .map((p) => `${p.factMetricId}:${p.valueType}:${p.settings.startDate}:${p.settings.endDate}:${p.settings.granularity}:${p.settings.groupBy}`)
        .sort()
        .join("|"),
    [paramsList]
  );

  const fetchAll = useCallback(async () => {
    if (paramsList.length === 0) {
      setDataMap(new Map());
      return;
    }

    setLoading(true);
    const newDataMap = new Map<string, SeriesAnalysis>();
    const newErrors = new Map<string, Error>();

    // Fetch all series in parallel
    await Promise.all(
      paramsList.map(async (params) => {
        try {
          const result = await fetchSeriesAnalysis(params);
          newDataMap.set(params.factMetricId, result);
        } catch (e) {
          newErrors.set(
            params.factMetricId,
            e instanceof Error ? e : new Error(String(e))
          );
        }
      })
    );

    setDataMap(newDataMap);
    setErrors(newErrors);
    setLoading(false);
  }, [paramsKey]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    dataMap,
    loading,
    errors,
    refreshAll: fetchAll,
  };
}

/**
 * Simulates an async API call for fact table series.
 */
async function fetchFactTableAnalysis(
  params: RunFactTableAnalysisParams
): Promise<SeriesAnalysis> {
  console.log("Requesting fact table analysis data...", params);
  // Simulate network delay (50-150ms)
  await new Promise((resolve) =>
    setTimeout(resolve, 50 + Math.random() * 100)
  );

  const result = generateMockFactTableData(params);
  console.log("Received fact table analysis data:", result);
  return result;
}

/**
 * Hook to fetch analysis data for multiple fact table series.
 */
export function useMultiFactTableAnalysis(
  paramsList: RunFactTableAnalysisParams[]
): {
  dataMap: Map<string, SeriesAnalysis>;
  loading: boolean;
  errors: Map<string, Error>;
  refreshAll: () => Promise<void>;
} {
  const [dataMap, setDataMap] = useState<Map<string, SeriesAnalysis>>(new Map());
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Map<string, Error>>(new Map());

  // Create a stable key for the params list
  const paramsKey = useMemo(
    () =>
      paramsList
        .map((p) => `${p.seriesId}:${p.factTableId}:${p.valueType}:${p.unitType || ""}:${p.valueColumn || ""}:${p.settings.startDate}:${p.settings.endDate}:${p.settings.granularity}:${p.settings.groupBy}`)
        .sort()
        .join("|"),
    [paramsList]
  );

  const fetchAll = useCallback(async () => {
    if (paramsList.length === 0) {
      setDataMap(new Map());
      return;
    }

    setLoading(true);
    const newDataMap = new Map<string, SeriesAnalysis>();
    const newErrors = new Map<string, Error>();

    // Fetch all series in parallel
    await Promise.all(
      paramsList.map(async (params) => {
        try {
          const result = await fetchFactTableAnalysis(params);
          newDataMap.set(params.seriesId, result);
        } catch (e) {
          newErrors.set(
            params.seriesId,
            e instanceof Error ? e : new Error(String(e))
          );
        }
      })
    );

    setDataMap(newDataMap);
    setErrors(newErrors);
    setLoading(false);
  }, [paramsKey]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    dataMap,
    loading,
    errors,
    refreshAll: fetchAll,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Converts series analysis data to the format expected by the chart.
 * Applies the valueType transformation (sum vs avg).
 */
export function getSeriesChartData(
  analysis: SeriesAnalysis | null,
  valueType: "sum" | "avg"
): { x: Date; y: number }[] {
  if (!analysis?.result?.dates) return [];

  return analysis.result.dates.map((d) => ({
    x: d.date,
    y: valueType === "sum"
      ? (d.numerator ?? d.mean * d.units)
      : d.mean,
  }));
}

/**
 * Converts series analysis data to the format expected by the data table.
 * Includes formatted values based on valueType.
 */
export function getSeriesTableData(
  analysis: SeriesAnalysis | null,
  valueType: "sum" | "avg"
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

  return analysis.result.dates
    .map((d) => ({
      date: d.date,
      mean: d.mean,
      units: d.units,
      value: valueType === "sum"
        ? (d.numerator ?? d.mean * d.units)
        : d.mean,
      stddev: d.stddev,
      numerator: d.numerator,
      denominator: d.denominator,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime()); // Oldest first (chronological)
}

/**
 * Gets aggregate statistics from the analysis result.
 */
export function getSeriesAggregates(
  analysis: SeriesAnalysis | null
): {
  mean: number;
  units: number;
  stddev: number;
  numerator?: number;
  denominator?: number;
} | null {
  if (!analysis?.result) return null;

  return {
    mean: analysis.result.mean,
    units: analysis.result.units,
    stddev: analysis.result.stddev ?? 0,
    numerator: analysis.result.numerator,
    denominator: analysis.result.denominator,
  };
}

/**
 * Gets histogram data for distribution visualization.
 */
export function getSeriesHistogram(
  analysis: SeriesAnalysis | null
): HistogramBucket[] {
  return analysis?.result?.histogram ?? [];
}

/**
 * Gets grouped data for visualization.
 */
export function getSeriesGroups(
  analysis: SeriesAnalysis | null
): SeriesAnalysisGroup[] {
  return analysis?.result?.groups ?? [];
}
