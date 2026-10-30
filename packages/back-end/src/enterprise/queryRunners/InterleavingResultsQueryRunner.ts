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
import { markPendingQueriesAsFailed } from "back-end/src/models/QueryModel";
import { cancelExternalJobsForQueries } from "back-end/src/services/queryCancellation";
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

    // Output columns are keyed by each metric's position in the frozen
    // settings list, which runAnalysis walks in the same order. Metric ids are
    // unique (validator), so this lookup is exact and survives any reordering
    // resolveInterleavingMetrics might introduce.
    const indexByMetricId = new Map(
      settings.metrics.map((m, index) => [m.id, index]),
    );

    // One query per fact table; the grouping is an execution detail the
    // analysis never sees, since column names carry the global position
    const byFactTable = new Map<string, ResolvedInterleavingMetric[]>();
    for (const m of params.metrics) {
      byFactTable.set(m.factTable.id, [
        ...(byFactTable.get(m.factTable.id) ?? []),
        m,
      ]);
    }

    // Build every fact table's SQL before starting anything. A throw after the
    // first startQuery would leave a warehouse query running with nothing to
    // cancel it by, since startAnalysis only records the query pointers once
    // this method resolves.
    const pending: { factTableId: string; sql: string }[] = [];
    for (const [factTableId, group] of byFactTable) {
      pending.push({
        factTableId,
        sql: integration.getInterleavingMetricQuery({
          interleavingExposureQuerySql: settings.interleavingExposureQuerySql,
          userIdType: settings.userIdType,
          trackingKey: settings.trackingKey,
          variationKeys: [
            settings.variations[0].key,
            settings.variations[1].key,
          ],
          startDate: settings.startDate,
          endDate: settings.endDate,
          factTable: group[0].factTable,
          metrics: group.map(({ config, metric }) => {
            const index = indexByMetricId.get(config.id);
            if (index === undefined) {
              throw new Error(
                `Interleaving metric ${config.id} is not in the snapshot settings`,
              );
            }
            return { metric, index, analyses: config.analyses };
          }),
        }),
      });
    }

    const queries: Queries = [];
    try {
      for (const { factTableId, sql } of pending) {
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
    } catch (e) {
      const started = queries.map((q) => q.query);
      if (started.length) {
        await markPendingQueriesAsFailed(
          this.context,
          started,
          "Interleaving refresh could not start all of its queries",
        );
        await cancelExternalJobsForQueries(
          this.context,
          this.integration,
          started,
          { modelId: this.model.id },
        );
      }
      throw e;
    }

    return queries;
  }

  async runAnalysis(queryMap: QueryMap): Promise<InterleavingQueryRunResult> {
    // Each query returns one aggregate row whose metric columns are keyed by
    // the metric's position in the frozen settings list, so the rows merge
    // into one record without colliding across fact tables. `users_exposed` is
    // the same in every query (same exposure CTE), so overwriting is harmless.
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
    // Interval alpha, so the CI and the table's significance colouring agree
    const { pValueThreshold } = this.model.settings;

    const results: InterleavingMetricResult[] = [];
    for (const [
      metricIndex,
      { id: metricId, analyses },
    ] of this.model.settings.metrics.entries()) {
      const col = (stat: string) =>
        read(interleavingMetricColumn(metricIndex, stat));
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
              test: pairedDeltaTest(stats, pValueThreshold),
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
              test: preferenceSignTest(
                {
                  users_pref_treatment: prefT,
                  users_pref_control: prefC,
                  users_tied: col("users_tied"),
                },
                pValueThreshold,
              ),
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

    const updated =
      await this.context.models.interleavingSnapshots.finalizeIfRunning(
        this.model.id,
        updates,
      );
    // Already finalized by the reaper or a cancel; report its state, not ours.
    return updated ?? (await this.getLatestModel());
  }
}
