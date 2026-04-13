import { SnapshotResultChunkInterface } from "shared/validators";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";

// Columns stored in each chunk's `data` field.
// Index columns identify which (analysis, dimension, variation, metric) a row belongs to.
// Value columns contain the flattened SnapshotMetric fields.
const INDEX_COLUMNS = ["a", "d", "v", "m"] as const;

// Columns stored in each chunk's `metaData` field.
// These store per-(analysis, dimension, variation) metadata that is shared across metrics.
const META_COLUMNS = ["a", "d", "s", "v", "vu"] as const;

type SnapshotResultChunkData = Pick<
  SnapshotResultChunkInterface,
  "numRows" | "data" | "metaNumRows" | "metaData"
>;

export interface EncodeResult {
  chunks: SnapshotResultChunkData[];
  metricIdsByChunk: string[][];
}

// -- Flatten / Unflatten SnapshotMetric --

// All possible value columns in flattened form.
// Order matters for consistent encoding, but the decode is column-name based.
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

// -- Size estimation --

function getValueSize(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 8;
  if (typeof value === "string") return value.length + 5;
  return 1 + JSON.stringify(value).length * 2;
}

// -- Encode --

interface MetricRowGroup {
  metricId: string;
  rows: Record<string, unknown>[];
  metaRows: Record<string, unknown>[];
  estimatedSize: number;
}

/**
 * Encode snapshot analyses into chunked columnar format.
 *
 * @param analyses - The analyses with populated results
 * @param metricOrdering - Ordered list of metric IDs (goals, secondary, guardrails, then slices)
 * @param chunkSizeBytes - Target chunk size (default 4MB)
 */
export function encodeSnapshotResults(
  analyses: ExperimentSnapshotAnalysis[],
  metricOrdering: string[],
  chunkSizeBytes: number = 4_000_000,
): EncodeResult {
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

  // Build ordered metric list: known ordering first, then remaining in set order
  const orderSet = new Set(metricOrdering);
  const orderedMetrics: string[] = [];
  for (const m of metricOrdering) {
    if (allMetricIds.has(m)) orderedMetrics.push(m);
  }
  for (const m of allMetricIds) {
    if (!orderSet.has(m)) orderedMetrics.push(m);
  }

  // Group rows by metric
  const metricGroups = new Map<string, MetricRowGroup>();
  for (const metricId of orderedMetrics) {
    metricGroups.set(metricId, {
      metricId,
      rows: [],
      metaRows: [],
      estimatedSize: 0,
    });
  }

  // Track which (analysis, dimension, variation) combos we've seen per metric group
  // to deduplicate meta rows within a group
  const metaKeySeen = new Map<string, Set<string>>();

  for (let ai = 0; ai < analyses.length; ai++) {
    const analysis = analyses[ai];
    for (const dim of analysis.results) {
      for (let vi = 0; vi < dim.variations.length; vi++) {
        const variation = dim.variations[vi];
        const metaKey = `${ai}|${dim.name}|${vi}`;

        for (const [metricId, metric] of Object.entries(variation.metrics)) {
          const group = metricGroups.get(metricId);
          if (!group) continue;

          const flat = flattenSnapshotMetric(metric);
          const row: Record<string, unknown> = {
            a: ai,
            d: dim.name,
            v: vi,
            m: metricId,
            ...flat,
          };
          group.rows.push(row);

          // Estimate size
          let rowSize = 0;
          for (const val of Object.values(flat)) {
            rowSize += getValueSize(val);
          }
          // Index columns size
          rowSize += 8 + (dim.name.length + 5) + 8 + (metricId.length + 5);
          group.estimatedSize += rowSize;

          // Add meta row if not already tracked for this group
          if (!metaKeySeen.has(metricId)) metaKeySeen.set(metricId, new Set());
          const seen = metaKeySeen.get(metricId)!;
          if (!seen.has(metaKey)) {
            seen.add(metaKey);
            group.metaRows.push({
              a: ai,
              d: dim.name,
              s: dim.srm,
              v: vi,
              vu: variation.users,
            });
          }
        }
      }
    }
  }

  // Group metrics into chunks based on size
  const chunks: SnapshotResultChunkData[] = [];
  const metricIdsByChunk: string[][] = [];

  let currentChunk = createDataChunk();
  let currentMetricIds: string[] = [];
  let currentSize = 0;

  for (const metricId of orderedMetrics) {
    const group = metricGroups.get(metricId)!;
    if (group.rows.length === 0) continue;

    // If adding this metric would exceed the chunk size and we already have data,
    // finalize the current chunk first
    if (
      currentSize > 0 &&
      currentSize + group.estimatedSize >= chunkSizeBytes
    ) {
      finalizeChunk(currentChunk, chunks);
      metricIdsByChunk.push(currentMetricIds);
      currentChunk = createDataChunk();
      currentMetricIds = [];
      currentSize = 0;
    }

    // Add all rows for this metric to the current chunk
    for (const row of group.rows) {
      currentChunk.numRows++;
      for (const col of ALL_DATA_COLUMNS) {
        currentChunk.data[col].push(row[col] ?? null);
      }
    }
    for (const metaRow of group.metaRows) {
      currentChunk.metaNumRows++;
      for (const col of META_COLUMNS) {
        (currentChunk.metaData[col] as unknown[]).push(metaRow[col] ?? null);
      }
    }

    currentMetricIds.push(metricId);
    currentSize += group.estimatedSize;
  }

  // Push final chunk
  if (currentChunk.numRows > 0) {
    finalizeChunk(currentChunk, chunks);
    metricIdsByChunk.push(currentMetricIds);
  }

  return { chunks, metricIdsByChunk };
}

// Mutable chunk during construction
interface MutableChunkData {
  numRows: number;
  data: Record<string, unknown[]>;
  metaNumRows: number;
  metaData: Record<string, unknown[]>;
}

function createDataChunk(): MutableChunkData {
  const data: Record<string, unknown[]> = {};
  for (const col of ALL_DATA_COLUMNS) {
    data[col] = [];
  }
  const metaData: Record<string, unknown[]> = {};
  for (const col of META_COLUMNS) {
    metaData[col] = [];
  }
  return { numRows: 0, data, metaNumRows: 0, metaData };
}

function finalizeChunk(
  chunk: MutableChunkData,
  out: SnapshotResultChunkData[],
) {
  out.push({
    numRows: chunk.numRows,
    data: chunk.data,
    metaNumRows: chunk.metaNumRows,
    metaData: chunk.metaData,
  });
}

// -- Decode --

interface AnalysisMetadata {
  settings: ExperimentSnapshotAnalysisSettings;
  dateCreated: Date;
  status: "running" | "success" | "error";
  error?: string;
}

/**
 * Decode chunked columnar data back into ExperimentSnapshotAnalysis[].
 *
 * @param chunks - The chunk data arrays (sorted by chunkNumber)
 * @param analysisMetadata - Metadata for each analysis (from the main snapshot doc)
 * @param filterMetricIds - Optional set of metric IDs to include (for partial fetching)
 */
export function decodeSnapshotResults(
  chunks: SnapshotResultChunkData[],
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

  // First, process meta rows to set up dimension/variation structure
  for (const chunk of chunks) {
    const { metaData, metaNumRows } = chunk;
    if (!metaNumRows) continue;

    const metaA = metaData.a as number[];
    const metaD = metaData.d as string[];
    const metaS = metaData.s as number[];
    const metaV = metaData.v as number[];
    const metaVU = metaData.vu as number[];

    for (let i = 0; i < metaNumRows; i++) {
      const ai = metaA[i];
      const dimName = metaD[i];
      const srm = metaS[i];
      const vi = metaV[i];
      const varUsers = metaVU[i];

      if (!analysisMap.has(ai)) analysisMap.set(ai, new Map());
      const dims = analysisMap.get(ai)!;
      if (!dims.has(dimName)) dims.set(dimName, { srm, variations: new Map() });
      const dim = dims.get(dimName)!;
      if (!dim.variations.has(vi)) {
        dim.variations.set(vi, { users: varUsers, metrics: {} });
      }
    }
  }

  // Then, process data rows to populate metrics
  for (const chunk of chunks) {
    const { data, numRows } = chunk;
    if (!numRows) continue;

    const dataA = data.a as number[];
    const dataD = data.d as string[];
    const dataV = data.v as number[];
    const dataM = data.m as string[];

    for (let i = 0; i < numRows; i++) {
      const metricId = dataM[i];

      // Skip if filtering and this metric isn't requested
      if (filterMetricIds && !filterMetricIds.has(metricId)) continue;

      const ai = dataA[i];
      const dimName = dataD[i];
      const vi = dataV[i];

      // Read flat metric values
      const flat: Record<string, unknown> = {};
      for (const col of VALUE_COLUMNS) {
        flat[col] = data[col]?.[i] ?? null;
      }

      const metric = unflattenSnapshotMetric(flat);

      // Ensure structure exists (in case meta was filtered)
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
        // Build variations array sorted by index
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
    // Slice metrics have a '?' in their ID
    if (m.includes("?")) {
      slice.push(m);
    } else {
      nonSlice.push(m);
    }
  }

  return [...nonSlice, ...slice];
}
