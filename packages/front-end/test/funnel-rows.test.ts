import { funnelStepMetricId } from "shared/experiments";
import { FunnelFactMetricInterface } from "shared/types/fact-table";
import { ExperimentReportResultDimension } from "shared/types/report";
import { SnapshotVariation } from "shared/types/experiment-snapshot";
import { generateRowsForMetric } from "@/hooks/useExperimentTableRows";

const FUNNEL_METRIC_ID = "fact__funnel";
const STEP_NAMES = ["Viewed landing page", "Signed up", "Completed onboarding"];

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

function buildVariation(variationIndex: number): SnapshotVariation {
  const metrics: SnapshotVariation["metrics"] = {
    [FUNNEL_METRIC_ID]: {
      users: 10000 + variationIndex,
      value: 5000 + variationIndex,
      cr: 0.5,
    },
  };
  STEP_NAMES.forEach((_, i) => {
    metrics[funnelStepMetricId(FUNNEL_METRIC_ID, i)] = {
      users: 1000 * (i + 1) + variationIndex,
      value: 100 * (i + 1) + variationIndex,
      cr: (i + 1) / 10,
    };
  });
  return { users: 10000 + variationIndex, metrics };
}

const results: ExperimentReportResultDimension = {
  name: "",
  srm: 1,
  variations: [buildVariation(0), buildVariation(1)],
};

const rows = generateRowsForMetric({
  metricId: FUNNEL_METRIC_ID,
  resultGroup: "goal",
  results,
  metricOverrides: [],
  shouldShowMetricSlices: true,
  getExperimentMetricById: (id) =>
    id === FUNNEL_METRIC_ID ? funnelMetric : null,
  getFactTableById: () => null,
  expandedMetrics: { [`${FUNNEL_METRIC_ID}:goal`]: true },
});

describe("generateRowsForMetric funnel parent", () => {
  it("emits the parent row followed by one row per funnel step", () => {
    expect(rows).toHaveLength(1 + NUM_STEPS);
    const [parent, ...steps] = rows;
    expect(parent.metric.id).toBe(FUNNEL_METRIC_ID);
    expect(parent.numChildren).toBe(NUM_STEPS);
    expect(parent.isChildRow).toBeFalsy();
    expect(steps).toHaveLength(NUM_STEPS);
  });

  it("sources each funnel step child row from its step metric data", () => {
    const steps = rows.slice(1);
    steps.forEach((row, i) => {
      expect(row.isChildRow).toBe(true);
      expect(row.childRowType).toBe("funnelStep");
      expect(row.funnelStepIndex).toBe(i);
      expect(row.parentRowId).toBe(FUNNEL_METRIC_ID);
      expect(row.label).toBe(STEP_NAMES[i]);
      results.variations.forEach((v, j) => {
        expect(row.variations[j]).toEqual(
          v.metrics[funnelStepMetricId(FUNNEL_METRIC_ID, i)],
        );
      });
    });
  });
});
