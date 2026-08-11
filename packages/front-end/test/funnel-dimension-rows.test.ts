import { funnelStepMetricId } from "shared/experiments";
import { FunnelFactMetricInterface } from "shared/types/fact-table";
import { ExperimentReportResultDimension } from "shared/types/report";
import { SnapshotVariation } from "shared/types/experiment-snapshot";
import { generateDimensionRowsForMetric } from "@/hooks/useExperimentDimensionRows";

const FUNNEL_METRIC_ID = "fact__funnel";
const STEP_NAMES = ["Viewed landing page", "Signed up", "Completed onboarding"];
const DIMENSION_VALUES = ["US", "UK"];

const funnelMetric = {
  id: FUNNEL_METRIC_ID,
  name: "Signup Funnel",
  metricType: "funnel",
  numerator: null,
  denominator: null,
  funnelSettings: {
    steps: STEP_NAMES.map((name) => ({
      name,
      factTableId: "ft",
      rowFilters: [],
      optional: false,
    })),
  },
} as unknown as FunnelFactMetricInterface;

const NUM_STEPS = STEP_NAMES.length;

function buildVariation(seed: number): SnapshotVariation {
  const metrics: SnapshotVariation["metrics"] = {
    [FUNNEL_METRIC_ID]: { users: 10000 + seed, value: 5000 + seed, cr: 0.5 },
  };
  STEP_NAMES.forEach((_, i) => {
    metrics[funnelStepMetricId(FUNNEL_METRIC_ID, i)] = {
      users: 1000 * (i + 1) + seed,
      value: 100 * (i + 1) + seed,
      cr: (i + 1) / 10,
    };
  });
  return { users: 10000 + seed, metrics };
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

const rows = generateDimensionRowsForMetric({
  metricId: FUNNEL_METRIC_ID,
  resultGroup: "goal",
  results,
  overrideFields: [],
  metricSnapshotSettings: undefined,
  newMetric: funnelMetric,
});

describe("generateDimensionRowsForMetric funnel", () => {
  it("emits a parent row plus per-step child rows for each dimension value", () => {
    expect(rows).toHaveLength(DIMENSION_VALUES.length * (1 + NUM_STEPS));

    DIMENSION_VALUES.forEach((value, dimIndex) => {
      const start = dimIndex * (1 + NUM_STEPS);
      const parent = rows[start];
      const steps = rows.slice(start + 1, start + 1 + NUM_STEPS);

      expect(parent.label).toBe(value);
      expect(parent.isChildRow).toBeFalsy();
      expect(parent.numChildren).toBe(NUM_STEPS);
      results[dimIndex].variations.forEach((v, j) => {
        expect(parent.variations[j]).toEqual(v.metrics[FUNNEL_METRIC_ID]);
      });

      expect(steps).toHaveLength(NUM_STEPS);
      steps.forEach((row, i) => {
        expect(row.isChildRow).toBe(true);
        expect(row.childRowType).toBe("funnelStep");
        expect(row.funnelStepIndex).toBe(i);
        expect(row.label).toBe(STEP_NAMES[i]);
        expect(row.parentRowId).toBe(`${FUNNEL_METRIC_ID}:${value}`);
        results[dimIndex].variations.forEach((v, j) => {
          expect(row.variations[j]).toEqual(
            v.metrics[funnelStepMetricId(FUNNEL_METRIC_ID, i)],
          );
        });
      });
    });
  });
});

describe("generateDimensionRowsForMetric non-funnel", () => {
  it("emits a single flat row per dimension value", () => {
    const metric = {
      ...funnelMetric,
      metricType: "proportion",
    } as unknown as FunnelFactMetricInterface;
    const flatRows = generateDimensionRowsForMetric({
      metricId: FUNNEL_METRIC_ID,
      resultGroup: "goal",
      results,
      overrideFields: [],
      metricSnapshotSettings: undefined,
      newMetric: metric,
    });
    expect(flatRows).toHaveLength(DIMENSION_VALUES.length);
    flatRows.forEach((row) => {
      expect(row.isChildRow).toBeFalsy();
      expect(row.childRowType).toBeUndefined();
    });
  });
});
