import type { FactMetricInterface } from "shared/types/fact-table";
import { buildMultiSourceSubGroups } from "back-end/src/services/experimentQueries/multiSourceSubGroups";
import type {
  MultiSourcePipelineRef,
  MultiSourceGroupRef,
} from "back-end/src/services/experimentQueries/multiSourceSubGroups";
import type { MultiSourceGroup } from "back-end/src/services/experimentQueries/planMetricFanOut";
import {
  conversionWindowMinutesKey,
  getMetricConversionWindowHours,
} from "back-end/src/services/experimentQueries/partitionMetricsByConversionWindow";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

const pipelineA: MultiSourcePipelineRef = {
  group: { groupId: "gA", factTableId: "ft_a" },
};
const pipelineB: MultiSourcePipelineRef = {
  group: { groupId: "gB", factTableId: "ft_b" },
};

function makeCrossRatioMetric(id: string, windowValueDays: number) {
  return factMetricFactory.build({
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
}

const shortMetric = makeCrossRatioMetric("m_short", 1);
const longMetric = makeCrossRatioMetric("m_long", 4);
const anotherShortMetric = makeCrossRatioMetric("m_short_2", 1);

const metricSourceGroups: MultiSourceGroupRef[] = [
  {
    groupId: "gA",
    factTableId: "ft_a",
    metrics: [
      { id: "m_short" },
      { id: "m_long" },
      { id: "m_short_2" },
      { id: "mf_funnel" },
    ],
  },
  {
    groupId: "gB",
    factTableId: "ft_b",
    metrics: [
      { id: "m_short" },
      { id: "m_long" },
      { id: "m_short_2" },
      { id: "mf_funnel" },
    ],
  },
];

const pipelineByGroupId = new Map<string, MultiSourcePipelineRef>([
  ["gA", pipelineA],
  ["gB", pipelineB],
]);

function makeMultiSourceGroup(
  metrics: FactMetricInterface[],
  crossFtRatioMetrics: MultiSourceGroup["crossFtRatioMetrics"] = [],
): MultiSourceGroup {
  return {
    factTableIds: ["ft_a", "ft_b"],
    metrics,
    crossFtRatioMetrics,
  };
}

function windowKeyFn(m: FactMetricInterface): string | null {
  return conversionWindowMinutesKey(getMetricConversionWindowHours(m, null));
}

describe("buildMultiSourceSubGroups", () => {
  it("collapses mixed-window metrics without getWindowKey", () => {
    const group = makeMultiSourceGroup(
      [shortMetric, longMetric],
      [
        {
          metric: shortMetric,
          numeratorFactTableId: "ft_a",
          denominatorFactTableId: "ft_b",
        },
        {
          metric: longMetric,
          numeratorFactTableId: "ft_a",
          denominatorFactTableId: "ft_b",
        },
      ],
    );
    const result = buildMultiSourceSubGroups({
      multiSourceGroups: [group],
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
    });
    expect(result).toHaveLength(1);
    expect(result[0].metrics.map((m) => m.id).sort()).toEqual([
      "m_long",
      "m_short",
    ]);
    expect(result[0].windowKey).toBeNull();
  });

  it("splits metrics with different windows when getWindowKey is set", () => {
    const group = makeMultiSourceGroup(
      [shortMetric, longMetric],
      [
        {
          metric: shortMetric,
          numeratorFactTableId: "ft_a",
          denominatorFactTableId: "ft_b",
        },
        {
          metric: longMetric,
          numeratorFactTableId: "ft_a",
          denominatorFactTableId: "ft_b",
        },
      ],
    );
    const result = buildMultiSourceSubGroups({
      multiSourceGroups: [group],
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
      getWindowKey: windowKeyFn,
    });
    expect(result).toHaveLength(2);
    expect(result.map((sg) => sg.windowKey).sort()).toEqual(["1440m", "5760m"]);
    const byKey = Object.fromEntries(
      result.map((sg) => [sg.windowKey, sg.metrics.map((m) => m.id)]),
    );
    expect(byKey["1440m"]).toEqual(["m_short"]);
    expect(byKey["5760m"]).toEqual(["m_long"]);
  });

  it("collapses same-window metrics into one sub-group", () => {
    const group = makeMultiSourceGroup(
      [shortMetric, anotherShortMetric],
      [
        {
          metric: shortMetric,
          numeratorFactTableId: "ft_a",
          denominatorFactTableId: "ft_b",
        },
        {
          metric: anotherShortMetric,
          numeratorFactTableId: "ft_a",
          denominatorFactTableId: "ft_b",
        },
      ],
    );
    const result = buildMultiSourceSubGroups({
      multiSourceGroups: [group],
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
      getWindowKey: windowKeyFn,
    });
    expect(result).toHaveLength(1);
    expect(result[0].windowKey).toBe("1440m");
    expect(result[0].metrics.map((m) => m.id).sort()).toEqual([
      "m_short",
      "m_short_2",
    ]);
  });

  it("skips groups with missing pipelines when onMissingPipeline is skip", () => {
    const group = makeMultiSourceGroup([shortMetric]);
    const result = buildMultiSourceSubGroups({
      multiSourceGroups: [group],
      metricSourceGroups,
      pipelineByGroupId: new Map(),
      onMissingPipeline: "skip",
    });
    expect(result).toEqual([]);
  });

  it("throws for missing pipelines when onMissingPipeline is throw", () => {
    const group = makeMultiSourceGroup([shortMetric]);
    expect(() =>
      buildMultiSourceSubGroups({
        multiSourceGroups: [group],
        metricSourceGroups,
        pipelineByGroupId: new Map(),
        onMissingPipeline: "throw",
      }),
    ).toThrow();
  });

  it("sorts pipelines by groupId for canonical ordering", () => {
    const group = makeMultiSourceGroup([shortMetric]);
    const reversed = new Map<string, MultiSourcePipelineRef>([
      ["gB", pipelineB],
      ["gA", pipelineA],
    ]);
    const result = buildMultiSourceSubGroups({
      multiSourceGroups: [group],
      metricSourceGroups,
      pipelineByGroupId: reversed,
      onMissingPipeline: "throw",
    });
    expect(result).toHaveLength(1);
    expect(result[0].pipelines.map((p) => p.group.groupId)).toEqual([
      "gA",
      "gB",
    ]);
  });

  it("preserves crossFtRatioMetrics in sub-groups", () => {
    const crossFtEntry = {
      metric: shortMetric,
      numeratorFactTableId: "ft_a",
      denominatorFactTableId: "ft_b",
    };
    const group = makeMultiSourceGroup([shortMetric], [crossFtEntry]);
    const result = buildMultiSourceSubGroups({
      multiSourceGroups: [group],
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
    });
    expect(result[0].crossFtRatioMetrics).toEqual([crossFtEntry]);
  });

  it("groups a funnel-only multi-source group correctly", () => {
    const funnelMetric = factMetricFactory.build({
      id: "mf_funnel",
      metricType: "mean",
    });
    const group: MultiSourceGroup = {
      factTableIds: ["ft_a", "ft_b"],
      metrics: [funnelMetric],
      crossFtRatioMetrics: [],
    };
    const result = buildMultiSourceSubGroups({
      multiSourceGroups: [group],
      metricSourceGroups,
      pipelineByGroupId,
      onMissingPipeline: "throw",
    });
    expect(result).toHaveLength(1);
    expect(result[0].metrics.map((m) => m.id)).toEqual(["mf_funnel"]);
    expect(result[0].crossFtRatioMetrics).toEqual([]);
  });
});
