import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotMetric,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import { ExperimentReportResultDimension } from "shared/types/report";

// Index columns identify which (analysis, dimension, variation) a row belongs to.
// The metricId is a document-level field, not a column.
const INDEX_COLUMNS = new Set(["a", "d", "v"]);

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
  chunkedAnalysesMeta: AnalysisMetaEntry[];
}

// -- Encode --

/**
 * Encode snapshot analyses into per-metric columnar documents.
 * Each metric gets its own chunk. Meta data (srm, variation users) is
 * extracted once and returned separately for storage on the snapshot doc.
 */
export function encodeSnapshotAnalysisChunks(
  analyses: ExperimentSnapshotAnalysis[],
  metricOrdering: string[],
): EncodeResult {
  // Extract chunkedAnalysesMeta (shared across all metrics)
  const chunkedAnalysesMeta: AnalysisMetaEntry[] = analyses.map((analysis) => ({
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
    const data: Record<string, unknown[]> = { a: [], d: [], v: [] };
    const valueColumns = new Set<string>();
    let numRows = 0;

    for (let ai = 0; ai < analyses.length; ai++) {
      const analysis = analyses[ai];
      for (const dim of analysis.results) {
        for (let vi = 0; vi < dim.variations.length; vi++) {
          const metric = dim.variations[vi].metrics[metricId];
          if (!metric) continue;

          data.a.push(ai);
          data.d.push(dim.name);
          data.v.push(vi);

          for (const col of Object.keys(metric)) {
            if (!valueColumns.has(col)) {
              valueColumns.add(col);
              // Backfill nulls for previous rows
              data[col] = new Array(numRows).fill(null);
            }
            data[col].push(metric[col as keyof SnapshotMetric] ?? null);
          }
          // For any known value columns not in this flat object, push null
          for (const col of valueColumns) {
            if (!(col in metric)) {
              data[col].push(null);
            }
          }

          numRows++;
        }
      }
    }

    if (numRows > 0) {
      metricChunks.set(metricId, { numRows, data });
    }
  }

  return { metricChunks, chunkedAnalysesMeta };
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
 * @param chunkedAnalysesMeta - Shared dimension/variation metadata (from snapshot doc)
 * @param analysisMetadata - Per-analysis settings/status (from snapshot doc)
 * @param filterMetricIds - Optional set of metric IDs to include
 */
export function decodeSnapshotAnalysisChunks(
  chunks: MetricChunkInput[],
  chunkedAnalysesMeta: AnalysisMetaEntry[],
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

  // Initialize structure from chunkedAnalysesMeta
  for (let ai = 0; ai < chunkedAnalysesMeta.length; ai++) {
    const meta = chunkedAnalysesMeta[ai];
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
    const valueColumns = Object.keys(data).filter(
      (col) => !INDEX_COLUMNS.has(col),
    );

    for (let i = 0; i < numRows; i++) {
      const ai = dataA[i];
      const dimName = dataD[i];
      const vi = dataV[i];

      // Read flat metric values, omitting nulls so absent optional fields
      // stay undefined (matching the original inline representation).
      const metric: Record<string, unknown> = {};
      for (const col of valueColumns) {
        const val = data[col]?.[i] ?? null;
        if (val !== null) {
          metric[col] = val;
        }
      }

      // Ensure structure exists (in case chunkedAnalysesMeta is incomplete)
      if (!analysisMap.has(ai)) analysisMap.set(ai, new Map());
      const dims = analysisMap.get(ai)!;
      if (!dims.has(dimName))
        dims.set(dimName, { srm: 0, variations: new Map() });
      const dim = dims.get(dimName)!;
      if (!dim.variations.has(vi))
        dim.variations.set(vi, { users: 0, metrics: {} });

      dim.variations.get(vi)!.metrics[metricId] =
        metric as unknown as SnapshotMetric;
    }
  }

  // Reconstruct ExperimentSnapshotAnalysis[]
  return analysisMetadata.map((meta, ai): ExperimentSnapshotAnalysis => {
    const dims = analysisMap.get(ai);
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
 * Helper to extract chunkedAnalysesMeta and analysisMetadata from a snapshot,
 * used by populateChunkedAnalyses in the chunk model.
 */
export function getChunkedAnalysesMetaFromSnapshot(
  snapshot: ExperimentSnapshotInterface,
): {
  chunkedAnalysesMeta: AnalysisMetaEntry[];
  analysisMetadata: AnalysisMetadata[];
} {
  return {
    chunkedAnalysesMeta: snapshot.chunkedAnalysesMeta ?? [],
    analysisMetadata: snapshot.analyses.map((a) => ({
      settings: a.settings,
      dateCreated: a.dateCreated,
      status: a.status,
      ...(a.error ? { error: a.error } : {}),
    })),
  };
}
