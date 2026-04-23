import { SqlHelpers } from "shared/types/sql";

export function quantileColumn(
  helpers: SqlHelpers,
  valueCol: string,
  outputCol: string,
  quantile: string | number,
): string {
  // note: no need to ignore zeros in the next two methods
  // since we remove them for quantile metrics in userMetricJoin
  return `${helpers.percentileApprox(valueCol, quantile)} AS ${outputCol}`;
}
