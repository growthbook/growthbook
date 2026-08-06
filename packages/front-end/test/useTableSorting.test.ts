import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { MetricDefaults } from "shared/types/organization";
import {
  ExperimentMetricDefinition,
  FUNNEL_DEMO_METRIC_ID,
  getFunnelEphemeralMetricById,
} from "shared/experiments";
import { sortExperimentTableRows } from "@/hooks/useTableSorting";
import { ExperimentTableRow } from "@/services/experiments";

const metricDefaults: MetricDefaults = { minimumSampleSize: 0 };

const funnelMetric = getFunnelEphemeralMetricById(FUNNEL_DEMO_METRIC_ID);
if (!funnelMetric) throw new Error("funnel metric fixture missing");
const realMetric = { ...funnelMetric, id: "fact__real_metric" };

// A baseline plus one treatment variation; `expected` drives the change sort.
function variations(expected: number): SnapshotMetric[] {
  const baseline = { users: 1000, value: 500, cr: 0.5 } as SnapshotMetric;
  const treatment = {
    users: 1000,
    value: 500,
    cr: 0.5,
    expected,
  } as SnapshotMetric;
  return [baseline, treatment];
}

function parentRow(metric: ExperimentMetricDefinition): ExperimentTableRow {
  return {
    label: metric.name,
    metric,
    metricOverrideFields: [],
    variations: variations(0),
    resultGroup: "goal",
  };
}

function childRow(
  parentId: string,
  childRowType: "slice" | "funnelStep",
  expected: number,
  extra: Partial<ExperimentTableRow>,
): ExperimentTableRow {
  return {
    label: "child",
    metric: realMetric,
    metricOverrideFields: [],
    variations: variations(expected),
    resultGroup: "goal",
    parentRowId: parentId,
    isChildRow: true,
    childRowType,
    ...extra,
  };
}

describe("sortExperimentTableRows", () => {
  // Insertion order deliberately does NOT match the `expected` sort order.
  const funnelChildren = [
    childRow(FUNNEL_DEMO_METRIC_ID, "funnelStep", 10, { funnelStepIndex: 0 }),
    childRow(FUNNEL_DEMO_METRIC_ID, "funnelStep", 30, { funnelStepIndex: 1 }),
    childRow(FUNNEL_DEMO_METRIC_ID, "funnelStep", 20, { funnelStepIndex: 2 }),
  ];
  const sliceChildren = [
    childRow("fact__real_metric", "slice", 10, {}),
    childRow("fact__real_metric", "slice", 30, {}),
    childRow("fact__real_metric", "slice", 20, {}),
  ];
  const rows: ExperimentTableRow[] = [
    parentRow(funnelMetric),
    ...funnelChildren,
    parentRow(realMetric),
    ...sliceChildren,
  ];

  const sorted = sortExperimentTableRows({
    rows,
    sortBy: "change",
    sortDirection: "desc",
    metricDefaults,
  });

  it("keeps funnel step children in funnel order regardless of the sort", () => {
    const funnelSteps = sorted.filter(
      (r) => r.parentRowId === FUNNEL_DEMO_METRIC_ID,
    );
    expect(funnelSteps.map((r) => r.funnelStepIndex)).toEqual([0, 1, 2]);
  });

  it("sorts slice children by the compare metric within their group", () => {
    const slices = sorted.filter((r) => r.parentRowId === "fact__real_metric");
    const expectedSequence = slices.map((r) => r.variations[1]?.expected);
    // Reordered away from the [10, 30, 20] insertion order into a sorted run.
    expect(expectedSequence).not.toEqual([10, 30, 20]);
    const ascending = [...expectedSequence].sort((a, b) => (a ?? 0) - (b ?? 0));
    const descending = [...ascending].reverse();
    expect(
      expectedSequence.every((v, i) => v === ascending[i]) ||
        expectedSequence.every((v, i) => v === descending[i]),
    ).toBe(true);
  });

  it("returns rows unchanged when no sort is active", () => {
    const unsorted = sortExperimentTableRows({
      rows,
      sortBy: "change",
      sortDirection: null,
      metricDefaults,
    });
    expect(unsorted).toBe(rows);
  });
});
