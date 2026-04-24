import type { MetricQuantileSettings } from "shared/types/fact-table";
import type { SqlHelpers } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

import { getQuantileBoundValues } from "./quantile-bound-values";
import { quantileColumn } from "./quantile-column";

export function getQuantileGridColumns(
  helpers: SqlHelpers,
  metricQuantileSettings: MetricQuantileSettings,
  prefix: string,
): string {
  return `, ${quantileColumn(
    helpers,
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
        helpers,
        `m.${prefix}value`,
        `${prefix}quantile_lower_${nstar}`,
        lower,
      )}
          , ${quantileColumn(
            helpers,
            `m.${prefix}value`,
            `${prefix}quantile_upper_${nstar}`,
            upper,
          )}`;
    }).join("\n")}`;
}
