import type { MetricQuantileSettings } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

import { getQuantileBoundValues } from "back-end/src/integrations/sql/columns/quantile-bound-values";

export function getKllQuantileGridColumns(
  dialect: SqlDialect,
  metricQuantileSettings: MetricQuantileSettings,
  sketchCol: string,
  prefix: string,
): string {
  return `, ${dialect.kllExtractPoint(sketchCol, metricQuantileSettings.quantile)} AS ${prefix}quantile
    ${N_STAR_VALUES.map((nstar) => {
      const { lower, upper } = getQuantileBoundValues(
        metricQuantileSettings.quantile,
        0.05,
        nstar,
      );
      return `, ${dialect.kllExtractPoint(sketchCol, lower)} AS ${prefix}quantile_lower_${nstar}
          , ${dialect.kllExtractPoint(sketchCol, upper)} AS ${prefix}quantile_upper_${nstar}`;
    }).join("\n")}`;
}
