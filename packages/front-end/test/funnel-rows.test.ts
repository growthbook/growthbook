import { funnelStepMetricId } from "shared/experiments";
import {
  FactTableDefinition,
  FunnelFactMetricInterface,
} from "shared/types/fact-table";
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
    results.variations.forEach((v, j) => {
      expect(parent.variations[j]).toEqual(v.metrics[FUNNEL_METRIC_ID]);
    });
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

describe("generateRowsForMetric funnel under a slice-tag filter", () => {
  // A funnel's slices are per-step and shown in the drilldown, so this table has
  // no slices for a filter to match — the funnel drops out the way any metric
  // without slices does.
  const factTable = {
    id: "ft",
    columns: [
      {
        column: "browser",
        datatype: "string",
        deleted: false,
        isAutoSliceColumn: true,
        autoSlices: ["Chrome", "Safari"],
      },
    ],
    userIdTypes: [],
    userIdColumns: {},
  } as unknown as FactTableDefinition;

  const slicedFunnel = {
    ...funnelMetric,
    metricAutoSlices: ["browser"],
  } as unknown as FunnelFactMetricInterface;

  const slicedProportion = {
    ...slicedFunnel,
    id: "fact__proportion",
    metricType: "proportion",
    numerator: { factTableId: "ft", column: "$$distinctUsers" },
    funnelSettings: null,
  } as unknown as FunnelFactMetricInterface;

  const generate = (
    metric: FunnelFactMetricInterface,
    sliceTagsFilter?: string[],
  ) =>
    generateRowsForMetric({
      metricId: metric.id,
      resultGroup: "goal",
      results,
      metricOverrides: [],
      shouldShowMetricSlices: true,
      getExperimentMetricById: (id) => (id === metric.id ? metric : null),
      getFactTableById: () => factTable,
      expandedMetrics: { [`${metric.id}:goal`]: true },
      sliceTagsFilter,
    });

  it("drops the funnel entirely while a slice filter is active", () => {
    expect(generate(slicedFunnel, ["dim:browser=Chrome"])).toHaveLength(0);
  });

  it("still returns a non-funnel metric under the same filter", () => {
    // Guards against the filter simply dropping everything.
    expect(
      generate(slicedProportion, ["dim:browser=Chrome"]).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the funnel and its steps when the filter includes overall", () => {
    const filtered = generate(slicedFunnel, ["overall"]);
    const [parent] = filtered;

    expect(parent.metric.id).toBe(FUNNEL_METRIC_ID);
    expect(parent.labelOnly).toBeFalsy();
    expect(
      filtered.filter((r) => r.childRowType === "funnelStep"),
    ).toHaveLength(NUM_STEPS);
  });

  it("never marks a funnel parent label-only, unlike a sliced metric", () => {
    expect(
      generate(slicedProportion, ["dim:browser=Chrome"])[0].labelOnly,
    ).toBe(true);
  });
});
