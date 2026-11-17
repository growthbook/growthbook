import { FunnelFactMetricInterface } from "shared/types/fact-table";
import {
  excludeFunnelSliceRows,
  ExperimentTableRow,
} from "@/services/experiments";

const funnelMetric = {
  id: "fact__funnel",
  name: "Signup Funnel",
  metricType: "funnel",
  numerator: null,
  denominator: null,
  funnelSettings: { steps: [] },
} as unknown as FunnelFactMetricInterface;

const proportionMetric = {
  id: "fact__signups",
  name: "Signups",
  metricType: "proportion",
  numerator: { factTableId: "ft", column: "$$distinctUsers" },
  denominator: null,
  funnelSettings: null,
} as unknown as FunnelFactMetricInterface;

function makeRow(
  metric: FunnelFactMetricInterface,
  overrides: Partial<ExperimentTableRow>,
): ExperimentTableRow {
  return {
    label: "row",
    metric,
    metricOverrideFields: [],
    variations: [],
    resultGroup: "goal",
    ...overrides,
  } as unknown as ExperimentTableRow;
}

describe("excludeFunnelSliceRows", () => {
  const funnelParent = makeRow(funnelMetric, {});
  const funnelStep = makeRow(funnelMetric, {
    isChildRow: true,
    childRowType: "funnelStep",
    funnelStepIndex: 0,
  });
  const funnelSlice = makeRow(funnelMetric, {
    isSliceRow: true,
    isChildRow: true,
    childRowType: "slice",
    sliceId: "fact__funnel?dim:browser=Chrome",
  });
  const metricSlice = makeRow(proportionMetric, {
    isSliceRow: true,
    isChildRow: true,
    childRowType: "slice",
    sliceId: "fact__signups?dim:browser=Chrome",
  });

  it("drops a funnel's slice rows", () => {
    expect(excludeFunnelSliceRows([funnelParent, funnelSlice])).toEqual([
      funnelParent,
    ]);
  });

  it("keeps funnel step rows and the funnel itself", () => {
    expect(
      excludeFunnelSliceRows([funnelParent, funnelStep, funnelSlice]),
    ).toEqual([funnelParent, funnelStep]);
  });

  it("keeps slice rows belonging to non-funnel metrics", () => {
    expect(excludeFunnelSliceRows([metricSlice])).toEqual([metricSlice]);
  });

  it("preserves order", () => {
    expect(
      excludeFunnelSliceRows([
        metricSlice,
        funnelSlice,
        funnelParent,
        funnelStep,
      ]),
    ).toEqual([metricSlice, funnelParent, funnelStep]);
  });
});
