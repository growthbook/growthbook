import type { MetricQuantileSettings } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";
import { getQuantileBoundValues } from "back-end/src/integrations/sql/columns/quantile-bound-values";
import { getQuantileGridArrayColumn } from "back-end/src/integrations/sql/columns/quantile-grid-array-column";
import { quantileColumn } from "back-end/src/integrations/sql/columns/quantile-column";

export function getQuantileGridColumns(
  dialect: SqlDialect,
  metricQuantileSettings: MetricQuantileSettings,
  prefix: string,
): string {
  const asArray = dialect.hasArrayQuantileGrid();
  const valueExpr = `m.${prefix}value`;
  const centralCol = `, ${quantileColumn(
    dialect,
    valueExpr,
    `${prefix}quantile`,
    metricQuantileSettings.quantile,
  )}`;

  if (asArray) {
    return `${centralCol}
    ${getQuantileGridArrayColumn(
      dialect,
      metricQuantileSettings.quantile,
      prefix,
      (bound) => dialect.percentileApprox(valueExpr, bound),
    )}`;
  }

  return `${centralCol}
    ${N_STAR_VALUES.map((nstar) => {
      const { lower, upper } = getQuantileBoundValues(
        metricQuantileSettings.quantile,
        0.05,
        nstar,
      );
      return `, ${quantileColumn(
        dialect,
        valueExpr,
        `${prefix}quantile_lower_${nstar}`,
        lower,
      )}
          , ${quantileColumn(
            dialect,
            valueExpr,
            `${prefix}quantile_upper_${nstar}`,
            upper,
          )}`;
    }).join("\n")}`;
}
