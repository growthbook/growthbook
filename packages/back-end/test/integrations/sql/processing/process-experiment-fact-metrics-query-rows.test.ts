import { ATTR_CB_PREFIX } from "shared/constants";
import { processExperimentFactMetricsQueryRows } from "back-end/src/integrations/sql/processing/process-experiment-fact-metrics-query-rows";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

// Lower bound k and upper bound k + 0.5 at each N_STAR_VALUES index k.
const grid = N_STAR_VALUES.flatMap((_, k) => [k, k + 0.5]);

const row = {
  variation: "1",
  dimension: "chrome",
  dim_country: "US",
  [`${ATTR_CB_PREFIX}plan`]: "pro",
  users: "10",
  m0_id: "fact__ratio",
  m0_main_sum: "5",
  m0_main_sum_squares: "7",
  m0_denominator_sum: "bad",
  m0_step_0_sum: "3",
  m0_step_1_sum: "2",
  m1_id: "fact__quantile",
  m1_main_sum: "1",
  m1_quantile: "4.5",
  m1_quantile_n: "500",
  m1_quantile_grid: grid,
  m1_step_0_sum: "9",
  // Processing stops at the first missing id, so m3 is ignored.
  m3_id: "fact__ignored",
  m3_main_sum: "1",
};

describe("processExperimentFactMetricsQueryRows", () => {
  it("parses metric, funnel step, quantile, dimension and bandit columns", () => {
    const [result] = processExperimentFactMetricsQueryRows([row]);

    expect(result).toEqual({
      variation: "1",
      dimension: "chrome",
      dim_country: "US",
      [`${ATTR_CB_PREFIX}plan`]: "pro",
      users: 10,
      count: 10,
      m0_id: "fact__ratio",
      m0_main_sum: 5,
      m0_main_sum_squares: 7,
      m0_denominator_sum: 0,
      m0_step_0_sum: 3,
      m0_step_1_sum: 2,
      m1_id: "fact__quantile",
      m1_main_sum: 1,
      m1_step_0_sum: 9,
      m1_quantile: 4.5,
      m1_quantile_n: 500,
      m1_quantile_lower: 2,
      m1_quantile_upper: 2.5,
      m1_quantile_nstar: 400,
    });
    // Pin key order too, so refactors cannot silently reorder the output.
    expect(Object.keys(result)).toEqual([
      "variation",
      "dimension",
      "dim_country",
      `${ATTR_CB_PREFIX}plan`,
      "users",
      "count",
      "m0_id",
      "m0_main_sum",
      "m0_main_sum_squares",
      "m0_denominator_sum",
      "m0_step_0_sum",
      "m0_step_1_sum",
      "m1_id",
      "m1_main_sum",
      "m1_step_0_sum",
      "m1_quantile",
      "m1_quantile_n",
      "m1_quantile_lower",
      "m1_quantile_upper",
      "m1_quantile_nstar",
    ]);
  });

  it("returns only shared columns for a row without metrics", () => {
    expect(
      processExperimentFactMetricsQueryRows([{ variation: "0", users: "3" }]),
    ).toEqual([{ variation: "0", users: 3, count: 3 }]);
  });
});
