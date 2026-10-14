import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  InterleavingAnalysis,
  InterleavingMetricResult,
  interleavingSignalMetricIds,
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import type {
  InterleavingMetricQueryMetric,
  InterleavingMetricQueryParams,
  InterleavingMetricQueryResponseRows,
} from "shared/types/integrations";
import type { FactTableInterface } from "shared/types/fact-table";
import { ownershipSignTest, pairedDeltaTest } from "stats-ts";
import { QueryMap, QueryRunner } from "back-end/src/queryRunners/QueryRunner";
import { resolveInterleavingMetrics } from "back-end/src/enterprise/services/interleavingMetrics";

export type InterleavingResultsQueryParams = {
  snapshotSettings: InterleavingSnapshotSettings;
};

export type InterleavingQueryRunResult = {
  results: InterleavingMetricResult[];
};

// One (metric, analysis) pair; index i in a group maps to the m{i}_ columns
type AnalysisEntry = { metricId: string; analysis: InterleavingAnalysis };

// One query per fact table, keyed by the fact table id (also the query name)
type FactTableGroup = {
  factTable: FactTableInterface;
  entries: AnalysisEntry[];
  queryMetrics: InterleavingMetricQueryMetric[];
  signals: InterleavingMetricQueryParams["signals"];
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
    const { metrics, signals } = await resolveInterleavingMetrics(
      this.context,
      settings,
    );
    const groups = new Map<string, FactTableGroup>();
    for (const { config, metric, factTable } of metrics) {
      const group = groups.get(factTable.id) ?? {
        factTable,
        entries: [],
        queryMetrics: [],
        signals: [],
      };
      groups.set(factTable.id, group);
      for (const analysis of config.analyses) {
        group.entries.push({ metricId: config.id, analysis });
        group.queryMetrics.push({ analysis, metric });
      }
    }
    for (const group of groups.values()) {
      const signalIds = new Set(
        interleavingSignalMetricIds(group.entries.map((e) => e.analysis)),
      );
      group.signals = signals.filter((s) => signalIds.has(s.metric.id));
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
        exposureQuery: settings.query,
        userIdType: settings.userIdType,
        trackingKey: settings.trackingKey,
        variationKeys: [settings.variations[0].key, settings.variations[1].key],
        startDate: settings.startDate,
        endDate: settings.endDate,
        factTable: group.factTable,
        metrics: group.queryMetrics,
        signals: group.signals,
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

    for (const [factTableId, { entries }] of groups) {
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

      entries.forEach(({ metricId, analysis }, i) => {
        const col = (name: string) => {
          const value = row[`m${i}_${name}`];
          if (value === undefined) {
            throw new Error(
              `Interleaving query for fact table ${factTableId} is missing column m${i}_${name}`,
            );
          }
          return value;
        };
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
            return;
          }
          case "ownership": {
            const prefT = col("users_pref_treatment");
            const prefC = col("users_pref_control");
            const users = row.users_exposed;
            const perUser = (v: number) => (users > 0 ? v / users : 0);
            results.push({
              metricId,
              analysis,
              users,
              control: { value: prefC, cr: perUser(prefC) },
              treatment: { value: prefT, cr: perUser(prefT) },
              test: ownershipSignTest({
                users_pref_treatment: prefT,
                users_pref_control: prefC,
                users_tied: Math.max(0, users - prefT - prefC),
              }),
            });
            return;
          }
          default: {
            const unknown: never = analysis;
            throw new Error(`Unknown analysis: ${JSON.stringify(unknown)}`);
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
