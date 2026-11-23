import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  FactMetricInterface,
  StandardFactMetricInterface,
} from "shared/types/fact-table";
import {
  getIncrementalRefreshMetricSources,
  MetricSourceGroups,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { factMetricFactory } from "../factories/FactMetric.factory";

// `getIncrementalRefreshMetricSources` only reaches into the integration for
// `getSourceProperties().maxColumns` (used by the chunker). The rest of the
// SourceIntegrationInterface surface is irrelevant here, so a minimal stub
// is enough — we cast through `unknown` to avoid leaking the full type into
// the test.
const fakeIntegration = {
  getSourceProperties: () => ({ maxColumns: 1000 }),
} as unknown as Parameters<
  typeof getIncrementalRefreshMetricSources
>[0]["integration"];

const baseSnapshotSettings: ExperimentSnapshotSettings = {
  manual: false,
  dimensions: [],
  metricSettings: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  activationMetric: null,
  defaultMetricPriorSettings: {
    override: false,
    proper: false,
    mean: 0,
    stddev: 0,
  },
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure",
  experimentId: "exp_1",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: "ds_1",
  exposureQueryId: "exposure",
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
  variations: [],
};

describe("getIncrementalRefreshMetricSources fan-out", () => {
  it("creates a single group in the numerator FT for a same-FT metric", () => {
    const metric = factMetricFactory.build({
      id: "fact_same_ft",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount" },
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [metric],
      existingMetricSources: [],
      extendExistingSources: false,
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].factTableId).toBe("ft_a");
    expect(groups[0].metrics).toHaveLength(1);
    expect(groups[0].metrics[0].id).toBe("fact_same_ft");
  });

  it("splits a cross-FT ratio metric into groups in both FTs", () => {
    const crossFt = factMetricFactory.build({
      id: "fact_xft_ratio",
      metricType: "ratio",
      numerator: { factTableId: "ft_num", column: "amount" },
      denominator: { factTableId: "ft_denom", column: "tenure" },
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [crossFt],
      existingMetricSources: [],
      extendExistingSources: false,
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });

    expect(groups).toHaveLength(2);
    const numGroup = groups.find((g) => g.factTableId === "ft_num");
    const denomGroup = groups.find((g) => g.factTableId === "ft_denom");
    expect(numGroup).toBeDefined();
    expect(denomGroup).toBeDefined();

    // The same FactMetricInterface reference lives in both groups. Schema
    // gen / insert SQL distinguish numerator-side from denominator-side by
    // comparing the metric's column refs against the cache's factTableId.
    expect(numGroup!.metrics).toHaveLength(1);
    expect(numGroup!.metrics[0].id).toBe("fact_xft_ratio");
    expect(numGroup!.metrics[0].numerator.factTableId).toBe("ft_num");

    expect(denomGroup!.metrics).toHaveLength(1);
    expect(denomGroup!.metrics[0].id).toBe("fact_xft_ratio");
    expect(denomGroup!.metrics[0].denominator?.factTableId).toBe("ft_denom");
  });

  it("routes a funnel into a single group on its step-0 fact table", () => {
    const funnel = {
      ...factMetricFactory.build({ id: "fact_funnel" }),
      id: "fact_funnel",
      metricType: "funnel" as const,
      numerator: null,
      funnelSettings: {
        steps: [
          {
            name: "view",
            factTableId: "ft_funnel",
            rowFilters: [],
            optional: false,
            conversionWindow: null,
          },
          {
            name: "purchase",
            factTableId: "ft_funnel",
            rowFilters: [],
            optional: false,
            conversionWindow: { unit: "hours" as const, value: 2 },
          },
        ],
        concurrencyWindowSeconds: 0,
      },
    } as unknown as FactMetricInterface;
    const groups = getIncrementalRefreshMetricSources({
      metrics: [funnel],
      existingMetricSources: [],
      extendExistingSources: false,
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].factTableId).toBe("ft_funnel");
    expect(groups[0].metrics).toHaveLength(1);
    expect(groups[0].metrics[0].id).toBe("fact_funnel");
  });

  it("co-locates a cross-FT numerator entry with a same-FT metric in the shared FT", () => {
    // When the numerator FT of a cross-FT ratio is the same FT that hosts an
    // unrelated same-FT metric, we expect ONE group on that FT containing
    // both metrics — chunking only kicks in when the column budget is
    // exceeded.
    const sameFt = factMetricFactory.build({
      id: "fact_same_ft",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount" },
    });
    const crossFt = factMetricFactory.build({
      id: "fact_xft_ratio",
      metricType: "ratio",
      numerator: { factTableId: "ft_a", column: "amount" },
      denominator: { factTableId: "ft_b", column: "tenure" },
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [sameFt, crossFt],
      existingMetricSources: [],
      extendExistingSources: false,
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });

    const groupA = groups.filter((g) => g.factTableId === "ft_a");
    const groupB = groups.filter((g) => g.factTableId === "ft_b");
    expect(groupA).toHaveLength(1);
    expect(groupB).toHaveLength(1);

    expect(groupA[0].metrics.map((m) => m.id).sort()).toEqual([
      "fact_same_ft",
      "fact_xft_ratio",
    ]);
    expect(groupB[0].metrics).toHaveLength(1);
    expect(groupB[0].metrics[0].id).toBe("fact_xft_ratio");
  });

  it("reuses an existing group when the (factTableId, metricId) tuple matches", () => {
    // A cross-FT ratio's denominator side has been materialized previously.
    // The same metric should attach to the existing groupId rather than
    // creating a brand new group — this is what avoids unnecessary cache
    // rebuilds across runs.
    const crossFt = factMetricFactory.build({
      id: "fact_xft_ratio",
      metricType: "ratio",
      numerator: { factTableId: "ft_num", column: "amount" },
      denominator: { factTableId: "ft_denom", column: "tenure" },
    });

    const groups = getIncrementalRefreshMetricSources({
      metrics: [crossFt],
      existingMetricSources: [
        {
          groupId: "preexisting_denom",
          factTableId: "ft_denom",
          tableFullName: "proj.ds.cache_denom",
          maxTimestamp: null,
          metrics: [
            {
              id: "fact_xft_ratio",
              settingsHash: "stale-hash",
            },
          ],
        },
      ],
      extendExistingSources: false,
      integration: fakeIntegration,
      snapshotSettings: baseSnapshotSettings,
    });

    const denomGroup = groups.find((g) => g.factTableId === "ft_denom") as
      | MetricSourceGroups
      | undefined;
    const numGroup = groups.find((g) => g.factTableId === "ft_num") as
      | MetricSourceGroups
      | undefined;

    expect(denomGroup?.groupId).toBe("preexisting_denom");
    // New side is fresh, so its groupId is randomized — just confirm it
    // exists and that orientation is recoverable from the metric.
    expect(numGroup).toBeDefined();
    expect(numGroup!.metrics[0].numerator.factTableId).toBe("ft_num");
  });

  it("splits cluster-level and sub-unit metrics on the same FT into separate caches", () => {
    // In a cluster experiment, a sub-unit metric (summable, rolled up) and a
    // cluster-level metric (cluster as the unit) can share a fact table but
    // must not share a cache — they're keyed on different grains.
    const subUnitMetric = factMetricFactory.build({
      id: "fact_subunit",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount", aggregation: "sum" },
    });
    const clusterLevelMetric = factMetricFactory.build({
      id: "fact_cluster_level",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount", aggregation: "max" },
    });

    const groups = getIncrementalRefreshMetricSources({
      metrics: [subUnitMetric, clusterLevelMetric],
      existingMetricSources: [],
      extendExistingSources: false,
      integration: fakeIntegration,
      snapshotSettings: {
        ...baseSnapshotSettings,
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
        clusterLevelMetricIds: ["fact_cluster_level"],
      },
    });

    // Two caches on the same FT, one per grain.
    const ftAGroups = groups.filter((g) => g.factTableId === "ft_a");
    expect(ftAGroups).toHaveLength(2);

    const subUnitGroup = ftAGroups.find((g) =>
      g.metrics.some((m) => m.id === "fact_subunit"),
    );
    const clusterGroup = ftAGroups.find((g) =>
      g.metrics.some((m) => m.id === "fact_cluster_level"),
    );
    expect(subUnitGroup).toBeDefined();
    expect(clusterGroup).toBeDefined();
    // The grains never share a cache.
    expect(subUnitGroup!.groupId).not.toBe(clusterGroup!.groupId);
    expect(subUnitGroup!.metrics.map((m) => m.id)).toEqual(["fact_subunit"]);
    expect(clusterGroup!.metrics.map((m) => m.id)).toEqual([
      "fact_cluster_level",
    ]);
    // The groupId flows into the physical cache table name
    // (`gb_metrics_<exp>_<groupId>`), so it must be a valid warehouse table
    // identifier — no `:` or other illegal characters.
    expect(clusterGroup!.groupId).toMatch(/^[A-Za-z0-9_]+$/);
    expect(subUnitGroup!.groupId).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it("keeps same-FT metrics in one cache when not a cluster experiment", () => {
    // The cluster-level split is gated on cluster mode, so the same two
    // metrics group together normally when the experiment isn't a cluster.
    const metricA = factMetricFactory.build({
      id: "fact_a1",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount", aggregation: "sum" },
    });
    const metricB = factMetricFactory.build({
      id: "fact_a2",
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount", aggregation: "max" },
    });

    const groups = getIncrementalRefreshMetricSources({
      metrics: [metricA, metricB],
      existingMetricSources: [],
      extendExistingSources: false,
      integration: fakeIntegration,
      // clusterLevelMetricIds is ignored without isClusterExperiment.
      snapshotSettings: {
        ...baseSnapshotSettings,
        clusterLevelMetricIds: ["fact_a2"],
      },
    });

    const ftAGroups = groups.filter((g) => g.factTableId === "ft_a");
    expect(ftAGroups).toHaveLength(1);
    expect(ftAGroups[0].metrics.map((m) => m.id).sort()).toEqual([
      "fact_a1",
      "fact_a2",
    ]);
  });
});

describe("getIncrementalRefreshMetricSources placement", () => {
  const mean = (id: string, over: Partial<StandardFactMetricInterface> = {}) =>
    factMetricFactory.build({
      id,
      metricType: "mean",
      numerator: { factTableId: "ft_a", column: "amount" },
      ...over,
    });
  // Room for this many metric columns in a cache.
  const integrationWithRoomFor = (columns: number) =>
    ({
      getSourceProperties: () => ({ maxColumns: 103 + columns }),
    }) as unknown as Parameters<
      typeof getIncrementalRefreshMetricSources
    >[0]["integration"];
  const storedSource = (groupId: string, metricIds: string[]) => ({
    groupId,
    factTableId: "ft_a",
    tableFullName: `proj.ds.${groupId}`,
    maxTimestamp: null,
    metrics: metricIds.map((id) => ({ id, settingsHash: "h" })),
  });
  const membership = (groups: MetricSourceGroups[]) =>
    groups.map((g) => g.metrics.map((m) => m.id).join(",")).sort();

  it("rebuilds the stored source a new metric joins under a new id when extending", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [mean("m1"), mean("m2"), mean("m_new")],
      existingMetricSources: [storedSource("stored", ["m1", "m2"])],
      extendExistingSources: true,
      integration: integrationWithRoomFor(100),
      snapshotSettings: baseSnapshotSettings,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].replacesGroupId).toBe("stored");
    expect(groups[0].groupId).not.toBe("stored");
    expect(groups[0].metrics.map((m) => m.id)).toEqual(["m1", "m2", "m_new"]);
  });

  it("keeps a stored source that takes no new metric under its id", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [mean("m1"), mean("m2"), mean("m_new")],
      existingMetricSources: [
        storedSource("stored_1", ["m1"]),
        storedSource("stored_2", ["m2"]),
      ],
      extendExistingSources: true,
      integration: integrationWithRoomFor(100),
      snapshotSettings: baseSnapshotSettings,
    });
    expect(
      groups.map((g) => [
        g.replacesGroupId ?? g.groupId,
        g.metrics.map((m) => m.id),
      ]),
    ).toEqual([
      ["stored_2", ["m2"]],
      ["stored_1", ["m1", "m_new"]],
    ]);
    expect(groups[0].groupId).toBe("stored_2");
  });

  it("only opens new sources when not extending", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [mean("m1"), mean("m_new")],
      existingMetricSources: [storedSource("stored_1", ["m1"])],
      extendExistingSources: false,
      integration: integrationWithRoomFor(100),
      snapshotSettings: baseSnapshotSettings,
    });
    expect(
      groups.map((g) => [g.groupId === "stored_1", g.replacesGroupId]),
    ).toEqual([
      [true, null],
      [false, null],
    ]);
  });

  it("packs the same sources whatever order the experiment lists its metrics in", () => {
    const metrics = [
      mean("a"),
      mean("b", { regressionAdjustmentEnabled: true }),
      mean("c"),
      mean("d", { regressionAdjustmentEnabled: true }),
      mean("e"),
    ];
    const pack = (list: FactMetricInterface[]) =>
      membership(
        getIncrementalRefreshMetricSources({
          metrics: list,
          existingMetricSources: [],
          extendExistingSources: false,
          integration: integrationWithRoomFor(12),
          snapshotSettings: {
            ...baseSnapshotSettings,
            regressionAdjustmentEnabled: true,
          },
        }),
      );
    // CUPED metrics take 6 columns, the others 3.
    expect(pack(metrics)).toEqual(["b,d", "a,c,e"].sort());
    expect(pack([...metrics].reverse())).toEqual(pack(metrics));
  });

  it("counts each slice as its own metric in the column budget, without uncapped copies", () => {
    const capped = {
      cappingSettings: { type: "absolute" as const, value: 10 },
    };
    const groups = getIncrementalRefreshMetricSources({
      metrics: [
        mean("m", capped),
        mean("m?dim:country=US", capped),
        mean("m?dim:country=CA", capped),
      ],
      existingMetricSources: [],
      extendExistingSources: false,
      // The base metric takes 5 columns with its uncapped copy, each slice 3.
      integration: integrationWithRoomFor(8),
      snapshotSettings: baseSnapshotSettings,
    });
    expect(membership(groups)).toEqual(
      ["m,m?dim:country=CA", "m?dim:country=US"].sort(),
    );
  });
});
