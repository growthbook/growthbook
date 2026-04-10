import type { ExperimentReportResultDimension } from "shared/types/report";
import type {
  ExperimentSnapshotMetricResultInterface,
  SnapshotVariation,
} from "shared/types/experiment-snapshot";
import { parseSliceMetricId } from "shared/experiments";

function collectMetricIdsForDimension(
  dim: ExperimentReportResultDimension,
): string[] {
  const ids = new Set<string>();
  for (const v of dim.variations) {
    for (const k of Object.keys(v.metrics || {})) {
      ids.add(k);
    }
  }
  return Array.from(ids);
}

/**
 * Splits a full `results` array into one persisted row per (metricId × dimensionName).
 */
export function splitAnalysisResultsToMetricResultRows(
  results: ExperimentReportResultDimension[],
  ctx: {
    organization: string;
    snapshotId: string;
    analysisIndex: number;
  },
): Omit<ExperimentSnapshotMetricResultInterface, "id">[] {
  const out: Omit<ExperimentSnapshotMetricResultInterface, "id">[] = [];

  results.forEach((dim) => {
    const metricIds = collectMetricIdsForDimension(dim);
    for (const metricId of metricIds) {
      const { baseMetricId } = parseSliceMetricId(metricId);
      const variations = dim.variations.map((v) => {
        const m = v.metrics[metricId];
        if (!m) {
          throw new Error(
            `splitAnalysisResults: missing metric ${metricId} for dimension ${dim.name}`,
          );
        }
        return { users: v.users, metric: m };
      });

      out.push({
        organization: ctx.organization,
        snapshotId: ctx.snapshotId,
        analysisIndex: ctx.analysisIndex,
        metricId,
        parentMetricId: baseMetricId,
        dimensionName: dim.name,
        dimensionValue: dim.name,
        srm: dim.srm,
        variations,
      });
    }
  });

  return out;
}

/**
 * Merges metric result rows back into `ExperimentReportResultDimension[]` (full analysis shape).
 */
export function mergeMetricResultRowsToAnalysisResults(
  rows: ExperimentSnapshotMetricResultInterface[],
): ExperimentReportResultDimension[] {
  const byKey = new Map<
    string,
    {
      name: string;
      srm: number;
      variations: SnapshotVariation[];
    }
  >();

  const sorted = [...rows].sort((a, b) => {
    if (a.dimensionValue !== b.dimensionValue) {
      return a.dimensionValue.localeCompare(b.dimensionValue);
    }
    return a.metricId.localeCompare(b.metricId);
  });

  for (const row of sorted) {
    const key = row.dimensionValue;
    let dim = byKey.get(key);
    if (!dim) {
      dim = {
        name: row.dimensionValue,
        srm: row.srm,
        variations: row.variations.map((v) => ({
          users: v.users,
          metrics: {},
        })),
      };
      byKey.set(key, dim);
    }

    row.variations.forEach((v, idx) => {
      if (!dim!.variations[idx]) {
        dim!.variations[idx] = { users: v.users, metrics: {} };
      }
      dim!.variations[idx].users = Math.max(
        dim!.variations[idx].users,
        v.users,
      );
      dim!.variations[idx].metrics[row.metricId] = v.metric;
    });
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({
      name: d.name,
      srm: d.srm,
      variations: d.variations,
    }));
}
