import {
  BANDIT_SRM_DIMENSION_NAME,
  EXPOSURE_DATE_DIMENSION_NAME,
} from "shared/constants";
import type { ExperimentAggregateUnitsQueryResponseRows } from "shared/types/integrations";
import type { SnapshotSettingsVariation } from "shared/types/experiment-snapshot";
import { analyzeExperimentTraffic } from "back-end/src/services/stats";
import { chi2pvalue } from "back-end/src/util/stats";

const variations: SnapshotSettingsVariation[] = [
  { id: "var_a", weight: 0.5 },
  { id: "var_b", weight: 0.5 },
];

function dateRow(
  variation: string,
  units: number,
): ExperimentAggregateUnitsQueryResponseRows[number] {
  return {
    dimension_name: EXPOSURE_DATE_DIMENSION_NAME,
    dimension_value: "2026-05-14",
    variation,
    units,
  };
}

describe("analyzeExperimentTraffic variation index resolution", () => {
  it("counts rows whose variation exactly matches a variation id", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      dateRow("var_a", 60),
      dateRow("var_b", 40),
    ];

    const traffic = analyzeExperimentTraffic({ rows, variations });

    expect(traffic.overall.variationUnits).toEqual([60, 40]);
    expect(traffic.dimension[EXPOSURE_DATE_DIMENSION_NAME]).toHaveLength(1);
    expect(
      traffic.dimension[EXPOSURE_DATE_DIMENSION_NAME][0].variationUnits,
    ).toEqual([60, 40]);
  });

  it("skips unexpected warehouse values instead of bucketing them (avoids false inflation/SRM)", () => {
    // A stray numeric value must NOT be coerced to a variation index; it is an
    // unknown assignment and is dropped so health totals match results.
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      dateRow("var_a", 50),
      dateRow("var_b", 50),
      dateRow("1", 999),
    ];

    const traffic = analyzeExperimentTraffic({ rows, variations });

    expect(traffic.overall.variationUnits).toEqual([50, 50]);
  });

  it("skips __multiple__ and the empty-variation bandit SRM row", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      dateRow("var_a", 60),
      dateRow("var_b", 40),
      dateRow("__multiple__", 3),
      {
        dimension_name: BANDIT_SRM_DIMENSION_NAME,
        dimension_value: "",
        variation: "",
        units: 1.234,
      },
    ];

    const traffic = analyzeExperimentTraffic({ rows, variations });

    // Neither "__multiple__" nor the empty-variation SRM row should be counted
    // against a variation.
    expect(traffic.overall.variationUnits).toEqual([60, 40]);
    // The __multiple__ exposure-date row feeds the multipleExposures counter.
    expect(traffic.multipleExposures).toBe(3);
    // SRM p-value comes from the bandit SRM summary row, not a recomputation.
    expect(traffic.overall.srm).toBeCloseTo(chi2pvalue(1.234, 1));
  });
});
