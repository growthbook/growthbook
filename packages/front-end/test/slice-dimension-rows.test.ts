import { SliceDataForMetric } from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import { ExperimentReportResultDimension } from "shared/types/report";
import { SnapshotVariation } from "shared/types/experiment-snapshot";
import { generateDimensionRowsForMetric } from "@/hooks/useExperimentDimensionRows";

const METRIC_ID = "fact__revenue";
const DIMENSION_VALUES = ["US", "UK"];

const metric = {
  id: METRIC_ID,
  name: "Revenue",
  metricType: "mean",
} as unknown as FactMetricInterface;

const sliceData: SliceDataForMetric[] = [
  {
    id: `${METRIC_ID}?dim:product=shoes`,
    name: "Revenue (product: shoes)",
    description: "",
    sliceLevels: [{ column: "product", datatype: "string", levels: ["shoes"] }],
    allSliceLevels: ["shoes", "hats"],
  },
  {
    id: `${METRIC_ID}?dim:product=hats`,
    name: "Revenue (product: hats)",
    description: "",
    sliceLevels: [{ column: "product", datatype: "string", levels: ["hats"] }],
    allSliceLevels: ["shoes", "hats"],
  },
  {
    // "other" slice with no data should be skipped
    id: `${METRIC_ID}?dim:product=`,
    name: "Revenue (product: other)",
    description: "",
    sliceLevels: [{ column: "product", datatype: "string", levels: [] }],
    allSliceLevels: ["shoes", "hats"],
  },
];

function buildVariation(seed: number): SnapshotVariation {
  return {
    users: 1000 + seed,
    metrics: {
      [METRIC_ID]: { users: 1000 + seed, value: 500 + seed, cr: 0.5 },
      [sliceData[0].id]: { users: 1000 + seed, value: 100 + seed, cr: 0.1 },
      [sliceData[1].id]: { users: 1000 + seed, value: 200 + seed, cr: 0.2 },
    },
  };
}

const results: ExperimentReportResultDimension[] = DIMENSION_VALUES.map(
  (name, dimIndex) => ({
    name,
    srm: 1,
    variations: [
      buildVariation(dimIndex * 10),
      buildVariation(dimIndex * 10 + 1),
    ],
  }),
);

describe("generateDimensionRowsForMetric slices", () => {
  it("emits slice child rows under each dimension value", () => {
    const rows = generateDimensionRowsForMetric({
      metricId: METRIC_ID,
      resultGroup: "goal",
      results,
      overrideFields: [],
      metricSnapshotSettings: undefined,
      newMetric: metric,
      sliceData,
    });

    // 1 parent + 2 slices (the empty "other" slice is skipped) per value
    expect(rows).toHaveLength(DIMENSION_VALUES.length * 3);

    DIMENSION_VALUES.forEach((value, dimIndex) => {
      const parent = rows[dimIndex * 3];
      const slices = rows.slice(dimIndex * 3 + 1, dimIndex * 3 + 3);

      expect(parent.label).toBe(value);
      expect(parent.isChildRow).toBeFalsy();
      expect(parent.numChildren).toBe(2);

      slices.forEach((row, i) => {
        expect(row.isSliceRow).toBe(true);
        expect(row.isChildRow).toBe(true);
        expect(row.childRowType).toBe("slice");
        expect(row.sliceId).toBe(sliceData[i].id);
        expect(row.parentRowId).toBe(`${METRIC_ID}:${value}`);
        expect(row.dimensionValue).toBe(value);
        expect(row.label).toBe(sliceData[i].sliceLevels[0].levels[0]);
        expect(row.metric.name).toBe(sliceData[i].name);
        results[dimIndex].variations.forEach((v, j) => {
          expect(row.variations[j]).toEqual(v.metrics[sliceData[i].id]);
        });
      });
    });
  });

  it("emits no child rows when the metric has no slices", () => {
    const rows = generateDimensionRowsForMetric({
      metricId: METRIC_ID,
      resultGroup: "goal",
      results,
      overrideFields: [],
      metricSnapshotSettings: undefined,
      newMetric: metric,
    });
    expect(rows).toHaveLength(DIMENSION_VALUES.length);
    rows.forEach((row) => {
      expect(row.isChildRow).toBeFalsy();
      expect(row.numChildren).toBeUndefined();
    });
  });
});
