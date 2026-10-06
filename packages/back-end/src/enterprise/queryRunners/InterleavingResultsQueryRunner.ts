import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  InterleavingMetricConfig,
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_ITEM_ID_COLUMN,
} from "shared/validators";
import { isFactMetric } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { InterleavingMetricQueryMetric } from "shared/types/integrations";
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

type MetricGroup = {
  factTableId: string;
  // Ordered: index i maps to the query's m{i}_ column prefix
  metricConfigs: InterleavingMetricConfig[];
};

export class InterleavingResultsQueryRunner extends QueryRunner<
  InterleavingSnapshotInterface,
  InterleavingResultsQueryParams,
  InterleavingQueryRunResult
> {
  private snapshotSettings?: InterleavingSnapshotSettings;
  // One query per fact table, keyed by the query name (the fact table id)
  private metricGroups: Record<string, MetricGroup> = {};

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
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

    // Validate each metric and group by fact table
    const groups: Record<
      string,
      MetricGroup & {
        queryMetrics: InterleavingMetricQueryMetric[];
        factTableSql: string;
      }
    > = {};
    for (const config of settings.metrics) {
      const metric = metricMap.get(config.id);
      if (!metric || !isFactMetric(metric)) {
        throw new Error(`Interleaving metric not found: ${config.id}`);
      }
      if (metric.metricType !== "mean" && metric.metricType !== "proportion") {
        throw new Error(
          `Interleaving metrics must be mean or proportion metrics: ${config.id}`,
        );
      }
      const factTable = metric.numerator
        ? factTableMap.get(metric.numerator.factTableId)
        : null;
      if (!factTable) {
        throw new Error(`Fact table not found for metric ${config.id}`);
      }
      if (!factTable.userIdTypes.includes(settings.userIdType)) {
        throw new Error(
          `Interleaving metric ${config.id} requires the '${settings.userIdType}' identifier type on its fact table`,
        );
      }
      const hasColumn = (column: string) =>
        factTable.columns.some((c) => c.column === column && !c.deleted);
      if (!hasColumn(INTERLEAVING_ITEM_ID_COLUMN)) {
        throw new Error(
          `Interleaving metric ${config.id} requires an '${INTERLEAVING_ITEM_ID_COLUMN}' column on its fact table`,
        );
      }
      if (
        config.attributionType === "paired" &&
        !hasColumn(INTERLEAVING_INTERLEAVE_ID_COLUMN)
      ) {
        throw new Error(
          `Interleaving metric ${config.id} is configured for the paired analysis but its fact table has no '${INTERLEAVING_INTERLEAVE_ID_COLUMN}' column`,
        );
      }

      const numeratorColumn = metric.numerator?.column;
      const valueColumn =
        metric.metricType === "mean" &&
        numeratorColumn &&
        !numeratorColumn.startsWith("$$")
          ? numeratorColumn
          : null;

      const group = (groups[factTable.id] = groups[factTable.id] ?? {
        factTableId: factTable.id,
        metricConfigs: [],
        queryMetrics: [],
        factTableSql: factTable.sql,
      });
      group.metricConfigs.push(config);
      group.queryMetrics.push({
        attributionType: config.attributionType,
        metricType: metric.metricType as FactMetricInterface["metricType"] &
          ("mean" | "proportion"),
        valueColumn,
      });
    }

    const queries: Queries = [];
    for (const group of Object.values(groups)) {
      this.metricGroups[group.factTableId] = {
        factTableId: group.factTableId,
        metricConfigs: group.metricConfigs,
      };

      const sql = this.integration.getInterleavingMetricQuery({
        exposureQuery: settings.query,
        userIdType: settings.userIdType,
        trackingKey: settings.trackingKey,
        variationNames: settings.variationNames,
        startDate: settings.startDate,
        endDate: settings.endDate,
        factTableSql: group.factTableSql,
        metrics: group.queryMetrics,
      });

      queries.push(
        await this.startQuery({
          name: group.factTableId,
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
    let maxUsers = 0;

    for (const group of Object.values(this.metricGroups)) {
      const doc = queryMap.get(group.factTableId);
      const rows = (doc?.result ?? doc?.rawResult ?? []) as Record<
        string,
        number
      >[];
      const row = rows[0];

      group.metricConfigs.forEach((config, i) => {
        if (!row) {
          treatmentMetrics[config.id] = {
            value: 0,
            cr: 0,
            users: 0,
            errorMessage: "NO_ROWS_RETURNED",
          };
          baselineMetrics[config.id] = { value: 0, cr: 0, users: 0 };
          return;
        }

        const col = (name: string) => row[`m${i}_${name}`] || 0;

        switch (config.attributionType) {
          case "paired": {
            const stats: PairedSufficientStats = {
              users: col("users"),
              sum_x: col("sum_x"),
              sum_xx: col("sum_xx"),
              sum_y: col("sum_y"),
              sum_yy: col("sum_yy"),
              sum_n: col("sum_n"),
              sum_nn: col("sum_nn"),
              sum_xy: col("sum_xy"),
              sum_xn: col("sum_xn"),
              sum_yn: col("sum_yn"),
            };
            maxUsers = Math.max(maxUsers, stats.users);
            const test = pairedDeltaTest(stats);
            const crControl = stats.sum_n > 0 ? stats.sum_y / stats.sum_n : 0;
            const crTreatment = stats.sum_n > 0 ? stats.sum_x / stats.sum_n : 0;
            baselineMetrics[config.id] = {
              value: stats.sum_y,
              cr: crControl,
              users: stats.users,
            };
            treatmentMetrics[config.id] = {
              value: stats.sum_x,
              cr: crTreatment,
              users: stats.users,
              expected: test.expected,
              ci: [test.ci[0] ?? -Infinity, test.ci[1] ?? Infinity],
              pValue: test.pValue ?? undefined,
              uplift: test.uplift,
              errorMessage: test.errorMessage ?? undefined,
            };
            return;
          }
          case "ownershipByExposureCount": {
            const prefT = col("users_pref_treatment");
            const prefC = col("users_pref_control");
            const usersExposed = row.users_exposed || 0;
            const ties = Math.max(0, usersExposed - prefT - prefC);
            maxUsers = Math.max(maxUsers, usersExposed);
            const test = ownershipSignTest({
              users_pref_treatment: prefT,
              users_pref_control: prefC,
              users_tied: ties,
            });
            baselineMetrics[config.id] = {
              value: prefC,
              cr: usersExposed > 0 ? prefC / usersExposed : 0,
              users: usersExposed,
            };
            treatmentMetrics[config.id] = {
              value: prefT,
              cr: usersExposed > 0 ? prefT / usersExposed : 0,
              users: usersExposed,
              expected: test.expected,
              ci: [test.ci[0] ?? -Infinity, test.ci[1] ?? Infinity],
              pValue: test.pValue ?? undefined,
              uplift: test.uplift,
              errorMessage: test.errorMessage ?? undefined,
            };
            return;
          }
          default: {
            const unknownType: never = config;
            throw new Error(
              `Unknown attribution type: ${JSON.stringify(unknownType)}`,
            );
          }
        }
      });
    }

    const dimension: ExperimentReportResultDimension = {
      name: "All",
      srm: 1,
      variations: [
        { users: maxUsers, metrics: baselineMetrics },
        { users: maxUsers, metrics: treatmentMetrics },
      ],
    };

    return { results: [dimension] };
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
