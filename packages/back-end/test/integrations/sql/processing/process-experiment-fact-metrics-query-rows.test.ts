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
  it("parses metric, funnel step, quantile, dimension and bandit columns", async () => {
    const [result] = await processExperimentFactMetricsQueryRows([row]);

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

  it("keeps compound component unit counts", async () => {
    const [result] = await processExperimentFactMetricsQueryRows([
      {
        variation: "0",
        users: "10",
        m0_id: "fact__compound",
        m0_main_sum: "2",
        m0_c0_units: "6",
        m0_c1_units: "3",
      },
    ]);
    expect(result).toMatchObject({ m0_c0_units: 6, m0_c1_units: 3 });
  });

  it("returns only shared columns for a row without metrics", async () => {
    expect(
      await processExperimentFactMetricsQueryRows([
        { variation: "0", users: "3" },
      ]),
    ).toEqual([{ variation: "0", users: 3, count: 3 }]);
  });

  it("yields to the event loop while processing many rows", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      ...row,
      variation: String(i),
    }));
    const result = await processExperimentFactMetricsQueryRows(rows);
    clearInterval(timer);

    expect(result.map((r) => r.variation)).toEqual(
      rows.map((r) => r.variation),
    );
    expect(ticks).toBeGreaterThan(0);
  });
});
