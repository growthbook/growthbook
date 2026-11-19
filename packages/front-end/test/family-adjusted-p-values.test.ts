import { getFamilyAdjustedPValues } from "@/components/MetricDrilldown/helpers";
import { ExperimentTableRow } from "@/services/experiments";

function makeGoalRow(
  id: string,
  pValue: number,
  supplemental: Record<string, { pValue: number }>,
): ExperimentTableRow {
  return {
    label: id,
    metric: { id, name: id },
    resultGroup: "goal",
    variations: [
      { users: 100, value: 10, cr: 0.1 },
      {
        users: 100,
        value: 12,
        cr: 0.12,
        pValue,
        supplementalResults: supplemental,
      },
    ],
  } as unknown as ExperimentTableRow;
}

describe("getFamilyAdjustedPValues", () => {
  const goalRows = [
    makeGoalRow("a", 0.01, { uncapped: { pValue: 0.03 } }),
    makeGoalRow("b", 0.04, {
      uncapped: { pValue: 0.2 },
      cupedUnadjusted: { pValue: 0.5 },
    }),
  ];

  it("corrects the primary and each adjustment over the same family", () => {
    const family = getFamilyAdjustedPValues({
      goalRows,
      statsEngine: "frequentist",
      pValueCorrection: "holm-bonferroni",
    });

    expect(family?.primary?.get("a:1")).toBeCloseTo(0.02);
    expect(family?.primary?.get("b:1")).toBeCloseTo(0.04);
    expect(family?.supplemental.uncapped?.get("a:1")).toBeCloseTo(0.06);
    expect(family?.supplemental.uncapped?.get("b:1")).toBeCloseTo(0.2);
  });

  it("skips an adjustment that part of the family lacks", () => {
    const family = getFamilyAdjustedPValues({
      goalRows,
      statsEngine: "frequentist",
      pValueCorrection: "holm-bonferroni",
    });

    expect(family?.supplemental.cupedUnadjusted).toBeNull();
  });

  it("returns null without a frequentist correction", () => {
    expect(
      getFamilyAdjustedPValues({
        goalRows,
        statsEngine: "bayesian",
        pValueCorrection: "holm-bonferroni",
      }),
    ).toBeNull();
    expect(
      getFamilyAdjustedPValues({
        goalRows,
        statsEngine: "frequentist",
        pValueCorrection: null,
      }),
    ).toBeNull();
  });
});
