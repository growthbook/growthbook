export function getMetricAnalysisStatisticClauses(
  finalValueColumn: string,
  finalDenominatorColumn: string,
  ratioMetric: boolean,
): string {
  return `, COUNT(*) as units
            , SUM(${finalValueColumn}) as main_sum
            , SUM(POWER(${finalValueColumn}, 2)) as main_sum_squares
            ${
              ratioMetric
                ? `
            , SUM(${finalDenominatorColumn}) as denominator_sum
            , SUM(POWER(${finalDenominatorColumn}, 2)) as denominator_sum_squares
            , SUM(${finalDenominatorColumn} * ${finalValueColumn}) as main_denominator_sum_product
            `
                : ""
            }`;
}
