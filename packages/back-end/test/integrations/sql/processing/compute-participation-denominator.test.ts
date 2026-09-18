import type { FactMetricInterface } from "shared/types/fact-table";

import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { computeParticipationDenominator } from "back-end/src/integrations/sql/processing/compute-participation-denominator";

describe("computeParticipationDenominator", () => {
  it("uses matching timestamp types for a Redshift conversion window", () => {
    const metric = {
      metricType: "dailyParticipation",
      windowSettings: {
        type: "conversion",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 168,
        windowUnit: "hours",
      },
    } as FactMetricInterface;

    const sql = computeParticipationDenominator(redshiftDialect, {
      initialTimestampColumn: "MIN(umj.timestamp)",
      analysisEndDate: new Date("2026-09-15T00:00:00Z"),
      metric,
      overrideConversionWindows: false,
    });

    expect(sql).toContain(
      "datediff(day, CAST(MIN(umj.timestamp) AS TIMESTAMP), LEAST(CAST(CURRENT_TIMESTAMP AS TIMESTAMP)",
    );
    expect(sql).not.toContain("LEAST(CURRENT_TIMESTAMP,");
  });
});
