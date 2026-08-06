import {
  FUNNEL_DEMO_METRIC_ID,
  HARDCODED_FUNNEL_METRIC,
  funnelStepMetricId,
  getFunnelEphemeralMetricById,
} from "shared/experiments";
import { ExperimentReportResultDimension } from "shared/types/report";
import { SnapshotVariation } from "shared/types/experiment-snapshot";
import { generateRowsForMetric } from "@/hooks/useExperimentTableRows";

const NUM_STEPS = HARDCODED_FUNNEL_METRIC.steps.length;

function buildVariation(variationIndex: number): SnapshotVariation {
  const metrics: SnapshotVariation["metrics"] = {
    [FUNNEL_DEMO_METRIC_ID]: {
      users: 10000 + variationIndex,
      value: 5000 + variationIndex,
      cr: 0.5,
    },
  };
  HARDCODED_FUNNEL_METRIC.steps.forEach((_, i) => {
    metrics[funnelStepMetricId(i)] = {
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
  metricId: FUNNEL_DEMO_METRIC_ID,
  resultGroup: "goal",
  results,
  metricOverrides: [],
  shouldShowMetricSlices: true,
  getExperimentMetricById: getFunnelEphemeralMetricById,
  getFactTableById: () => null,
  expandedMetrics: { [`${FUNNEL_DEMO_METRIC_ID}:goal`]: true },
});

describe("generateRowsForMetric funnel parent", () => {
  it("emits the parent row followed by one row per funnel step", () => {
    expect(rows).toHaveLength(1 + NUM_STEPS);
    const [parent, ...steps] = rows;
    expect(parent.metric.id).toBe(FUNNEL_DEMO_METRIC_ID);
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
      expect(row.parentRowId).toBe(FUNNEL_DEMO_METRIC_ID);
      expect(row.label).toBe(HARDCODED_FUNNEL_METRIC.steps[i].name);
      results.variations.forEach((v, j) => {
        expect(row.variations[j]).toEqual(v.metrics[funnelStepMetricId(i)]);
      });
    });
  });
});
