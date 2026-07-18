import type { MetricQuantileSettings } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

import { getQuantileBoundValues } from "back-end/src/integrations/sql/columns/quantile-bound-values";
import { getQuantileGridArrayColumn } from "back-end/src/integrations/sql/columns/quantile-grid-array-column";

export function getQuantileSketchGridColumns(
  dialect: SqlDialect,
  metricQuantileSettings: MetricQuantileSettings,
  sketchCol: string,
  prefix: string,
): string {
  const asArray = dialect.hasArrayQuantileGrid();
  const centralCol = `, ${dialect.quantileSketchExtractPoint(sketchCol, metricQuantileSettings.quantile)} AS ${prefix}quantile`;

  if (asArray) {
    return `${centralCol}
    ${getQuantileGridArrayColumn(
      dialect,
      metricQuantileSettings.quantile,
      prefix,
      (bound) => dialect.quantileSketchExtractPoint(sketchCol, bound),
    )}`;
  }

  return `${centralCol}
    ${N_STAR_VALUES.map((nstar) => {
      const { lower, upper } = getQuantileBoundValues(
        metricQuantileSettings.quantile,
        0.05,
        nstar,
      );
      return `, ${dialect.quantileSketchExtractPoint(sketchCol, lower)} AS ${prefix}quantile_lower_${nstar}
          , ${dialect.quantileSketchExtractPoint(sketchCol, upper)} AS ${prefix}quantile_upper_${nstar}`;
    }).join("\n")}`;
}
