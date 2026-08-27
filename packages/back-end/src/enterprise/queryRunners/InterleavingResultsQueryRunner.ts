import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  InterleavingEstimator,
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_PAIRED_COVERAGE_THRESHOLD,
} from "shared/validators";
import { isFactMetric } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
} from "shared/types/report";
import type { SnapshotVariation } from "shared/types/experiment-snapshot";
import {
  ownershipSignTest,
  pairedDeltaTest,
  PairedSufficientStats,
} from "stats-ts";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { QueryMap, QueryRunner } from "back-end/src/queryRunners/QueryRunner";

export type InterleavingResultsQueryParams = {
  snapshotSettings: InterleavingSnapshotSettings;
};

export type InterleavingQueryRunResult = {
  results: ExperimentReportResultDimension[];
  metricEstimators: Record<string, InterleavingEstimator>;
  // Share of engagement events with a non-NULL interleave_id, per metric
  // whose fact table has the column (drives the estimator choice)
  metricInterleaveIdCoverage: Record<string, number>;
};

/** Variations shown in the results UI: the two ranker list names. */
export function getInterleavingReportVariations(
  variationNames: [string, string],
): ExperimentReportVariation[] {
  return variationNames.map((name, index) => ({
    id: String(index),
    name,
    weight: 0.5,
    index,
  }));
}

export class InterleavingResultsQueryRunner extends QueryRunner<
  InterleavingSnapshotInterface,
  InterleavingResultsQueryParams,
  InterleavingQueryRunResult
> {
  private snapshotSettings?: InterleavingSnapshotSettings;
  // Query shape per metric: "combined" when the fact table has an
  // interleave_id column (final estimator decided by coverage at analysis
  // time), "ownership" when it does not
  private metricQueryShapes: Record<string, "combined" | "ownership"> = {};
  private metricsById: Map<string, FactMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunInterleavingQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: InterleavingResultsQueryParams): Promise<Queries> {
    this.snapshotSettings = params.snapshotSettings;
    const settings = params.snapshotSettings;

    if (
      !this.integration.getInterleavingMetricQuery ||
      !this.integration.runInterleavingMetricQuery
    ) {
      throw new Error(
        "This datasource does not support interleaving queries yet",
      );
    }

    const metricMap = await getMetricMap(this.context);
    const factTableMap = await getFactTableMap(this.context);

    const queries: Queries = [];
    for (const metricId of settings.metricIds) {
      const metric = metricMap.get(metricId);
      if (!metric || !isFactMetric(metric)) {
        throw new Error(`Interleaving metric not found: ${metricId}`);
      }
      if (metric.metricType !== "mean" && metric.metricType !== "proportion") {
        throw new Error(
          `Interleaving metrics must be mean or proportion metrics: ${metricId}`,
        );
      }
      const factTable = metric.numerator
        ? factTableMap.get(metric.numerator.factTableId)
        : null;
      if (!factTable) {
        throw new Error(`Fact table not found for metric ${metricId}`);
      }

      // A fact table with an interleave_id column gets the combined query
      // (paired + ownership inputs + coverage); the estimator itself is
      // decided at analysis time from observed coverage, since a column can
      // exist while its rows are NULL (NULL join keys never match)
      const factTableHasInterleaveId = factTable.columns.some(
        (c) => c.column === INTERLEAVING_INTERLEAVE_ID_COLUMN && !c.deleted,
      );
      const shape = factTableHasInterleaveId ? "combined" : "ownership";
      this.metricQueryShapes[metricId] = shape;
      this.metricsById.set(metricId, metric);

      const numeratorColumn = metric.numerator?.column;
      const valueColumn =
        metric.metricType === "mean" &&
        numeratorColumn &&
        !numeratorColumn.startsWith("$$")
          ? numeratorColumn
          : null;

      const sql = this.integration.getInterleavingMetricQuery({
        estimator: shape === "combined" ? "paired" : "ownership",
        exposureQuery: settings.query,
        userIdType: settings.userIdType,
        trackingKey: settings.trackingKey,
        variationNames: settings.variationNames,
        startDate: settings.startDate,
        endDate: settings.endDate,
        factTableSql: factTable.sql,
        metricType: metric.metricType,
        valueColumn,
      });

      queries.push(
        await this.startQuery({
          name: metricId,
          query: sql,
          dependencies: [],
          run: async (query, setExternalId, queryMetadata) => {
            const res = await this.integration.runInterleavingMetricQuery!(
              query,
              setExternalId,
              queryMetadata,
            );
            return { rows: res.rows };
          },
          queryType: "interleavingMetric",
        }),
      );
    }

    return queries;
  }

  async runAnalysis(queryMap: QueryMap): Promise<InterleavingQueryRunResult> {
    const settings = this.snapshotSettings;
    if (!settings) {
      throw new Error(
        "InterleavingResultsQueryRunner: snapshotSettings missing in runAnalysis",
      );
    }

    const baselineMetrics: SnapshotVariation["metrics"] = {};
    const treatmentMetrics: SnapshotVariation["metrics"] = {};
    const metricEstimators: Record<string, InterleavingEstimator> = {};
    const metricInterleaveIdCoverage: Record<string, number> = {};
    let maxUsers = 0;

    for (const metricId of settings.metricIds) {
      const doc = queryMap.get(metricId);
      const rows = (doc?.result ?? doc?.rawResult ?? []) as Record<
        string,
        number
      >[];
      const row = rows[0];
      const shape = this.metricQueryShapes[metricId] ?? "ownership";

      if (!row) {
        metricEstimators[metricId] = "ownership";
        treatmentMetrics[metricId] = {
          value: 0,
          cr: 0,
          users: 0,
          errorMessage: "NO_ROWS_RETURNED",
        };
        baselineMetrics[metricId] = { value: 0, cr: 0, users: 0 };
        continue;
      }

      // Decide the estimator: paired needs enough events to actually join
      let estimator: InterleavingEstimator = "ownership";
      if (shape === "combined") {
        const total = row.events_total || 0;
        const coverage = total > 0 ? (row.events_matched || 0) / total : 0;
        metricInterleaveIdCoverage[metricId] = coverage;
        if (coverage >= INTERLEAVING_PAIRED_COVERAGE_THRESHOLD) {
          estimator = "paired";
        }
      }
      metricEstimators[metricId] = estimator;

      if (estimator === "paired") {
        const stats = row as unknown as PairedSufficientStats;
        const users = stats.users || 0;
        maxUsers = Math.max(maxUsers, users);
        const test = pairedDeltaTest(stats);
        const crControl = stats.sum_n > 0 ? stats.sum_y / stats.sum_n : 0;
        const crTreatment = stats.sum_n > 0 ? stats.sum_x / stats.sum_n : 0;
        baselineMetrics[metricId] = {
          value: stats.sum_y || 0,
          cr: crControl,
          users,
        };
        treatmentMetrics[metricId] = {
          value: stats.sum_x || 0,
          cr: crTreatment,
          users,
          expected: test.expected,
          ci: [test.ci[0] ?? -Infinity, test.ci[1] ?? Infinity],
          pValue: test.pValue ?? undefined,
          uplift: test.uplift,
          errorMessage: test.errorMessage ?? undefined,
        };
      } else {
        // Ownership sign test; the combined shape returns the same
        // preference-count columns as the ownership-only query
        const prefT = row.users_pref_treatment || 0;
        const prefC = row.users_pref_control || 0;
        const usersExposed = row.users_exposed || 0;
        const ties = Math.max(0, usersExposed - prefT - prefC);
        maxUsers = Math.max(maxUsers, usersExposed);
        const test = ownershipSignTest({
          users_pref_treatment: prefT,
          users_pref_control: prefC,
          users_tied: ties,
        });
        baselineMetrics[metricId] = {
          value: prefC,
          cr: usersExposed > 0 ? prefC / usersExposed : 0,
          users: usersExposed,
        };
        treatmentMetrics[metricId] = {
          value: prefT,
          cr: usersExposed > 0 ? prefT / usersExposed : 0,
          users: usersExposed,
          expected: test.expected,
          ci: [test.ci[0] ?? -Infinity, test.ci[1] ?? Infinity],
          pValue: test.pValue ?? undefined,
          uplift: test.uplift,
          errorMessage: test.errorMessage ?? undefined,
        };
      }
    }

    const dimension: ExperimentReportResultDimension = {
      name: "All",
      srm: 1,
      variations: [
        { users: maxUsers, metrics: baselineMetrics },
        { users: maxUsers, metrics: treatmentMetrics },
      ],
    };

    return {
      results: [dimension],
      metricEstimators,
      metricInterleaveIdCoverage,
    };
  }

  async getLatestModel(): Promise<InterleavingSnapshotInterface> {
    const obj = await this.context.models.interleavingSnapshots.getById(
      this.model.id,
    );
    if (!obj) {
      throw new Error(`Could not load interleaving snapshot: ${this.model.id}`);
    }
    return obj;
  }

  async updateModel({
    status,
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date;
    result?: InterleavingQueryRunResult;
    error?: string;
  }): Promise<InterleavingSnapshotInterface> {
    const updates: UpdateProps<InterleavingSnapshotInterface> = {
      queries,
      ...(runStarted ? { runStarted } : {}),
      ...(error !== undefined ? { error } : {}),
      status:
        status === "running"
          ? "running"
          : status === "failed"
            ? "error"
            : "success",
    };

    if (status === "succeeded" && result) {
      updates.results = result.results;
      updates.metricEstimators = result.metricEstimators;
      updates.metricInterleaveIdCoverage = result.metricInterleaveIdCoverage;
    }

    await this.context.models.interleavingSnapshots.updateById(
      this.model.id,
      updates,
    );

    return {
      ...this.model,
      ...updates,
    };
  }
}
