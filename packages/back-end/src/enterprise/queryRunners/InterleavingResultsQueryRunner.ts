import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  InterleavingMetricResult,
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import type { InterleavingMetricQueryResponseRows } from "shared/types/integrations";
import { preferenceSignTest, pairedDeltaTest } from "stats-ts";
import { QueryMap, QueryRunner } from "back-end/src/queryRunners/QueryRunner";
import { ResolvedInterleavingMetric } from "back-end/src/enterprise/services/interleavingMetrics";
import { interleavingMetricColumn } from "back-end/src/integrations/sql/queries/interleaving-metric-query";

export type InterleavingResultsQueryParams = {
  snapshotSettings: InterleavingSnapshotSettings;
  // Resolved by the caller before the snapshot is created, so a metric that
  // fails validation never produces a snapshot
  metrics: ResolvedInterleavingMetric[];
};

export type InterleavingQueryRunResult = {
  results: InterleavingMetricResult[];
};

export class InterleavingResultsQueryRunner extends QueryRunner<
  InterleavingSnapshotInterface,
  InterleavingResultsQueryParams,
  InterleavingQueryRunResult
> {
  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: InterleavingResultsQueryParams): Promise<Queries> {
    const settings = params.snapshotSettings;

    const { integration } = this;
    if (
      !integration.getInterleavingMetricQuery ||
      !integration.runInterleavingMetricQuery
    ) {
      throw new Error(
        "This datasource does not support interleaving queries yet",
      );
    }
    // Bound so the narrowing survives into the query's run callback
    const runInterleavingMetricQuery =
      integration.runInterleavingMetricQuery.bind(integration);

    // One query per fact table; output columns are keyed by metric id, so
    // the grouping is an execution detail the analysis never sees
    const byFactTable = new Map<string, ResolvedInterleavingMetric[]>();
    for (const m of params.metrics) {
      byFactTable.set(m.factTable.id, [
        ...(byFactTable.get(m.factTable.id) ?? []),
        m,
      ]);
    }

    const queries: Queries = [];
    for (const [factTableId, group] of byFactTable) {
      const sql = integration.getInterleavingMetricQuery({
        exposureQuery: settings.exposureQuery,
        userIdType: settings.userIdType,
        trackingKey: settings.trackingKey,
        variationKeys: [settings.variations[0].key, settings.variations[1].key],
        startDate: settings.startDate,
        endDate: settings.endDate,
        factTable: group[0].factTable,
        metrics: group.map(({ config, metric }) => ({
          metric,
          analyses: config.analyses,
        })),
      });

      queries.push(
        await this.startQuery({
          name: factTableId,
          query: sql,
          dependencies: [],
          run: async (query, setExternalId, queryMetadata) => {
            const res = await runInterleavingMetricQuery(
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
    // Each query returns one aggregate row whose metric columns are keyed by
    // metric id, so the rows merge into one record. `users_exposed` is the
    // same in every query (same exposure CTE), so overwriting it is harmless.
    // QueryMap is untyped at this boundary.
    const row: Record<string, number> = {};
    for (const [name, query] of queryMap) {
      const rows = query.result as InterleavingMetricQueryResponseRows | null;
      if (!rows?.[0]) {
        throw new Error(`Interleaving query ${name} returned no rows`);
      }
      Object.assign(row, rows[0]);
    }

    const read = (name: string) => {
      const value = row[name];
      if (value === undefined) {
        throw new Error(`Interleaving query results are missing ${name}`);
      }
      return value;
    };
    const usersExposed = read("users_exposed");

    const results: InterleavingMetricResult[] = [];
    for (const { id: metricId, analyses } of this.model.frozenSettings
      .metrics) {
      const col = (stat: string) =>
        read(interleavingMetricColumn(metricId, stat));
      for (const analysis of analyses) {
        switch (analysis.type) {
          case "paired": {
            const stats = {
              users: col("users"),
              treatment_sum: col("treatment_sum"),
              treatment_sum_squares: col("treatment_sum_squares"),
              control_sum: col("control_sum"),
              control_sum_squares: col("control_sum_squares"),
              exposures_sum: col("exposures_sum"),
              exposures_sum_squares: col("exposures_sum_squares"),
              treatment_control_sum_product: col(
                "treatment_control_sum_product",
              ),
              treatment_exposures_sum_product: col(
                "treatment_exposures_sum_product",
              ),
              control_exposures_sum_product: col(
                "control_exposures_sum_product",
              ),
            };
            const perExposure = (v: number) =>
              stats.exposures_sum > 0 ? v / stats.exposures_sum : 0;
            results.push({
              metricId,
              analysis,
              users: stats.users,
              denominator: stats.exposures_sum,
              control: {
                value: stats.control_sum,
                cr: perExposure(stats.control_sum),
              },
              treatment: {
                value: stats.treatment_sum,
                cr: perExposure(stats.treatment_sum),
              },
              test: pairedDeltaTest(stats),
            });
            break;
          }
          case "preference": {
            const prefT = col("users_pref_treatment");
            const prefC = col("users_pref_control");
            const nonTiedUsers = prefT + prefC;
            const perUser = (v: number) =>
              nonTiedUsers > 0 ? v / nonTiedUsers : 0;
            results.push({
              metricId,
              analysis,
              users: usersExposed,
              denominator: nonTiedUsers,
              control: { value: prefC, cr: perUser(prefC) },
              treatment: { value: prefT, cr: perUser(prefT) },
              test: preferenceSignTest({
                users_pref_treatment: prefT,
                users_pref_control: prefC,
                users_tied: col("users_tied"),
              }),
            });
            break;
          }
          default: {
            const unknown: never = analysis;
            throw new Error(`Unknown analysis: ${JSON.stringify(unknown)}`);
          }
        }
      }
    }

    return { results };
  }

  async getLatestModel(): Promise<InterleavingSnapshotInterface> {
    const obj = await this.context.models.interleavingSnapshots.getById(
      this.model.id,
    );
    if (!obj) {
      throw new Error(`Could not load snapshot model: ${this.model.id}`);
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
