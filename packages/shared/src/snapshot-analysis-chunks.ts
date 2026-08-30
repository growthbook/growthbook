import uniqid from "uniqid";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  SnapshotMetric,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";

export type AnalysisKeyType = string;

// Index columns identify which (dimension, variation) a row belongs to inside
// a per-analysis sub-path. The metricId is a document-level field, not a column.
const INDEX_COLUMNS = new Set(["d", "v"]);

/** Generate a fresh `analysisKey` for a newly created analysis. */
export function buildAnalysisKey(): string {
  return uniqid("an_");
}

// -- Types --

/**
 * Per-analysis columnar sub-record stored under `chunk.data.<analysisKey>`.
 * Every column array (d, v, and any value columns) has exactly `numRows`
 * entries. Value columns use an `unknown` index so declared fields retain
 * their narrow types; callers must narrow with `Array.isArray` before use.
 */
export type AnalysisChunkData = {
  numRows: number;
  d: string[];
  v: number[];
  [col: string]: unknown;
};

export type MetricChunkData = Record<string, AnalysisChunkData>;

export type AnalysisMetaEntry = {
  dimensions: Array<{
    name: string;
    srm: number;
    variationUsers: number[];
  }>;
};

export interface EncodeResult {
  metricChunks: Map<string, MetricChunkData>;
  chunkedAnalysesMeta: Record<string, AnalysisMetaEntry>;
}

// -- Encode --

/**
 * Encode snapshot analyses into per-metric, per-analysis columnar data.
 *
 * Each analysis must already have an immutable `analysisKey`. The encoder
 * emits one chunk payload per metric, with every analysis stored under its
 * own `data.<analysisKey>` sub-record so concurrent writers updating
 * different analyses never touch the same MongoDB field.
 *
 * Meta data (srm, variation users) is extracted once per analysis and
 * returned as a keyed record for storage on the snapshot doc.
 */
export function encodeSnapshotAnalysisChunks(
  analyses: ExperimentSnapshotAnalysis[],
  metricOrdering: string[],
): EncodeResult {
  // Duplicate analysisKeys would collapse onto the same MongoDB sub-path
  // and silently lose data. TypeScript can enforce that each analysis has a
  // key, but not uniqueness across the array — so we check it here.
  const seenKeys = new Set<string>();
  for (const analysis of analyses) {
    if (seenKeys.has(analysis.analysisKey)) {
      throw new Error(
        `encodeSnapshotAnalysisChunks: duplicate analysisKey "${analysis.analysisKey}"`,
      );
    }
    seenKeys.add(analysis.analysisKey);
  }

  // Extract chunkedAnalysesMeta (one entry per analysis, keyed by analysisKey)
  const chunkedAnalysesMeta: Record<string, AnalysisMetaEntry> = {};
  for (const analysis of analyses) {
    chunkedAnalysesMeta[analysis.analysisKey] = {
      dimensions: analysis.results.map((dim) => ({
        name: dim.name,
        srm: dim.srm,
        variationUsers: dim.variations.map((v) => v.users),
      })),
    };
  }

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
    const perMetricData: MetricChunkData = {};
    let metricHasRows = false;

    for (const analysis of analyses) {
      const perAnalysis = encodePerAnalysis(analysis, metricId);
      if (perAnalysis.numRows > 0) {
        perMetricData[analysis.analysisKey] = perAnalysis;
        metricHasRows = true;
      }
    }

    if (metricHasRows) {
      metricChunks.set(metricId, perMetricData);
    }
  }

  return { metricChunks, chunkedAnalysesMeta };
}

/**
 * Encode a single (analysis, metric) pair into columnar form. Rows where
 * the metric is absent are skipped, so `numRows` reflects only rows where
 * this metric contributed data.
 */
function encodePerAnalysis(
  analysis: ExperimentSnapshotAnalysis,
  metricId: string,
): AnalysisChunkData {
  const d: string[] = [];
  const v: number[] = [];
  const valueColumns = new Map<string, unknown[]>();
  let numRows = 0;

  for (const dim of analysis.results) {
    for (let vi = 0; vi < dim.variations.length; vi++) {
      const metric = dim.variations[vi].metrics[metricId];
      if (!metric) continue;

      d.push(dim.name);
      v.push(vi);

      for (const col of Object.keys(metric)) {
        if (!valueColumns.has(col)) {
          // New value column — backfill nulls for prior rows of this analysis.
          valueColumns.set(col, new Array(numRows).fill(null));
        }
        valueColumns
          .get(col)!
          .push(metric[col as keyof SnapshotMetric] ?? null);
      }
      // Value columns seen before but not in this flat object pad with null.
      for (const [col, values] of valueColumns) {
        if (!(col in metric)) values.push(null);
      }

      numRows++;
    }
  }

  const perAnalysis: AnalysisChunkData = { numRows, d, v };
  for (const [col, values] of valueColumns) {
    perAnalysis[col] = values;
  }
  return perAnalysis;
}

// -- Decode --

export interface AnalysisMetadata {
  analysisKey: string;
  settings: ExperimentSnapshotAnalysisSettings;
  dateCreated: Date;
  status: "running" | "success" | "error";
  error?: string;
}

// Loose shape accepted by the decoder. Matches the zod validator's stored
// shape (columns typed as `unknown[]`) so callers can pass chunk documents
// straight from MongoDB without an upfront cast. The encoder guarantees
// `d` holds strings and `v` holds numbers at write time — we narrow them
// positionally inside the decoder.
type PerAnalysisChunkDataInput = {
  numRows: number;
  d: unknown[];
  v: unknown[];
  [col: string]: unknown;
};

interface MetricChunkInput {
  metricId: string;
  data: Record<string, PerAnalysisChunkDataInput>;
}

/**
 * Decode per-metric, per-analysis columnar chunks back into
 * `ExperimentSnapshotAnalysis[]`.
 *
 * Each chunk stores its rows under `data.<analysisKey>`, so the decoder
 * looks each key up in `chunkedAnalysesMeta` to hydrate dimension /
 * variation structure. Analyses whose meta is missing are skipped cleanly
 * (this is the "stale meta, fresh chunk" safety property from the
 * race-fix plan).
 *
 * @param chunks - Per-metric chunk documents (new shape).
 * @param chunkedAnalysesMeta - Shared dimension/variation metadata keyed
 *   by analysisKey (from the snapshot doc).
 * @param analysisMetadata - Per-analysis settings/status (from snapshot),
 *   each including its analysisKey. Output order mirrors this input.
 * @param filterMetricIds - Optional set of metric IDs to include.
 */
export function decodeSnapshotAnalysisChunks(
  chunks: MetricChunkInput[],
  chunkedAnalysesMeta: Record<string, AnalysisMetaEntry>,
  analysisMetadata: AnalysisMetadata[],
  filterMetricIds?: Set<string>,
): ExperimentSnapshotAnalysis[] {
  // analysisKey -> dimensionName -> { srm, variations: [{ users, metrics }] }
  type DimData = {
    srm: number;
    variations: Map<
      number,
      { users: number; metrics: Record<string, SnapshotMetric> }
    >;
  };
  const analysisMap = new Map<string, Map<string, DimData>>();

  // Seed structure from chunkedAnalysesMeta so dimensions without metric
  // rows still appear (matches legacy decoder behaviour).
  for (const [analysisKey, meta] of Object.entries(chunkedAnalysesMeta)) {
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
    analysisMap.set(analysisKey, dims);
  }

  // Process data rows from each chunk
  for (const chunk of chunks) {
    const { metricId, data } = chunk;

    // Skip if filtering and this metric isn't requested
    if (filterMetricIds && !filterMetricIds.has(metricId)) continue;

    for (const [analysisKey, perAnalysis] of Object.entries(data)) {
      const { numRows, d, v } = perAnalysis;
      if (!numRows) continue;

      const valueColumns = Object.keys(perAnalysis).filter(
        (col) => col !== "numRows" && !INDEX_COLUMNS.has(col),
      );

      // Ensure structure exists (in case chunkedAnalysesMeta is incomplete)
      if (!analysisMap.has(analysisKey))
        analysisMap.set(analysisKey, new Map());
      const dims = analysisMap.get(analysisKey)!;

      for (let i = 0; i < numRows; i++) {
        const dimName = d[i] as string;
        const vi = v[i] as number;

        // Read flat metric values, omitting nulls so absent optional fields
        // stay undefined (matching the original inline representation).
        const metric: Record<string, unknown> = {};
        for (const col of valueColumns) {
          const colValues = perAnalysis[col];
          if (!Array.isArray(colValues)) continue;
          const val = colValues[i] ?? null;
          if (val !== null) {
            metric[col] = val;
          }
        }

        if (!dims.has(dimName))
          dims.set(dimName, { srm: 0, variations: new Map() });
        const dim = dims.get(dimName)!;
        if (!dim.variations.has(vi))
          dim.variations.set(vi, { users: 0, metrics: {} });

        dim.variations.get(vi)!.metrics[metricId] =
          metric as unknown as SnapshotMetric;
      }
    }
  }

  // Reconstruct ExperimentSnapshotAnalysis[] in the order of analysisMetadata.
  return analysisMetadata.map((meta): ExperimentSnapshotAnalysis => {
    const dims = analysisMap.get(meta.analysisKey);
    const results: ExperimentReportResultDimension[] = [];

    if (dims) {
      for (const [name, dimData] of dims) {
        const maxVi = Math.max(...Array.from(dimData.variations.keys()), -1);
        const variations: SnapshotVariation[] = [];
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
      analysisKey: meta.analysisKey,
      settings: meta.settings,
      dateCreated: meta.dateCreated,
      status: meta.status,
      ...(meta.error ? { error: meta.error } : {}),
      results,
    };
  });
}

// -- Legacy chunk migration --
//
// Two-phase to keep phase 1 free of snapshot context, so it can run
// inside `BaseModel.migrate()` (which only sees the chunk doc) instead
// of relying on call-site discipline.
//
//   phase 1: `migrateLegacySnapshotAnalysisChunkData` — flat legacy
//     shape -> position-keyed records (`{ "0": {...}, "1": {...} }`).
//
//   phase 2: `remapChunkDataPositionKeysToAnalysisKeys` — rename the
//     numeric position keys to `analysisKey`s using the parent
//     snapshot's ordering.

export type MigrateLegacySnapshotAnalysisChunkInput = {
  data?: unknown;
  numRows?: unknown;
};

export type MigrateLegacySnapshotAnalysisChunkResult = {
  data: Record<string, AnalysisChunkData>;
  // Non-null when a legacy-shape chunk was translated. Null for
  // already-new-shape docs so callers can log conditionally.
  migrated: { legacyNumRows: number; analysisCount: number } | null;
};

/**
 * Phase 1: normalize a chunk document's `data` field away from the
 * legacy flat shape. Output is keyed by stringified position (`"0"`,
 * `"1"`, ...) — phase 2 (`remapChunkDataPositionKeysToAnalysisKeys`)
 * renames those positions to `analysisKey`s once snapshot context is
 * available.
 *
 * Idempotent: docs without a top-level `numRows` and without flat
 * columns at the data root pass through unchanged with `migrated: null`,
 * regardless of whether their existing keys are positions or
 * `analysisKey`s.
 */
export function migrateLegacySnapshotAnalysisChunkData(
  chunk: MigrateLegacySnapshotAnalysisChunkInput,
): MigrateLegacySnapshotAnalysisChunkResult {
  const data = (chunk.data as Record<string, unknown>) ?? {};
  const topLevelNumRows =
    typeof chunk.numRows === "number" ? chunk.numRows : undefined;
  const dataHasFlatColumns = Array.isArray(data.d);

  if (topLevelNumRows === undefined && !dataHasFlatColumns) {
    return {
      data: data as Record<string, AnalysisChunkData>,
      migrated: null,
    };
  }

  const numRows = topLevelNumRows ?? 0;
  const aColumn = Array.isArray(data.a) ? (data.a as number[]) : undefined;

  const columnEntries: Array<[string, unknown[]]> = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "a") continue;
    if (Array.isArray(value)) columnEntries.push([key, value]);
  }

  const rowsByPosition = new Map<number, number[]>();
  for (let i = 0; i < numRows; i++) {
    const position = aColumn?.[i] ?? 0;
    if (!rowsByPosition.has(position)) rowsByPosition.set(position, []);
    rowsByPosition.get(position)!.push(i);
  }

  const newData: Record<string, AnalysisChunkData> = {};
  for (const [position, rowIndices] of rowsByPosition) {
    const perAnalysis: AnalysisChunkData = {
      numRows: rowIndices.length,
      d: [],
      v: [],
    };
    for (const [col] of columnEntries) {
      if (col !== "d" && col !== "v") {
        (perAnalysis as Record<string, unknown[] | number>)[col] = [];
      }
    }
    const columnTargets: Array<[unknown[], unknown[]]> = columnEntries.map(
      ([col, values]) => [
        (perAnalysis as Record<string, unknown[] | number>)[col] as unknown[],
        values,
      ],
    );
    for (const rowIdx of rowIndices) {
      for (const [target, values] of columnTargets) {
        target.push(values[rowIdx] ?? null);
      }
    }
    newData[String(position)] = perAnalysis;
  }

  // Preserve new-shape sub-records that coexist with legacy flat
  // columns. This happens when a writer (bulkWrite path) appends a
  // `data.<analysisKey>` sub-record to a doc that still carries legacy
  // top-level `numRows` and flat `d`/`v`/value columns. Without this
  // step those sub-records would be silently dropped on the next read.
  // Legacy columns are always arrays and never collide here — we only
  // copy non-null object values. New-shape keys never collide with
  // position keys (`^\d+$`) because they begin with `an_`.
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) continue;
    if (typeof value !== "object" || value === null) continue;
    newData[key] = value as AnalysisChunkData;
  }

  return {
    data: newData,
    migrated: {
      legacyNumRows: numRows,
      analysisCount: rowsByPosition.size,
    },
  };
}

// Phase 1 produces stringified non-negative integer positions, while a
// real `analysisKey` from `buildAnalysisKey()` always starts with
// `an_`. The validator additionally requires `analysisKeySchema` keys
// to be ≥5 chars, so a pure-digit key can never be a legitimate
// `analysisKey` — making this regex sufficient to distinguish.
const POSITION_KEY_PATTERN = /^\d+$/;

/**
 * Phase 2: rename position-keyed sub-records (output of phase 1) to
 * `analysisKey`-keyed sub-records using the parent snapshot's analyses
 * ordering. Positions with no matching `analysisKey` are dropped — this
 * covers legacy snapshots whose analyses array shrank before migration
 * (orphan rows in the chunks).
 *
 * Idempotent on data already keyed by `analysisKey`: keys that don't
 * match the position pattern pass through untouched, so re-running the
 * remap on already-renamed data is a no-op.
 *
 * Generic over the value type so callers can pass either the strict
 * `AnalysisChunkData` (post-encode) or the looser validator-inferred
 * shape (post-read), since this helper only inspects keys.
 */
export function remapChunkDataPositionKeysToAnalysisKeys<T>(
  data: Record<string, T>,
  analysisKeysByPosition: string[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, perAnalysis] of Object.entries(data)) {
    if (POSITION_KEY_PATTERN.test(key)) {
      const analysisKey = analysisKeysByPosition[Number(key)];
      if (analysisKey) out[analysisKey] = perAnalysis;
    } else {
      out[key] = perAnalysis;
    }
  }
  return out;
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
