import { clickHouseDialect } from "shared/dialects";
import { getBanditStatisticsFactMetricCTE } from "back-end/src/integrations/sql/ctes/bandit-statistics-fact-metric-cte";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

describe("getBanditStatisticsFactMetricCTE", () => {
  it("aliases the final variation column so engines that keep the table prefix (ClickHouse) still return `variation`", () => {
    const factTable = factTableFactory.build({ id: "events" });
    const sql = getBanditStatisticsFactMetricCTE(clickHouseDialect, {
      baseIdType: "user_id",
      metricData: [
        {
          alias: "m0",
          id: "fact__m0",
          ratioMetric: false,
          regressionAdjusted: false,
          isUpperPercentileCapped: false,
          isLowerPercentileCapped: false,
          capCoalesceMetric: "",
          capCoalesceDenominator: "",
          capCoalesceCovariate: "",
          numeratorSourceIndex: 0,
          denominatorSourceIndex: 0,
        },
      ],
      dimensionCols: [],
      factTablesWithIndices: [{ factTable, index: 0 }],
      regressionAdjustedTableIndices: new Set<number>(),
      percentileTableIndices: new Set<number>(),
    });

    const finalSelect = sql.slice(
      sql.lastIndexOf("SELECT\n      bps.variation"),
    );
    expect(finalSelect).toMatch(/bps\.variation AS variation\b/);
  });
});
