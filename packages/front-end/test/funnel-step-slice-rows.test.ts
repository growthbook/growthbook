import { funnelStepMetricId } from "shared/experiments";
import { ExperimentReportResultDimension } from "shared/types/report";
import { buildFunnelStepSliceRows } from "@/components/MetricDrilldown/helpers";
import { ExperimentTableRow } from "@/services/experiments";

const FUNNEL_METRIC_ID = "fact__funnel";
const SLICE_IDS = [
  `${FUNNEL_METRIC_ID}?dim:browser=Chrome`,
  `${FUNNEL_METRIC_ID}?dim:browser=Safari`,
];
const STEP_INDEX = 1;

function makeSliceRow(sliceId: string, label: string): ExperimentTableRow {
  return {
    label,
    metric: { id: FUNNEL_METRIC_ID, name: "Signup Funnel" },
    variations: [
      { users: 1, value: 1, cr: 1 },
      { users: 1, value: 1, cr: 1 },
    ],
    resultGroup: "goal",
    isSliceRow: true,
    isChildRow: true,
    childRowType: "slice",
    parentRowId: FUNNEL_METRIC_ID,
    sliceId,
  } as unknown as ExperimentTableRow;
}

const stepRow = {
  label: "Signed up",
  metric: { id: FUNNEL_METRIC_ID, name: "Signup Funnel" },
  variations: [],
  resultGroup: "goal",
  isChildRow: true,
  childRowType: "funnelStep",
  funnelStepIndex: STEP_INDEX,
  parentRowId: FUNNEL_METRIC_ID,
} as unknown as ExperimentTableRow;

const results = {
  name: "",
  srm: 1,
  variations: [0, 1].map((seed) => ({
    users: 1000 + seed,
    metrics: Object.fromEntries(
      SLICE_IDS.map((sliceId, i) => [
        funnelStepMetricId(sliceId, STEP_INDEX),
        { users: 100 * (i + 1) + seed, value: 10 * (i + 1) + seed, cr: 0.1 },
      ]),
    ),
  })),
} as unknown as ExperimentReportResultDimension;

const sliceRows = [
  makeSliceRow(SLICE_IDS[0], "Chrome"),
  makeSliceRow(SLICE_IDS[1], "Safari"),
];

describe("buildFunnelStepSliceRows", () => {
  it("leads the slices with the step row, detached from the funnel parent", () => {
    const rows = buildFunnelStepSliceRows({
      stepRow,
      sliceRows,
      stepIndex: STEP_INDEX,
      results,
    });

    expect(rows).toHaveLength(sliceRows.length + 1);
    expect(rows[0].label).toBe("Signed up");
    expect(rows[0].parentRowId).toBeUndefined();
    expect(rows[0].isChildRow).toBe(false);
    expect(rows[0].numChildren).toBe(sliceRows.length);
  });

  it("re-points each slice row at the selected step's results", () => {
    const rows = buildFunnelStepSliceRows({
      stepRow,
      sliceRows,
      stepIndex: STEP_INDEX,
      results,
    });

    rows.slice(1).forEach((row, i) => {
      const stepSliceId = funnelStepMetricId(SLICE_IDS[i], STEP_INDEX);
      expect(row.sliceId).toBe(stepSliceId);
      expect(row.childRowType).toBe("funnelSlice");
      expect(row.funnelStepIndex).toBe(STEP_INDEX);
      expect(row.parentRowId).toBe(FUNNEL_METRIC_ID);
      results.variations.forEach((v, j) => {
        expect(row.variations[j]).toEqual(v.metrics[stepSliceId]);
      });
    });
  });

  it("falls back to a no-data row when the step has no result for a slice", () => {
    const rows = buildFunnelStepSliceRows({
      stepRow,
      sliceRows,
      stepIndex: STEP_INDEX + 1,
      results,
    });

    rows.slice(1).forEach((row) => {
      row.variations.forEach((v) => {
        expect(v.value).toBe(0);
        expect(v.errorMessage).toBeTruthy();
      });
    });
  });

  it("returns only the slice rows when the step is missing from the snapshot", () => {
    const rows = buildFunnelStepSliceRows({
      stepRow: undefined,
      sliceRows,
      stepIndex: STEP_INDEX,
      results,
    });

    expect(rows).toHaveLength(sliceRows.length);
    expect(rows.every((r) => r.isSliceRow)).toBe(true);
  });
});
