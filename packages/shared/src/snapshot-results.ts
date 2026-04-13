import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";

// Index columns identify which (analysis, dimension, variation) a row belongs to.
// The metricId is a document-level field, not a column.
const INDEX_COLUMNS = ["a", "d", "v"] as const;

// All possible value columns in flattened form.
const VALUE_COLUMNS = [
  "value",
  "cr",
  "users",
  "denominator",
  "ci_0",
  "ci_1",
  "ciAdjusted_0",
  "ciAdjusted_1",
  "expected",
  "risk_0",
  "risk_1",
  "riskType",
  "pValue",
  "pValueAdjusted",
  "chanceToWin",
  "stats_users",
  "stats_mean",
  "stats_count",
  "stats_stddev",
  "uplift_dist",
  "uplift_mean",
  "uplift_stddev",
  "errorMessage",
  // Complex fields stored as JSON strings
  "_buckets",
  "_supplementalResults",
  "_power",
  "_realizedSettings",
] as const;

const ALL_DATA_COLUMNS = [...INDEX_COLUMNS, ...VALUE_COLUMNS];

// -- Types --

export type MetricChunkData = {
  numRows: number;
  data: Record<string, unknown[]>;
};

export type AnalysisMetaEntry = {
  dimensions: Array<{
    name: string;
    srm: number;
    variationUsers: number[];
  }>;
};

export interface EncodeResult {
  metricChunks: Map<string, MetricChunkData>;
  analysisMeta: AnalysisMetaEntry[];
}

// -- Flatten / Unflatten SnapshotMetric --

function flattenSnapshotMetric(
  metric: SnapshotMetric,
): Record<string, unknown> {
  return {
    value: metric.value,
    cr: metric.cr,
    users: metric.users,
    denominator: metric.denominator ?? null,
    ci_0: metric.ci?.[0] ?? null,
    ci_1: metric.ci?.[1] ?? null,
    ciAdjusted_0: metric.ciAdjusted?.[0] ?? null,
    ciAdjusted_1: metric.ciAdjusted?.[1] ?? null,
    expected: metric.expected ?? null,
    risk_0: metric.risk?.[0] ?? null,
    risk_1: metric.risk?.[1] ?? null,
    riskType: metric.riskType ?? null,
    pValue: metric.pValue ?? null,
    pValueAdjusted: metric.pValueAdjusted ?? null,
    chanceToWin: metric.chanceToWin ?? null,
    stats_users: metric.stats?.users ?? null,
    stats_mean: metric.stats?.mean ?? null,
    stats_count: metric.stats?.count ?? null,
    stats_stddev: metric.stats?.stddev ?? null,
    uplift_dist: metric.uplift?.dist ?? null,
    uplift_mean: metric.uplift?.mean ?? null,
    uplift_stddev: metric.uplift?.stddev ?? null,
    errorMessage: metric.errorMessage ?? null,
    _buckets: metric.buckets ? JSON.stringify(metric.buckets) : null,
    _supplementalResults: metric.supplementalResults
      ? JSON.stringify(metric.supplementalResults)
      : null,
    _power: metric.power ? JSON.stringify(metric.power) : null,
    _realizedSettings: metric.realizedSettings
      ? JSON.stringify(metric.realizedSettings)
      : null,
  };
}

function unflattenSnapshotMetric(
  flat: Record<string, unknown>,
): SnapshotMetric {
  const metric: SnapshotMetric = {
    value: flat.value as number,
    cr: flat.cr as number,
    users: flat.users as number,
  };

  if (flat.denominator != null) metric.denominator = flat.denominator as number;
  if (flat.ci_0 != null && flat.ci_1 != null)
    metric.ci = [flat.ci_0 as number, flat.ci_1 as number];
  if (flat.ciAdjusted_0 != null && flat.ciAdjusted_1 != null)
    metric.ciAdjusted = [
      flat.ciAdjusted_0 as number,
      flat.ciAdjusted_1 as number,
    ];
  if (flat.expected != null) metric.expected = flat.expected as number;
  if (flat.risk_0 != null && flat.risk_1 != null)
    metric.risk = [flat.risk_0 as number, flat.risk_1 as number];
  if (flat.riskType != null)
    metric.riskType = flat.riskType as SnapshotMetric["riskType"];
  if (flat.pValue != null) metric.pValue = flat.pValue as number;
  if (flat.pValueAdjusted != null)
    metric.pValueAdjusted = flat.pValueAdjusted as number;
  if (flat.chanceToWin != null) metric.chanceToWin = flat.chanceToWin as number;

  if (flat.stats_users != null) {
    metric.stats = {
      users: flat.stats_users as number,
      mean: flat.stats_mean as number,
      count: flat.stats_count as number,
      stddev: flat.stats_stddev as number,
    };
  }

  if (flat.uplift_dist != null) {
    metric.uplift = {
      dist: flat.uplift_dist as string,
      ...(flat.uplift_mean != null ? { mean: flat.uplift_mean as number } : {}),
      ...(flat.uplift_stddev != null
        ? { stddev: flat.uplift_stddev as number }
        : {}),
    };
  }

  if (flat.errorMessage != null)
    metric.errorMessage = flat.errorMessage as string;

  if (flat._buckets != null)
    metric.buckets = JSON.parse(flat._buckets as string);
  if (flat._supplementalResults != null)
    metric.supplementalResults = JSON.parse(
      flat._supplementalResults as string,
    );
  if (flat._power != null) metric.power = JSON.parse(flat._power as string);
  if (flat._realizedSettings != null)
    metric.realizedSettings = JSON.parse(flat._realizedSettings as string);

  return metric;
}

// -- Encode --

/**
 * Encode snapshot analyses into per-metric columnar documents.
 * Each metric gets its own chunk. Meta data (srm, variation users) is
 * extracted once and returned separately for storage on the snapshot doc.
 */
export function encodeSnapshotResults(
  analyses: ExperimentSnapshotAnalysis[],
  metricOrdering: string[],
): EncodeResult {
  // Extract analysisMeta (shared across all metrics)
  const analysisMeta: AnalysisMetaEntry[] = analyses.map((analysis) => ({
    dimensions: analysis.results.map((dim) => ({
      name: dim.name,
      srm: dim.srm,
      variationUsers: dim.variations.map((v) => v.users),
    })),
  }));

  // Collect all metric IDs seen across all analyses
  const allMetricIds = new Set<string>();
  for (const analysis of analyses) {
    for (const dim of analysis.results) {
      for (const variation of dim.variations) {
        for (const metricId of Object.keys(variation.metrics)) {
          allMetricIds.add(metricId);
        }
      }
    }
  }

  // Build ordered metric list: known ordering first, then remaining
  const orderSet = new Set(metricOrdering);
  const orderedMetrics: string[] = [];
  for (const m of metricOrdering) {
    if (allMetricIds.has(m)) orderedMetrics.push(m);
  }
  for (const m of allMetricIds) {
    if (!orderSet.has(m)) orderedMetrics.push(m);
  }

  // Build one chunk per metric
  const metricChunks = new Map<string, MetricChunkData>();

  for (const metricId of orderedMetrics) {
    const data: Record<string, unknown[]> = {};
    for (const col of ALL_DATA_COLUMNS) {
      data[col] = [];
    }
    let numRows = 0;

    for (let ai = 0; ai < analyses.length; ai++) {
      const analysis = analyses[ai];
      for (const dim of analysis.results) {
        for (let vi = 0; vi < dim.variations.length; vi++) {
          const metric = dim.variations[vi].metrics[metricId];
          if (!metric) continue;

          const flat = flattenSnapshotMetric(metric);
          data.a.push(ai);
          data.d.push(dim.name);
          data.v.push(vi);
          for (const col of VALUE_COLUMNS) {
            data[col].push(flat[col] ?? null);
          }
          numRows++;
        }
      }
    }

    if (numRows > 0) {
      metricChunks.set(metricId, { numRows, data });
    }
  }

  return { metricChunks, analysisMeta };
}

// -- Decode --

interface AnalysisMetadata {
  settings: ExperimentSnapshotAnalysisSettings;
  dateCreated: Date;
  status: "running" | "success" | "error";
  error?: string;
}

interface MetricChunkInput {
  metricId: string;
  numRows: number;
  data: Record<string, unknown[]>;
}

/**
 * Decode per-metric columnar chunks back into ExperimentSnapshotAnalysis[].
 *
 * @param chunks - Per-metric chunk documents
 * @param analysisMeta - Shared dimension/variation metadata (from snapshot doc)
 * @param analysisMetadata - Per-analysis settings/status (from snapshot doc)
 * @param filterMetricIds - Optional set of metric IDs to include
 */
export function decodeSnapshotResults(
  chunks: MetricChunkInput[],
  analysisMeta: AnalysisMetaEntry[],
  analysisMetadata: AnalysisMetadata[],
  filterMetricIds?: Set<string>,
): ExperimentSnapshotAnalysis[] {
  // Build the nested structure
  // analysisIndex -> dimensionName -> { srm, variations: [{ users, metrics }] }
  type DimData = {
    srm: number;
    variations: Map<
      number,
      { users: number; metrics: Record<string, SnapshotMetric> }
    >;
  };
  const analysisMap = new Map<number, Map<string, DimData>>();

  // Initialize structure from analysisMeta
  for (let ai = 0; ai < analysisMeta.length; ai++) {
    const meta = analysisMeta[ai];
    if (!meta) continue;
    const dims = new Map<string, DimData>();
    for (const dim of meta.dimensions) {
      const variations = new Map<
        number,
        { users: number; metrics: Record<string, SnapshotMetric> }
      >();
      for (let vi = 0; vi < dim.variationUsers.length; vi++) {
        variations.set(vi, { users: dim.variationUsers[vi], metrics: {} });
      }
      dims.set(dim.name, { srm: dim.srm, variations });
    }
    analysisMap.set(ai, dims);
  }

  // Process data rows from each chunk
  for (const chunk of chunks) {
    const { metricId, data, numRows } = chunk;
    if (!numRows) continue;

    // Skip if filtering and this metric isn't requested
    if (filterMetricIds && !filterMetricIds.has(metricId)) continue;

    const dataA = data.a as number[];
    const dataD = data.d as string[];
    const dataV = data.v as number[];

    for (let i = 0; i < numRows; i++) {
      const ai = dataA[i];
      const dimName = dataD[i];
      const vi = dataV[i];

      // Read flat metric values
      const flat: Record<string, unknown> = {};
      for (const col of VALUE_COLUMNS) {
        flat[col] = data[col]?.[i] ?? null;
      }

      const metric = unflattenSnapshotMetric(flat);

      // Ensure structure exists (in case analysisMeta is incomplete)
      if (!analysisMap.has(ai)) analysisMap.set(ai, new Map());
      const dims = analysisMap.get(ai)!;
      if (!dims.has(dimName))
        dims.set(dimName, { srm: 0, variations: new Map() });
      const dim = dims.get(dimName)!;
      if (!dim.variations.has(vi))
        dim.variations.set(vi, { users: 0, metrics: {} });

      dim.variations.get(vi)!.metrics[metricId] = metric;
    }
  }

  // Reconstruct ExperimentSnapshotAnalysis[]
  return analysisMetadata.map((meta, ai): ExperimentSnapshotAnalysis => {
    const dims = analysisMap.get(ai);
    const results: ExperimentReportResultDimension[] = [];

    if (dims) {
      for (const [name, dimData] of dims) {
        const maxVi = Math.max(...Array.from(dimData.variations.keys()), -1);
        const variations = [];
        for (let vi = 0; vi <= maxVi; vi++) {
          const varData = dimData.variations.get(vi);
          variations.push({
            users: varData?.users ?? 0,
            metrics: varData?.metrics ?? {},
          });
        }
        results.push({ name, srm: dimData.srm, variations });
      }
    }

    return {
      settings: meta.settings,
      dateCreated: meta.dateCreated,
      status: meta.status,
      ...(meta.error ? { error: meta.error } : {}),
      results,
    };
  });
}

/**
 * Build the metric ordering for encoding.
 * Goals first, then secondary, then guardrails, then slice metrics last.
 */
export function buildMetricOrdering(
  goalMetrics: string[],
  secondaryMetrics: string[],
  guardrailMetrics: string[],
): string[] {
  const nonSlice: string[] = [];
  const slice: string[] = [];

  const all = [...goalMetrics, ...secondaryMetrics, ...guardrailMetrics];
  const seen = new Set<string>();

  for (const m of all) {
    if (seen.has(m)) continue;
    seen.add(m);
    if (m.includes("?")) {
      slice.push(m);
    } else {
      nonSlice.push(m);
    }
  }

  return [...nonSlice, ...slice];
}

/**
 * Helper to extract analysisMeta and analysisMetadata from a snapshot,
 * used by populateSnapshots in the chunk model.
 */
export function getAnalysisMetaFromSnapshot(
  snapshot: ExperimentSnapshotInterface,
): {
  analysisMeta: AnalysisMetaEntry[];
  analysisMetadata: AnalysisMetadata[];
} {
  return {
    analysisMeta: snapshot.analysisMeta ?? [],
    analysisMetadata: snapshot.analyses.map((a) => ({
      settings: a.settings,
      dateCreated: a.dateCreated,
      status: a.status,
      ...(a.error ? { error: a.error } : {}),
    })),
  };
}
