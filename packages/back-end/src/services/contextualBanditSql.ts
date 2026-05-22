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
