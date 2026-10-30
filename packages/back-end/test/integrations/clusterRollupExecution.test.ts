import { DatabaseSync } from "node:sqlite";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type {
  DimensionColumnData,
  FactMetricData,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { baseDialect } from "shared/dialects";
import { getClusterRollupCTE } from "back-end/src/integrations/sql/ctes/cluster-rollup-cte";
import { getExperimentFactMetricStatisticsCTE } from "back-end/src/integrations/sql/ctes/experiment-fact-metric-statistics-cte";
import { getMetricData } from "back-end/src/integrations/sql/fact-metrics/metric-data";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

// Why this test exists
// --------------------
// The other cluster tests (sqlintegration.test.ts, BigQuery.test.ts,
// clusterMetricStatsSettings.test.ts) only assert on substrings of the
// generated SQL. They prove the query *looks* right, not that it *computes*
// the right numbers. This test takes the exact SQL produced by the production
// CTE builders, runs it against an in-memory SQLite fixture with known cluster
// sizes and values, and checks the four aggregates gbstats consumes:
//   - main_sum                      (Σ_clusters cluster value)
//   - denominator_sum               (Σ_clusters cluster denominator)
//   - main_denominator_sum_product  (Σ_clusters value·denominator)
//   - users                         (number of clusters, COUNT(*))
//
// It covers the two scenarios the review flagged:
//   1.1  Each cluster is a single unit in a single arm — users counts each
//        cluster exactly once per variation and no cluster's value leaks into
//        another arm.
//   1.5  Unit dimensions are carried through the rollup and aggregated per
//        cluster, so per-(variation, dimension) aggregates stay correct.
//
// It uses the base dialect (SQLite-portable: no-op float cast,
// `cast(x as varchar)`) and Node's built-in `node:sqlite`, so there is no new
// dependency and no external database.

const dialect: SqlDialect = {
  ...baseDialect,
  unpivotLabeledPairs: () => {
    throw new Error("unpivotLabeledPairs is not used by the cluster rollup");
  },
};

const ordersFactTable = factTableFactory.build({
  id: "orders",
  name: "Orders Fact Table",
  sql: "*",
  userIdTypes: ["user_id", "region_id"],
});
const factTablesWithIndices = [{ factTable: ordersFactTable, index: 0 }];

const settings: Pick<
  ExperimentSnapshotSettings,
  | "attributionModel"
  | "regressionAdjustmentEnabled"
  | "startDate"
  | "isClusterExperiment"
  | "clusterSubUnitIdentifier"
  | "clusterLevelMetricIds"
> & { endDate?: Date } = {
  attributionModel: "firstExposure",
  regressionAdjustmentEnabled: false,
  startDate: new Date("2023-01-01"),
  endDate: new Date("2023-01-31"),
  isClusterExperiment: true,
  clusterSubUnitIdentifier: "user_id",
  clusterLevelMetricIds: undefined,
};

// One per-sub-unit aggregate row: the sub-unit (user) belongs to a cluster
// (region) in one variation, and carries the already-per-sub-unit metric value
// (and denominator for native ratio metrics).
type SubUnitRow = {
  variation: string;
  user_id: string;
  region_id: string;
  dim?: string;
  dim_exp_browser?: string;
  m0_value: number;
  m0_denominator?: number;
};

function buildMetricData(
  metric: Parameters<typeof getMetricData>[1]["metric"],
): FactMetricData {
  return getMetricData(
    dialect,
    { metric, index: 0 },
    settings,
    null,
    factTablesWithIndices,
    "m",
    "m0",
    false,
  );
}

// Assembles `WITH __userMetricAgg(<fixture>), __clusterRollup(<rollup>) <stats>`
// from the real production builders and the fixture rows.
function buildSql(
  data: FactMetricData,
  rows: SubUnitRow[],
  dimensionCols: DimensionColumnData[],
): string {
  const columns = [
    "variation",
    "user_id",
    "region_id",
    ...dimensionCols.map((c) => c.alias),
    "m0_value",
    ...(data.ratioMetric ? ["m0_denominator"] : []),
  ];
  const literal = (row: SubUnitRow, col: string): string => {
    const value = (row as Record<string, string | number | undefined>)[col];
    if (typeof value === "number") return `${value}`;
    return `'${String(value)}'`;
  };
  const fixture = rows
    .map((row, i) =>
      i === 0
        ? `SELECT ${columns
            .map((c) => `${literal(row, c)} AS ${c}`)
            .join(", ")}`
        : `SELECT ${columns.map((c) => literal(row, c)).join(", ")}`,
    )
    .join("\n      UNION ALL ");

  const rollup = getClusterRollupCTE({
    dimensionCols,
    metricData: [data],
    baseIdType: "user_id",
    clusterIdColumn: "region_id",
    perUserAggTableName: "__userMetricAgg",
    capValueTableName: "__capValue",
    factTablesWithIndices,
    percentileTableIndices: new Set<number>(),
  });

  const statistics = getExperimentFactMetricStatisticsCTE(dialect, {
    dimensionCols,
    metricData: [data],
    eventQuantileData: [],
    baseIdType: "user_id",
    joinedMetricTableName: "__userMetricAgg",
    statisticsSourceTableName: "__clusterRollup",
    flattenedSources: true,
    funnelsResolvedOnSource: false,
    eventQuantileTableName: "__eventQuantileMetric",
    capValueTableName: "__capValue",
    factTablesWithIndices,
    percentileTableIndices: new Set<number>(),
    useClusterRollup: true,
  });

  return `WITH __userMetricAgg AS (
      ${fixture}
    )
    , __clusterRollup AS (
      ${rollup}
    )
    ${statistics}`;
}

type StatRow = {
  variation: string;
  dim?: string;
  dim_exp_browser?: string;
  users: number;
  m0_main_sum: number;
  m0_denominator_sum: number;
  m0_main_denominator_sum_product: number;
};

function run(sql: string): StatRow[] {
  const db = new DatabaseSync(":memory:");
  try {
    return db.prepare(sql).all() as unknown as StatRow[];
  } finally {
    db.close();
  }
}

describe("cluster rollup execution (SQL math)", () => {
  // 1.1: converted mean → cluster-robust ratio. Each sub-unit value is summed
  // to its cluster, and the denominator is the cluster size (distinct
  // sub-units). The statistics CTE then aggregates over clusters with
  // users = number of clusters per arm.
  it("rolls a converted-mean metric up to clusters with the cluster size as the denominator", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_mean",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
    });
    const data = buildMetricData(metric);
    // Sanity: a converted mean is a cluster-ratio conversion (denominator =
    // distinct sub-units), not a native ratio.
    expect(data.isClusterRatioConversion).toBe(true);
    expect(data.ratioMetric).toBe(false);

    const rows: SubUnitRow[] = [
      // control: cluster r1 (value 30, size 2), cluster r2 (value 5, size 1)
      { variation: "control", user_id: "u1", region_id: "r1", m0_value: 10 },
      { variation: "control", user_id: "u2", region_id: "r1", m0_value: 20 },
      { variation: "control", user_id: "u3", region_id: "r2", m0_value: 5 },
      // treatment: cluster r3 (value 14, size 3), cluster r4 (value 6, size 1)
      { variation: "treatment", user_id: "u4", region_id: "r3", m0_value: 8 },
      { variation: "treatment", user_id: "u5", region_id: "r3", m0_value: 2 },
      { variation: "treatment", user_id: "u6", region_id: "r3", m0_value: 4 },
      { variation: "treatment", user_id: "u7", region_id: "r4", m0_value: 6 },
    ];

    const result = run(buildSql(data, rows, []));
    const byVariation = Object.fromEntries(result.map((r) => [r.variation, r]));

    expect(byVariation.control).toMatchObject({
      users: 2, // clusters r1, r2
      m0_main_sum: 35, // 30 + 5
      m0_denominator_sum: 3, // size 2 + size 1
      m0_main_denominator_sum_product: 65, // 30*2 + 5*1
    });
    expect(byVariation.treatment).toMatchObject({
      users: 2, // clusters r3, r4
      m0_main_sum: 20, // 14 + 6
      m0_denominator_sum: 4, // size 3 + size 1
      m0_main_denominator_sum_product: 48, // 14*3 + 6*1
    });
  });

  // Native ratio: the rollup sums the per-sub-unit numerator AND denominator to
  // the cluster (denominator is NOT the cluster size here).
  it("rolls a native-ratio metric up to clusters by summing numerator and denominator", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_ratio",
      metricType: "ratio",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      denominator: { factTableId: "orders", column: "qty", aggregation: "sum" },
    });
    const data = buildMetricData(metric);
    expect(data.ratioMetric).toBe(true);
    expect(data.isClusterRatioConversion).toBe(false);

    const rows: SubUnitRow[] = [
      // control: r1 (value 30, denom 5), r2 (value 5, denom 1)
      {
        variation: "control",
        user_id: "u1",
        region_id: "r1",
        m0_value: 10,
        m0_denominator: 2,
      },
      {
        variation: "control",
        user_id: "u2",
        region_id: "r1",
        m0_value: 20,
        m0_denominator: 3,
      },
      {
        variation: "control",
        user_id: "u3",
        region_id: "r2",
        m0_value: 5,
        m0_denominator: 1,
      },
      // treatment: r3 (value 14, denom 7)
      {
        variation: "treatment",
        user_id: "u4",
        region_id: "r3",
        m0_value: 8,
        m0_denominator: 4,
      },
      {
        variation: "treatment",
        user_id: "u5",
        region_id: "r3",
        m0_value: 2,
        m0_denominator: 1,
      },
      {
        variation: "treatment",
        user_id: "u6",
        region_id: "r3",
        m0_value: 4,
        m0_denominator: 2,
      },
    ];

    const result = run(buildSql(data, rows, []));
    const byVariation = Object.fromEntries(result.map((r) => [r.variation, r]));

    expect(byVariation.control).toMatchObject({
      users: 2, // clusters r1, r2
      m0_main_sum: 35, // 30 + 5
      m0_denominator_sum: 6, // 5 + 1
      m0_main_denominator_sum_product: 155, // 30*5 + 5*1
    });
    expect(byVariation.treatment).toMatchObject({
      users: 1, // cluster r3
      m0_main_sum: 14, // 8 + 2 + 4
      m0_denominator_sum: 7, // 4 + 1 + 2
      m0_main_denominator_sum_product: 98, // 14*7
    });
  });

  // 1.5: a unit dimension is carried through the rollup and aggregated per
  // cluster, so aggregates are grouped per (variation, dimension) and the
  // dimension is not dropped.
  it("carries a unit dimension through the rollup and aggregates per cluster", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_mean_dim",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
    });
    const data = buildMetricData(metric);
    const dimensionCols: DimensionColumnData[] = [
      { alias: "dim", value: "dim" },
    ];

    const rows: SubUnitRow[] = [
      // control / US: cluster r1 (value 30, size 2)
      {
        variation: "control",
        user_id: "u1",
        region_id: "r1",
        dim: "US",
        m0_value: 10,
      },
      {
        variation: "control",
        user_id: "u2",
        region_id: "r1",
        dim: "US",
        m0_value: 20,
      },
      // control / CA: cluster r2 (value 5, size 1)
      {
        variation: "control",
        user_id: "u3",
        region_id: "r2",
        dim: "CA",
        m0_value: 5,
      },
      // treatment / US: cluster r3 (value 10, size 2)
      {
        variation: "treatment",
        user_id: "u4",
        region_id: "r3",
        dim: "US",
        m0_value: 8,
      },
      {
        variation: "treatment",
        user_id: "u5",
        region_id: "r3",
        dim: "US",
        m0_value: 2,
      },
    ];

    const result = run(buildSql(data, rows, dimensionCols));
    const byKey = Object.fromEntries(
      result.map((r) => [`${r.variation}/${r.dim}`, r]),
    );

    expect(byKey["control/US"]).toMatchObject({
      users: 1,
      m0_main_sum: 30,
      m0_denominator_sum: 2,
      m0_main_denominator_sum_product: 60, // 30*2
    });
    expect(byKey["control/CA"]).toMatchObject({
      users: 1,
      m0_main_sum: 5,
      m0_denominator_sum: 1,
      m0_main_denominator_sum_product: 5, // 5*1
    });
    expect(byKey["treatment/US"]).toMatchObject({
      users: 1,
      m0_main_sum: 10,
      m0_denominator_sum: 2,
      m0_main_denominator_sum_product: 20, // 10*2
    });
  });

  // Dimension isolation for cluster experiments
  // -------------------------------------------
  // The fix runs the OVERALL (parent) analysis over a DIMENSIONLESS rollup
  // (GROUP BY variation, cluster) so each cluster is one whole observation, and
  // runs each sub-unit breakdown as its OWN isolated query (GROUP BY variation,
  // dim, cluster). Re-deriving the overall by summing the per-dimension rows
  // would split clusters across dimension values and double-count them, which is
  // why the parent must stay dimensionless.
  it("computes the overall over whole clusters and isolates each sub-unit dimension slice", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_mean_isolation",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
    });
    const data = buildMetricData(metric);
    const browserDim: DimensionColumnData[] = [
      { alias: "dim_exp_browser", value: "dim_exp_browser" },
    ];

    // Worked example: clusters A (total 20) and B (total 40), each split evenly
    // across browser X/Y.
    const rows: SubUnitRow[] = [
      {
        variation: "control",
        user_id: "a1",
        region_id: "A",
        dim_exp_browser: "X",
        m0_value: 10,
      },
      {
        variation: "control",
        user_id: "a2",
        region_id: "A",
        dim_exp_browser: "Y",
        m0_value: 10,
      },
      {
        variation: "control",
        user_id: "b1",
        region_id: "B",
        dim_exp_browser: "X",
        m0_value: 20,
      },
      {
        variation: "control",
        user_id: "b2",
        region_id: "B",
        dim_exp_browser: "Y",
        m0_value: 20,
      },
    ];

    // (a) Dimensionless parent: GROUP BY (variation, cluster) — each cluster
    // appears once, and the query carries no dimension column.
    const parentSql = buildSql(data, rows, []);
    expect(parentSql).not.toContain("dim_exp_");
    const overall = run(parentSql);
    expect(overall).toHaveLength(1);
    expect(overall[0]).toMatchObject({
      users: 2, // clusters A, B
      m0_main_sum: 60, // 20 + 40
      m0_denominator_sum: 4, // cluster sizes 2 + 2
    });

    // (b) Isolated per-dimension query: GROUP BY (variation, dim, cluster). Each
    // cluster stays whole within its slice (one row per cluster per slice).
    const isolatedSql = buildSql(data, rows, browserDim);
    expect(isolatedSql).toContain("dim_exp_browser");
    const bySlice = Object.fromEntries(
      run(isolatedSql).map((r) => [r.dim_exp_browser, r]),
    );
    expect(bySlice.X).toMatchObject({
      users: 2, // clusters A, B each contribute their X portion
      m0_main_sum: 30, // 10 + 20
      m0_denominator_sum: 2, // one sub-unit per cluster in slice X
    });
    expect(bySlice.Y).toMatchObject({
      users: 2,
      m0_main_sum: 30,
      m0_denominator_sum: 2,
    });

    // Re-deriving the overall from the per-dimension rows would double-count the
    // clusters: summed users (2 + 2 = 4) exceeds the true cluster count (2).
    // This is exactly why the parent analysis must read the dimensionless rollup.
    const summedUsers = Object.values(bySlice).reduce(
      (acc, r) => acc + r.users,
      0,
    );
    expect(summedUsers).toBe(4);
    expect(summedUsers).toBeGreaterThan(overall[0].users);
  });
});
