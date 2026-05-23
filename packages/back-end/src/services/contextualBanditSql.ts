// See contextual-bandit-fix-prompt.md for the v1 scope and the v1.5 holdout TODOs.
//
// SMITH: this module is the SQL-side integration seam for the contextual
// bandit pipeline. `runContextualBanditQuery` is invoked by the
// `ContextualBanditResultsQueryRunner` and its signature MUST stay stable —
// the runner caches the (context, cb, datasource, exposureQuery) tuple and
// dispatches to this function. The current body is a stub that returns
// fabricated rows; Luke's A3 branch replaces it with real SQL generation +
// execution. The accompanying `mockRows` helper exists only to keep the
// orchestrator end-to-end runnable while A3 is in flight and should be
// deleted at integration time. The experiment.type check upstream now uses
// `experimentType === "contextual-bandit"` rather than the legacy
// `banditIsContextual` flag.
import { ContextualBanditInterface } from "shared/validators";
import { DataSourceInterface, ExposureQuery } from "shared/types/datasource";
import { ReqContext } from "back-end/types/api";

export type ContextualBanditRow = {
  variation: string;
  attributes: Record<string, unknown>;
  n: number;
  main_sum: number;
  main_sum_squares: number;
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
export async function runContextualBanditQuery(
  _context: ReqContext,
  cb: ContextualBanditInterface,
  _dataSource: DataSourceInterface,
  exposureQuery: ExposureQuery,
): Promise<ContextualBanditRow[]> {
  if (process.env.GROWTHBOOK_CB_MOCK_SQL !== "0") {
    return mockRows(cb, exposureQuery);
  }
  // Luke's branch swaps this body for real SQL gen + execution
  throw new Error("Real contextual bandit SQL not yet implemented");
}

// SMITH: delete this whole function once `runContextualBanditQuery` is wired
// to the real SQL pipeline. It exists purely so the orchestrator + query
// runner can be exercised end-to-end against a deterministic row set.
function mockRows(
  cb: ContextualBanditInterface,
  eaq: ExposureQuery,
): ContextualBanditRow[] {
  const attrs = eaq.targetingAttributeColumns ?? [];
  const numVariations = Math.max(
    2,
    cb.phases[cb.phases.length - 1]?.currentLeafWeights[0]?.weights.length ?? 2,
  );

  // Generate 3 synthetic attribute-value contexts + an "other" catch-all
  const contexts: Record<string, unknown>[] = [
    Object.fromEntries(attrs.map((a) => [a, `${a}_A`])),
    Object.fromEntries(attrs.map((a) => [a, `${a}_B`])),
    Object.fromEntries(attrs.map((a) => [a, `${a}_C`])),
    {}, // "other" catch-all
  ];

  const rows: ContextualBanditRow[] = [];
  contexts.forEach((ctx, ci) => {
    for (let v = 0; v < numVariations; v++) {
      const n = 200 + ci * 50 + v * 30;
      const mean = 0.05 + (v === 0 ? 0 : 0.01) + ci * 0.003;
      rows.push({
        variation: String(v),
        attributes: ctx,
        n,
        main_sum: mean * n,
        main_sum_squares: mean * mean * n + n * 0.1,
      });
    }
  });
  return rows;
}
