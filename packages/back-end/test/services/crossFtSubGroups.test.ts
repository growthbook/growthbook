import { buildCrossFtSubGroups } from "back-end/src/services/experimentQueries/crossFtSubGroups";
import type {
  CrossFtPipelineRef,
  CrossFtMetricSourceGroupRef,
} from "back-end/src/services/experimentQueries/crossFtSubGroups";
import type { CrossFtRatioMetric } from "back-end/src/services/experimentQueries/planMetricFanOut";
import { getMetricConversionWindowHours } from "back-end/src/services/experimentQueries/partitionMetricsByConversionWindow";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

const pipelineA: CrossFtPipelineRef = {
  group: { groupId: "gA", factTableId: "ft_a" },
};
const pipelineB: CrossFtPipelineRef = {
  group: { groupId: "gB", factTableId: "ft_b" },
};

function makeCrossFt(id: string, windowValueDays: number): CrossFtRatioMetric {
  const metric = factMetricFactory.build({
    id,
    metricType: "ratio",
    numerator: { factTableId: "ft_a", column: "amount", aggregation: "sum" },
    denominator: { factTableId: "ft_b", column: "tenure", aggregation: "sum" },
    windowSettings: {
      type: "conversion",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: windowValueDays,
      windowUnit: "days",
    },
  });
  return {
    metric,
    numeratorFactTableId: "ft_a",
    denominatorFactTableId: "ft_b",
  };
}

const shortCross = makeCrossFt("m_short", 1);
const longCross = makeCrossFt("m_long", 4);
const anotherShortCross = makeCrossFt("m_short_2", 1);

const metricSourceGroups: CrossFtMetricSourceGroupRef[] = [
  {
    groupId: "gA",
    factTableId: "ft_a",
    metrics: [{ id: "m_short" }, { id: "m_long" }, { id: "m_short_2" }],
  },
  {
    groupId: "gB",
    factTableId: "ft_b",
    metrics: [{ id: "m_short" }, { id: "m_long" }, { id: "m_short_2" }],
  },
];

const pipelineByGroupId = new Map<string, CrossFtPipelineRef>([
  ["gA", pipelineA],
  ["gB", pipelineB],
]);

const mixedWindowPairs = [
  {
    factTableIds: ["ft_a", "ft_b"] as [string, string],
    metrics: [shortCross, longCross],
  },
];

function windowKeyFn(m: CrossFtRatioMetric): string | null {
  return String(getMetricConversionWindowHours(m.metric, null));
}

describe("buildCrossFtSubGroups window key", () => {
  it("collapses mixed-window metrics over the same two caches without getWindowKey", () => {
    const without = buildCrossFtSubGroups({
      crossFtPairs: mixedWindowPairs,
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
    });
    expect(without).toHaveLength(1);
    expect(without[0].metrics.map((m) => m.metric.id).sort()).toEqual([
      "m_long",
      "m_short",
    ]);
    expect(without[0].windowOrdinal).toBeNull();
  });

  it("is byte-identical without getWindowKey to a null-returning callback's grouping", () => {
    const without = buildCrossFtSubGroups({
      crossFtPairs: mixedWindowPairs,
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
    });
    const withNullFn = buildCrossFtSubGroups({
      crossFtPairs: mixedWindowPairs,
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
      getWindowKey: () => null,
    });
    expect(withNullFn.map((sg) => sg.metrics.map((m) => m.metric.id))).toEqual(
      without.map((sg) => sg.metrics.map((m) => m.metric.id)),
    );
    expect(withNullFn.map((sg) => sg.windowOrdinal)).toEqual(
      without.map((sg) => sg.windowOrdinal),
    );
    expect(withNullFn[0].pipelines).toEqual(without[0].pipelines);
  });

  it("splits two cross-FT ratio metrics over the same caches but different windows", () => {
    const subGroups = buildCrossFtSubGroups({
      crossFtPairs: mixedWindowPairs,
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
      getWindowKey: windowKeyFn,
    });
    expect(subGroups).toHaveLength(2);
    expect(subGroups.map((sg) => sg.windowOrdinal)).toEqual([0, 1]);
    expect(subGroups[0].metrics.map((m) => m.metric.id)).toEqual(["m_short"]);
    expect(subGroups[1].metrics.map((m) => m.metric.id)).toEqual(["m_long"]);
    expect(subGroups[0].pipelines).toEqual(subGroups[1].pipelines);
  });

  it("collapses same-window cross-FT metrics into one sub-group", () => {
    const subGroups = buildCrossFtSubGroups({
      crossFtPairs: [
        {
          factTableIds: ["ft_a", "ft_b"],
          metrics: [shortCross, anotherShortCross],
        },
      ],
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
      getWindowKey: windowKeyFn,
    });
    expect(subGroups).toHaveLength(1);
    expect(subGroups[0].windowOrdinal).toBe(0);
    expect(subGroups[0].metrics.map((m) => m.metric.id).sort()).toEqual([
      "m_short",
      "m_short_2",
    ]);
  });
});
