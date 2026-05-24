// See contextual-bandit-fix-prompt.md for the v1 scope and the v1.5 holdout TODOs.
import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import { ContextualBanditInterface } from "shared/validators";
import { DataSourceInterface, ExposureQuery } from "shared/types/datasource";
import { ApiReqContext } from "back-end/types/api";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  buildContextualBanditMetricQuerySql,
  executeContextualBanditMetricQuery,
  loadContextualBanditSnapshotContext,
} from "back-end/src/services/contextualBanditQueries";

export type ContextualBanditSqlQueryResult = {
  rows: ExperimentMetricQueryResponseRows;
  sql: string;
};

// SMITH: replace this body with the real SQL generation + execution.
//   Input shape:  (context, cb, dataSource, exposureQuery)
//   Output shape: ContextualBanditRow[] — one row per (variation, attribute
//                 bucket) combination, with aggregate metric stats.
// Keep the function signature stable; `ContextualBanditResultsQueryRunner`
// awaits this exact tuple from inside its `startQueries.run` callback.
//
// TODO(holdout-v1.5): when the holdout pipeline ships, this query must split
// rows into a holdout bucket (train_id=0) and a bandit bucket (train_id=1)
// and emit BOTH buckets in the row set. The aggregation grain becomes
// (variation, context, train_id, bandit_period); downstream the stats engine
// computes the holdout-vs-bandit lift comparison. See
// contextual-bandit-fix-prompt.md.
// export async function runContextualBanditQuery(
//   _context: ApiReqContext,
//   cb: ContextualBanditInterface,
//   _dataSource: DataSourceInterface,
//   exposureQuery: ExposureQuery,
// ): Promise<ContextualBanditRow[]> {
//   if (process.env.GROWTHBOOK_CB_MOCK_SQL !== "0") {
//     return mockRows(cb, exposureQuery);
//   }
//   // Luke's branch swaps this body for real SQL gen + execution
//   throw new Error("Real contextual bandit SQL not yet implemented");
// }

// SMITH: delete this whole function once `runContextualBanditQuery` is wired
// to the real SQL pipeline. It exists purely so the orchestrator + query
// runner can be exercised end-to-end against a deterministic row set.
// function mockRows(
//   cb: ContextualBanditInterface,
//   eaq: ExposureQuery,
// ): ExperimentMetricQueryResponseRows {
//   const attrs = eaq.targetingAttributeColumns ?? [];
//   const numVariations = Math.max(
//     2,
//     cb.phases[cb.phases.length - 1]?.currentLeafWeights[0]?.weights.length ?? 2,
//   );

//   // Generate 3 synthetic attribute-value contexts + an "other" catch-all
//   const contexts: Record<string, unknown>[] = [
//     Object.fromEntries(attrs.map((a) => [a, `${a}_A`])),
//     Object.fromEntries(attrs.map((a) => [a, `${a}_B`])),
//     Object.fromEntries(attrs.map((a) => [a, `${a}_C`])),
//     {}, // "other" catch-all
//   ];

//   const rows: ContextualBanditRow[] = [];
//   contexts.forEach((ctx, ci) => {
//     for (let v = 0; v < numVariations; v++) {
//       const n = 200 + ci * 50 + v * 30;
//       const mean = 0.05 + (v === 0 ? 0 : 0.01) + ci * 0.003;
//       rows.push({
//         variation: String(v),
//         attributes: ctx,
//         n,
//         main_sum: mean * n,
//         main_sum_squares: mean * mean * n + n * 0.1,
//       });
//     }
//   });
//   return rows;
// }

export async function getContextualBanditQuerySql(
  context: ApiReqContext,
  cb: ContextualBanditInterface,
  dataSource: DataSourceInterface,
  exposureQuery: ExposureQuery,
): Promise<string> {
  const experiment = await getExperimentById(context, cb.experiment);
  if (!experiment) {
    throw new Error(`Experiment not found: ${cb.experiment}`);
  }

  const phase = Math.max(0, cb.phases.length - 1);
  const queryContext = await loadContextualBanditSnapshotContext(
    context,
    experiment,
    phase,
    cb,
    dataSource,
    exposureQuery,
  );

  return buildContextualBanditMetricQuerySql(
    context,
    dataSource,
    queryContext.snapshotSettings,
    queryContext.decisionMetric,
    queryContext.factTableMap,
    queryContext.metricMap,
  );
}

export async function executeContextualBanditQuery(
  context: ApiReqContext,
  cb: ContextualBanditInterface,
  dataSource: DataSourceInterface,
  exposureQuery: ExposureQuery,
  sql: string,
): Promise<ContextualBanditSqlQueryResult> {
  const experiment = await getExperimentById(context, cb.experiment);
  if (!experiment) {
    throw new Error(`Experiment not found: ${cb.experiment}`);
  }

  const phase = Math.max(0, cb.phases.length - 1);
  const queryContext = await loadContextualBanditSnapshotContext(
    context,
    experiment,
    phase,
    cb,
    dataSource,
    exposureQuery,
  );

  const { rows } = await executeContextualBanditMetricQuery(
    context,
    dataSource,
    sql,
    queryContext.snapshotSettings,
    queryContext.decisionMetric,
    queryContext.factTableMap,
    queryContext.metricMap,
  );

  return { rows, sql };
}

// TODO(holdout-v1.5): when the holdout pipeline ships, this query must split
// rows into a holdout bucket (train_id=0) and a bandit bucket (train_id=1)
// and emit BOTH buckets in the row set. The aggregation grain becomes
// (variation, context, train_id, bandit_period); downstream the stats engine
// computes the holdout-vs-bandit lift comparison. See
// contextual-bandit-fix-prompt.md.
export async function runContextualBanditQuery(
  context: ApiReqContext,
  cb: ContextualBanditInterface,
  dataSource: DataSourceInterface,
  exposureQuery: ExposureQuery,
): Promise<ContextualBanditSqlQueryResult> {
  const sql = await getContextualBanditQuerySql(
    context,
    cb,
    dataSource,
    exposureQuery,
  );
  return executeContextualBanditQuery(
    context,
    cb,
    dataSource,
    exposureQuery,
    sql,
  );
}
