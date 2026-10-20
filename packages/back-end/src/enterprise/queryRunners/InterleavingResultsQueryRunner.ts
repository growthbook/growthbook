import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  InterleavingMetricResult,
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import type { InterleavingMetricQueryResponseRows } from "shared/types/integrations";
import type { FactTableInterface } from "shared/types/fact-table";
import { ownershipSignTest, pairedDeltaTest } from "stats-ts";
import { QueryMap, QueryRunner } from "back-end/src/queryRunners/QueryRunner";
import {
  ResolvedInterleavingMetric,
  resolveInterleavingMetrics,
} from "back-end/src/enterprise/services/interleavingMetrics";

export type InterleavingResultsQueryParams = {
  snapshotSettings: InterleavingSnapshotSettings;
};

export type InterleavingQueryRunResult = {
  results: InterleavingMetricResult[];
};

// One query per fact table, keyed by the fact table id (also the query name);
// metric index i in a group maps to the m{i}_ columns
type FactTableGroup = {
  factTable: FactTableInterface;
  metrics: ResolvedInterleavingMetric[];
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

  // Derived from settings (not cached) so runAnalysis works on a fresh
  // runner instance, e.g. when query status is refreshed after a restart
  private async groupByFactTable(
    settings: InterleavingSnapshotSettings,
  ): Promise<Map<string, FactTableGroup>> {
    const metrics = await resolveInterleavingMetrics(this.context, settings);
    const groups = new Map<string, FactTableGroup>();
    for (const resolved of metrics) {
      const { factTable } = resolved;
      const group = groups.get(factTable.id) ?? { factTable, metrics: [] };
      groups.set(factTable.id, group);
      group.metrics.push(resolved);
    }
    return groups;
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

    const queries: Queries = [];
    for (const [factTableId, group] of await this.groupByFactTable(settings)) {
      const sql = integration.getInterleavingMetricQuery({
        exposureQuery: settings.exposureQuery,
        userIdType: settings.userIdType,
        trackingKey: settings.trackingKey,
        variationKeys: [settings.variations[0].key, settings.variations[1].key],
        startDate: settings.startDate,
        endDate: settings.endDate,
        factTable: group.factTable,
        metrics: group.metrics.map(({ config, metric }) => ({
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
    const results: InterleavingMetricResult[] = [];
    const groups = await this.groupByFactTable(this.model.frozenSettings);

    for (const [factTableId, { metrics }] of groups) {
      // A single-row aggregate; QueryMap is untyped at this boundary
      const rows = queryMap.get(factTableId)?.result as
        | InterleavingMetricQueryResponseRows
        | undefined;
      const row = rows?.[0];
      if (!row) {
        throw new Error(
          `Interleaving query for fact table ${factTableId} returned no rows`,
        );
      }

      const read = (name: string) => {
        const value = row[name];
        if (value === undefined) {
          throw new Error(
            `Interleaving query for fact table ${factTableId} is missing column ${name}`,
          );
        }
        return value;
      };
      const usersExposed = read("users_exposed");

      metrics.forEach(({ config }, i) => {
        const metricId = config.id;
        const col = (name: string) => read(`m${i}_${name}`);
        for (const analysis of config.analyses) {
          switch (analysis.type) {
            case "paired": {
              const stats = {
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
              const perExposure = (v: number) =>
                stats.sum_n > 0 ? v / stats.sum_n : 0;
              results.push({
                metricId,
                analysis,
                users: stats.users,
                control: { value: stats.sum_y, cr: perExposure(stats.sum_y) },
                treatment: { value: stats.sum_x, cr: perExposure(stats.sum_x) },
                test: pairedDeltaTest(stats),
              });
              break;
            }
            case "ownership": {
              const prefT = col("users_pref_treatment");
              const prefC = col("users_pref_control");
              const perUser = (v: number) =>
                usersExposed > 0 ? v / usersExposed : 0;
              results.push({
                metricId,
                analysis,
                users: usersExposed,
                control: { value: prefC, cr: perUser(prefC) },
                treatment: { value: prefT, cr: perUser(prefT) },
                test: ownershipSignTest({
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
      });
    }

    return { results };
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
