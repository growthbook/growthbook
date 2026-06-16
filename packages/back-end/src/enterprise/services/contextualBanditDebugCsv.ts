// DEBUG-ONLY (gitignored): dumps contextual-bandit weight-update output to CSVs
// on disk so a run can be eyeballed against the gbstats (Python) output.
//
// This file is intentionally NOT tracked by git (see .gitignore). To enable it,
// uncomment the import + the `writeContextualBanditDebugCsvs(result)` call in
// `contextualBanditStats.ts` (search for "DEBUG CSV").
import fs from "fs";
import os from "os";
import path from "path";
import type {
  ContextualBanditSnapshot,
  ContextualLeafStatsEntry,
  MetricSettingsForStatsEngine,
} from "shared/types/stats";
import type { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import { contextualBanditAttrCol } from "shared/experiments";
import { logger } from "back-end/src/util/logger";

/**
 * Summable stat columns to emit per statistic type (decision-metric prefix is
 * applied by the caller). Mirrors the columns gbstats / the SQL fact-metric
 * query produce for each statistic type.
 */
function statColumnSuffixesForStatisticType(
  statisticType: MetricSettingsForStatsEngine["statistic_type"],
): string[] {
  switch (statisticType) {
    case "mean":
      return ["main_sum", "main_sum_squares"];
    case "mean_ra":
      return [
        "main_sum",
        "main_sum_squares",
        "covariate_sum",
        "covariate_sum_squares",
        "main_covariate_sum_product",
      ];
    case "ratio":
      return [
        "main_sum",
        "main_sum_squares",
        "denominator_sum",
        "denominator_sum_squares",
        "main_denominator_sum_product",
      ];
    case "ratio_ra":
      return [
        "main_sum",
        "main_sum_squares",
        "denominator_sum",
        "denominator_sum_squares",
        "main_denominator_sum_product",
        "covariate_sum",
        "covariate_sum_squares",
        "main_covariate_sum_product",
      ];
    default:
      return ["main_sum", "main_sum_squares"];
  }
}

/** Quote a single CSV cell, escaping embedded quotes/commas/newlines. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

/** SRM values dumped to the debug `srm_<n>.csv` file. */
export type ContextualBanditSrmDebugValues = {
  statistic: number;
  pValue: number;
  numLeaves: number;
  numUpdates: number;
  numVariations: number;
};

/**
 * Debug helper: dump the TypeScript contextual-bandit weight output to CSVs on
 * disk so a run can be eyeballed against the gbstats (Python) output. Mirrors
 * the per-leaf / per-context CSVs the Python path used to write while the
 * TypeScript port was being validated.
 *
 * Best-effort and side-effect-only: any failure (e.g. no writable Desktop dir
 * in a server environment) is swallowed so it can never break a real run.
 */
export function writeContextualBanditDebugCsvs(
  snapshot: ContextualBanditSnapshot,
  snapshotUpdateCount: number,
  rows?: ExperimentMetricQueryResponseRows,
  metricSettings?: MetricSettingsForStatsEngine,
  srm?: ContextualBanditSrmDebugValues,
): void {
  try {
    const dir = path.join(os.homedir(), "Desktop");
    if (!fs.existsSync(dir)) return;

    // Suffix every file with the CB's weight-update generation so successive
    // runs don't overwrite each other (e.g. "context_results_2.csv").
    const fileName = (base: string): string =>
      `${base}_${snapshotUpdateCount}.csv`;

    const attributes = snapshot.attributes ?? [];
    const leafMap = snapshot.leaf_map ?? [];
    const responses = snapshot.responses ?? [];

    // Format a context as a tuple of quoted attribute values, e.g.
    // "('east', 'browser_1')".
    const contextTuple = (context: Record<string, unknown>): string =>
      `(${attributes.map((attr) => `'${context[attr] ?? ""}'`).join(", ")})`;

    // leaf-map.csv: one row per observed context -> assigned leaf id.
    const leafMapCsv = toCsv(
      ["context", "leafId"],
      leafMap.map((entry) => [contextTuple(entry.context), entry.leafId]),
    );

    // context-results.csv: one row per context with its per-variation stats and
    // the (leaf-level) updated weights it inherits.
    const contextResultsCsv = toCsv(
      [
        "context",
        "leafId",
        "sampleSizePerVariation",
        "sampleMeans",
        "sampleVariances",
        "updatedWeights",
        "bestArmProbabilities",
        "updateMessage",
        "error",
      ],
      responses.map((r, i) => [
        leafMap[i] ? contextTuple(leafMap[i].context) : r.context,
        leafMap[i]?.leafId ?? "",
        r.sampleSizePerVariation,
        r.sampleMeans,
        r.sampleVariances,
        r.updatedWeights,
        r.bestArmProbabilities,
        r.updateMessage,
        r.error,
      ]),
    );

    // leaf-results.csv: one row per unique leaf with its aggregated sample
    // stats and updated weights.
    const leafStatsById = new Map<number, ContextualLeafStatsEntry>(
      (snapshot.leaf_stats ?? []).map((s) => [s.leafId, s]),
    );
    const leafResults = new Map<
      number,
      { weights: unknown; probs: unknown; message: unknown; error: unknown }
    >();
    responses.forEach((r, i) => {
      const leafId = leafMap[i]?.leafId;
      if (leafId === undefined || leafResults.has(leafId)) return;
      leafResults.set(leafId, {
        weights: r.updatedWeights,
        probs: r.bestArmProbabilities,
        message: r.updateMessage,
        error: r.error,
      });
    });
    const leafResultsCsv = toCsv(
      [
        "leafId",
        "sampleSizePerVariation",
        "sampleMeans",
        "sampleVariances",
        "updatedWeights",
        "bestArmProbabilities",
        "updateMessage",
        "error",
      ],
      [...leafResults.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([leafId, v]) => {
          const stats = leafStatsById.get(leafId);
          return [
            leafId,
            stats?.sampleSizePerVariation,
            stats?.sampleMeans,
            stats?.sampleVariances,
            v.weights,
            v.probs,
            v.message,
            v.error,
          ];
        }),
    );

    fs.writeFileSync(path.join(dir, fileName("leaf_map")), leafMapCsv);
    fs.writeFileSync(
      path.join(dir, fileName("context_results")),
      contextResultsCsv,
    );
    fs.writeFileSync(path.join(dir, fileName("leaf_results")), leafResultsCsv);

    // srm_<n>.csv: the contextual SRM object (chi-square statistic, derived
    // p-value, and the dof inputs). Only emitted when an SRM result exists.
    if (srm) {
      const srmCsv = toCsv(
        ["statistic", "pValue", "numLeaves", "numUpdates", "numVariations"],
        [
          [
            srm.statistic,
            srm.pValue,
            srm.numLeaves,
            srm.numUpdates,
            srm.numVariations,
          ],
        ],
      );
      fs.writeFileSync(path.join(dir, fileName("srm")), srmCsv);
    }

    // queries_modal_results.csv: the raw decision-metric query rows that feed the
    // weight engine, structured like the "Queries" modal. The leading row index
    // and the `m0_id` column are omitted, and the stat columns are chosen from
    // the metric's statistic type.
    if (rows && metricSettings) {
      const metricPrefix = "m0_";
      const attrCols = attributes.map(contextualBanditAttrCol);
      const statCols = statColumnSuffixesForStatisticType(
        metricSettings.statistic_type,
      ).map((suffix) => `${metricPrefix}${suffix}`);
      const headers = ["variation", ...attrCols, "users", "count", ...statCols];
      const queriesModalCsv = toCsv(
        headers,
        rows.map((row) => {
          const r = row as Record<string, unknown>;
          return [
            r.variation,
            ...attrCols.map((col) => r[col]),
            r.users,
            r.count,
            ...statCols.map((col) => r[col]),
          ];
        }),
      );
      fs.writeFileSync(
        path.join(dir, fileName("queries_modal_results")),
        queriesModalCsv,
      );
    }
  } catch (e) {
    logger.warn(
      `Failed to write contextual bandit debug CSVs: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}
