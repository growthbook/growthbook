import type { SqlDialect } from "shared/types/sql";
import { getDropMetricSourceTableQuery } from "back-end/src/integrations/sql/queries/drop-metric-source-table-query";

const dialect = { formatDialect: "bigquery" } as SqlDialect;

describe("getDropMetricSourceTableQuery", () => {
  it.each([
    "`proj`.`ds`.`gb_metrics_exp_1_ft_a_x1`",
    "`proj`.`ds`.`gb_metrics_exp_1_ft_a_x1_covariate`",
  ])("drops the incremental metrics table %s", (table) => {
    expect(
      getDropMetricSourceTableQuery(dialect, {
        metricSourceTableFullName: table,
      }).trim(),
    ).toBe(`DROP TABLE IF EXISTS ${table}`);
  });

  it.each(["`proj`.`ds`.`events`", "`proj`.`ds`.`gb_units_exp_1_x1`"])(
    "refuses to drop %s",
    (table) => {
      expect(() =>
        getDropMetricSourceTableQuery(dialect, {
          metricSourceTableFullName: table,
        }),
      ).toThrow("not an incremental refresh metrics table");
    },
  );
});
