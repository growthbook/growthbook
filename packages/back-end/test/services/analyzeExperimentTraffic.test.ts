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
  it("maps numeric variation keys onto id-based variations (does not drop rows)", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      dateRow("0", 60),
      dateRow("1", 40),
    ];

    const traffic = analyzeExperimentTraffic({ rows, variations });

    expect(traffic.overall.variationUnits).toEqual([60, 40]);
    expect(traffic.dimension[EXPOSURE_DATE_DIMENSION_NAME]).toHaveLength(1);
    expect(
      traffic.dimension[EXPOSURE_DATE_DIMENSION_NAME][0].variationUnits,
    ).toEqual([60, 40]);
  });

  it("prefers an exact id match over the numeric fallback", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      dateRow("var_a", 5),
      dateRow("var_b", 7),
    ];

    const traffic = analyzeExperimentTraffic({ rows, variations });

    expect(traffic.overall.variationUnits).toEqual([5, 7]);
  });

  it("skips __multiple__ and the empty-variation bandit SRM row", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      dateRow("0", 60),
      dateRow("1", 40),
      dateRow("__multiple__", 3),
      {
        dimension_name: BANDIT_SRM_DIMENSION_NAME,
        dimension_value: "",
        variation: "",
        units: 1.234,
      },
    ];

    const traffic = analyzeExperimentTraffic({ rows, variations });

    // Neither "__multiple__" nor the empty-variation SRM row (Number("") === 0)
    // should be counted against variation 0.
    expect(traffic.overall.variationUnits).toEqual([60, 40]);
    // SRM p-value comes from the bandit SRM summary row, not a recomputation.
    expect(traffic.overall.srm).toBeCloseTo(chi2pvalue(1.234, 1));
  });

  it("drops rows whose numeric key is out of range", () => {
    const rows: ExperimentAggregateUnitsQueryResponseRows = [
      dateRow("0", 60),
      dateRow("5", 999),
    ];

    const traffic = analyzeExperimentTraffic({ rows, variations });

    expect(traffic.overall.variationUnits).toEqual([60, 0]);
  });
});
