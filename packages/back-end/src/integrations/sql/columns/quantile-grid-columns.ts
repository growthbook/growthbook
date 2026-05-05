import type { MetricQuantileSettings } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

import { getQuantileBoundValues } from "back-end/src/integrations/sql/columns/quantile-bound-values";
import { quantileColumn } from "back-end/src/integrations/sql/columns/quantile-column";

export function getQuantileGridColumns(
  dialect: SqlDialect,
  metricQuantileSettings: MetricQuantileSettings,
  prefix: string,
): string {
  return `, ${quantileColumn(
    dialect,
    `m.${prefix}value`,
    `${prefix}quantile`,
    metricQuantileSettings.quantile,
  )}
    ${N_STAR_VALUES.map((nstar) => {
      const { lower, upper } = getQuantileBoundValues(
        metricQuantileSettings.quantile,
        0.05,
        nstar,
      );
      return `, ${quantileColumn(
        dialect,
        `m.${prefix}value`,
        `${prefix}quantile_lower_${nstar}`,
        lower,
      )}
          , ${quantileColumn(
            dialect,
            `m.${prefix}value`,
            `${prefix}quantile_upper_${nstar}`,
            upper,
          )}`;
    }).join("\n")}`;
}
