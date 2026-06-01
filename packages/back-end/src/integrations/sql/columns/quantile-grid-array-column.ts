import type { SqlDialect } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";
import { getQuantileBoundValues } from "back-end/src/integrations/sql/columns/quantile-bound-values";

// Packs the n_star confidence-interval grid into one array column instead of
// N_STAR_VALUES.length * 2 scalar columns.
export function getQuantileGridArrayColumn(
  dialect: SqlDialect,
  quantile: number,
  prefix: string,
  boundExpr: (bound: number) => string,
): string {
  const elements = N_STAR_VALUES.flatMap((nstar) => {
    const { lower, upper } = getQuantileBoundValues(quantile, 0.05, nstar);
    return [boundExpr(lower), boundExpr(upper)];
  });
  return `, ${dialect.quantileGridArrayLiteral(
    elements,
  )} AS ${prefix}quantile_grid`;
}
