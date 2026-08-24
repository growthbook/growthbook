import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import BigQuery from "back-end/src/integrations/BigQuery";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { getQuantileSketchGridColumns } from "back-end/src/integrations/sql/columns/quantile-sketch-grid-columns";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";
import { getFactTableTypeFromBigQueryType } from "back-end/src/services/bigquery";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

type MockBigQueryJob = {
  id: string;
  getQueryResults: jest.Mock;
  getMetadata: jest.Mock;
};

describe("BigQuery reservation job config", () => {
  let integration: BigQuery;
  let mockJob: MockBigQueryJob;
  let mockCreateQueryJob: jest.Mock;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});

    mockJob = {
      id: "job_123",
      getQueryResults: jest.fn().mockResolvedValue([[], undefined, undefined]),
      getMetadata: jest.fn().mockResolvedValue([{}]),
    };

    mockCreateQueryJob = jest.fn().mockResolvedValue([mockJob]);

    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(integration as any, "getClient")
      .mockReturnValue({ createQueryJob: mockCreateQueryJob });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("includes reservation in query job config when set", async () => {
    integration.params = {
      reservation:
        "projects/my-project/locations/US/reservations/my-reservation",
    };

    await integration.runQuery("SELECT 1");

    const queryJobConfig = mockCreateQueryJob.mock.calls[0][0];
    expect(queryJobConfig).toEqual({
      labels: { integration: "growthbook" },
      query: "SELECT 1",
      useLegacySql: false,
      reservation:
        "projects/my-project/locations/US/reservations/my-reservation",
    });
  });

  it("does not include reservation in query job config when missing", async () => {
    integration.params = {};

    await integration.runQuery("SELECT 1");

    const queryJobConfig = mockCreateQueryJob.mock.calls[0][0];
    expect(queryJobConfig).toEqual({
      labels: { integration: "growthbook" },
      query: "SELECT 1",
      useLegacySql: false,
    });
    expect(queryJobConfig).not.toHaveProperty("reservation");
  });
});

describe("BigQuery percentileCapSelectClause (UNPIVOT reshape)", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});
  });

  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  it("falls back to wide APPROX_QUANTILES for a single capped column", () => {
    const sql = integration.getSqlDialect().percentileCapSelectClause(
      [
        {
          valueCol: "m0_value",
          outputCol: "m0_value_cap",
          percentile: 0.99,
          ignoreZeros: false,
          sourceIndex: 0,
        },
      ],
      "__userMetricAgg",
    );
    expect(norm(sql)).toContain(
      "APPROX_QUANTILES(m0_value, 10000 IGNORE NULLS)[OFFSET(CAST(9900 AS INT64))] AS m0_value_cap",
    );
    expect(sql).not.toContain("UNPIVOT");
    expect(sql).not.toContain("PIVOT");
  });

  it("stays in wide form below the reshape threshold (a few capped columns)", () => {
    const sql = norm(
      integration.getSqlDialect().percentileCapSelectClause(
        [
          {
            valueCol: "m0_value",
            outputCol: "m0_value_cap",
            percentile: 0.99,
            ignoreZeros: false,
            sourceIndex: 0,
          },
          {
            valueCol: "m1_value",
            outputCol: "m1_value_cap",
            percentile: 0.999,
            ignoreZeros: true,
            sourceIndex: 0,
          },
        ],
        "__userMetricAgg",
      ),
    );
    expect(sql).not.toContain("UNPIVOT");
    expect(sql).not.toContain("PIVOT");
    expect(sql).toContain(
      "APPROX_QUANTILES(m0_value, 10000 IGNORE NULLS)[OFFSET(CAST(9900 AS INT64))] AS m0_value_cap",
    );
  });

  it("reshapes to UNPIVOT/GROUP BY/PIVOT once the column count crosses the threshold", () => {
    const RESHAPE_THRESHOLD = 20;
    const cols = Array.from({ length: RESHAPE_THRESHOLD }, (_, i) => ({
      valueCol: `m${i}_value`,
      outputCol: `m${i}_value_cap`,
      percentile: i === 1 ? 0.999 : 0.99,
      ignoreZeros: i === 1,
      sourceIndex: 0,
    }));
    const sql = norm(
      integration
        .getSqlDialect()
        .percentileCapSelectClause(cols, "__userMetricAgg"),
    );
    const unpivotList = cols.map((c) => c.valueCol).join(", ");
    const pivotList = cols
      .map((c) => `'${c.valueCol}' AS ${c.outputCol}`)
      .join(", ");
    expect(sql).toContain(`UNPIVOT (val FOR col_name IN (${unpivotList}))`);
    expect(sql).toContain("GROUP BY col_name");
    expect(sql).toContain(
      `PIVOT (ANY_VALUE(cap) FOR col_name IN (${pivotList}))`,
    );
  });

  it("omits the ignore-zero IF wrapper when no column opts in (reshape path)", () => {
    const RESHAPE_THRESHOLD = 20;
    const cols = Array.from({ length: RESHAPE_THRESHOLD }, (_, i) => ({
      valueCol: `m${i}_value`,
      outputCol: `m${i}_value_cap`,
      percentile: 0.99,
      ignoreZeros: false,
      sourceIndex: 0,
    }));
    const sql = norm(
      integration
        .getSqlDialect()
        .percentileCapSelectClause(cols, "__userMetricAgg"),
    );
    expect(sql).toContain("APPROX_QUANTILES(val, 10000 IGNORE NULLS)");
    expect(sql).not.toContain("val = 0");
  });
});

describe("BigQuery type mapping", () => {
  it("maps BYTES to binary fact table datatype", () => {
    expect(getFactTableTypeFromBigQueryType("BYTES")).toBe("binary");
  });
});

describe("BigQuery KLL quantile sketch methods", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});
  });

  it("reports quantile sketch support", () => {
    expect(integration.hasQuantileSketch()).toBe(true);
  });

  it("maps quantileSketch data type to BYTES", () => {
    expect(integration.getSqlDialect().getDataType("quantileSketch")).toBe(
      "BYTES",
    );
  });

  it("generates quantile sketch INIT with hardcoded precision 1000", () => {
    expect(integration.getSqlDialect().quantileSketchInit("m.value")).toBe(
      "KLL_QUANTILES.INIT_FLOAT64(m.value, 1000)",
    );
  });

  it("generates quantile sketch MERGE_PARTIAL", () => {
    expect(
      integration.getSqlDialect().quantileSketchMergePartial("sketch_col"),
    ).toBe("KLL_QUANTILES.MERGE_PARTIAL(sketch_col)");
  });

  it("generates quantile sketch EXTRACT_POINT", () => {
    expect(
      integration
        .getSqlDialect()
        .quantileSketchExtractPoint("sketch_col", 0.95),
    ).toBe("KLL_QUANTILES.EXTRACT_POINT_FLOAT64(sketch_col, 0.95)");
  });

  it("generates quantile sketch EXTRACT (quantile array)", () => {
    expect(
      integration
        .getSqlDialect()
        .quantileSketchExtractQuantiles("sketch_col", 100),
    ).toBe("KLL_QUANTILES.EXTRACT_FLOAT64(sketch_col, 100)");
  });

  it("generates rank approximation via CDF counting", () => {
    const sql = integration
      .getSqlDialect()
      .quantileSketchRankApprox("m.sketch", "qm.q_hat", "m.n_events", 100);
    // 100 quantiles → 101 points at levels {0, 1/100, ..., 1}.
    // count of points strictly below percentile p is ≈100p, so divide by 100
    // (not 101) for an unbiased estimate.
    expect(sql).toContain("KLL_QUANTILES.EXTRACT_FLOAT64(m.sketch, 100)");
    expect(sql).toContain("WHERE p < qm.q_hat");
    expect(sql).toContain("* m.n_events / 100.0");
    expect(sql).toContain("COALESCE(");
  });

  it("expands a quantile sketch into scalar grid columns when the dialect does not pack arrays", () => {
    // Quantile sketches are BigQuery-only and the BigQuery dialect packs the
    // grid into a single array, so exercise the scalar branch with a dialect
    // that opts out.
    const scalarDialect = {
      ...integration.getSqlDialect(),
      hasArrayQuantileGrid: () => false,
    };
    const grid = getQuantileSketchGridColumns(
      scalarDialect,
      { type: "event", quantile: 0.9, ignoreZeros: false },
      "m0_sketch",
      "m0_",
    );
    // Point estimate
    expect(grid).toContain(
      "KLL_QUANTILES.EXTRACT_POINT_FLOAT64(m0_sketch, 0.9) AS m0_quantile",
    );
    // One pair of lower/upper bounds per N_STAR value
    for (const nstar of N_STAR_VALUES) {
      expect(grid).toContain(`m0_quantile_lower_${nstar}`);
      expect(grid).toContain(`m0_quantile_upper_${nstar}`);
    }
    // All grid columns come from EXTRACT_POINT on the same sketch
    const extractCount = (
      grid.match(/KLL_QUANTILES\.EXTRACT_POINT_FLOAT64\(m0_sketch,/g) || []
    ).length;
    expect(extractCount).toBe(1 + N_STAR_VALUES.length * 2);
  });

  it("packs quantile sketch grid columns into a single array (BigQuery dialect)", () => {
    const grid = integration.getQuantileSketchGridColumns(
      { type: "event", quantile: 0.9, ignoreZeros: false },
      "m0_sketch",
      "m0_",
    );

    expect(grid).toContain(
      "KLL_QUANTILES.EXTRACT_POINT_FLOAT64(m0_sketch, 0.9) AS m0_quantile",
    );
    expect(grid).toContain("AS m0_quantile_grid");
    expect(grid).not.toMatch(/m0_quantile_lower_\d+/);
    expect(grid).not.toMatch(/m0_quantile_upper_\d+/);

    const extractCount = (
      grid.match(/KLL_QUANTILES\.EXTRACT_POINT_FLOAT64\(m0_sketch,/g) || []
    ).length;
    // 1 central point + 20 × 2 bounds, plus the first bound referenced once more
    // in the IF(... IS NULL) guard that collapses the grid to NULL when empty.
    expect(extractCount).toBe(1 + N_STAR_VALUES.length * 2 + 1);
  });

  it("returns kll intermediate data type for event quantile metrics", () => {
    const metric = factMetricFactory.build({
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: { factTableId: "ft1", column: "amount" },
    });
    const metadata = getAggregationMetadata(integration.getSqlDialect(), {
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("quantileSketch");
    expect(metadata.partialAggregationFunction("col")).toBe(
      "KLL_QUANTILES.INIT_FLOAT64(col, 1000)",
    );
    expect(metadata.reAggregationFunction("col")).toBe(
      "KLL_QUANTILES.MERGE_PARTIAL(col)",
    );
  });

  it("throws for quantile metrics without quantileSettings", () => {
    const metric = factMetricFactory.build({
      id: "fact_missing_quantile_settings",
      metricType: "quantile",
      quantileSettings: null,
      numerator: { factTableId: "ft1", column: "amount" },
    });

    expect(() =>
      getAggregationMetadata(integration.getSqlDialect(), {
        metric,
        useDenominator: false,
      }),
    ).toThrow(
      "Quantile metric 'fact_missing_quantile_settings' is missing quantileSettings.",
    );
  });
});

describe("BigQuery pre-built sketch column aggregations (hll merge / kll merge)", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});
  });

  it("merges pre-built HLL sketch columns (not INIT) for 'hll merge'", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: "ft1",
        column: "session_id_hll",
        aggregation: "hll merge",
      },
    });
    const metadata = getAggregationMetadata(integration.getSqlDialect(), {
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("hll");
    expect(metadata.finalDataType).toBe("integer");
    // Partial step must MERGE the existing sketch, never INIT a new one.
    const partial = metadata.partialAggregationFunction("col");
    expect(partial).toContain("HLL_COUNT.MERGE_PARTIAL(col)");
    expect(partial).not.toContain("HLL_COUNT.INIT");
    // Re-agg and full-agg both extract cardinality from a merged sketch.
    expect(metadata.reAggregationFunction("col")).toBe(
      "HLL_COUNT.EXTRACT(HLL_COUNT.MERGE_PARTIAL(col))",
    );
    expect(metadata.fullAggregationFunction("col")).toBe(
      "HLL_COUNT.EXTRACT(HLL_COUNT.MERGE_PARTIAL(col))",
    );
  });

  it("merges pre-built KLL sketch columns (not INIT) for event-quantile 'kll merge'", () => {
    const metric = factMetricFactory.build({
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: {
        factTableId: "ft1",
        column: "latency_ms_kll",
        aggregation: "kll merge",
      },
    });
    const metadata = getAggregationMetadata(integration.getSqlDialect(), {
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("quantileSketch");
    // Partial step must MERGE_PARTIAL the existing sketch, never INIT.
    expect(metadata.partialAggregationFunction("col")).toBe(
      "KLL_QUANTILES.MERGE_PARTIAL(col)",
    );
    expect(metadata.partialAggregationFunction("col")).not.toContain(
      "INIT_FLOAT64",
    );
    expect(metadata.reAggregationFunction("col")).toBe(
      "KLL_QUANTILES.MERGE_PARTIAL(col)",
    );
  });

  it("ignores 'kll merge' for non-event-quantile metrics (falls through to sum)", () => {
    // Guard: kll merge only applies when metricType=quantile && type=event.
    const metric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: "ft1",
        column: "latency_ms_kll",
        aggregation: "kll merge",
      },
    });
    const metadata = getAggregationMetadata(integration.getSqlDialect(), {
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("float");
  });
});

describe("BigQuery KLL incremental refresh SQL generation (E2E)", () => {
  let integration: BigQuery;

  const exposureQuery: ExposureQuery = {
    id: "exposure",
    name: "Exposure",
    description: "",
    query: "*",
    userIdType: "user_id",
    dimensions: [],
  };

  const resolvedExposureQuery = {
    query: exposureQuery.query,
    userIdType: exposureQuery.userIdType,
  };

  const factTable = factTableFactory.build({
    id: "ft_events",
    name: "Events",
    sql: "SELECT * FROM events",
    userIdTypes: ["user_id"],
  });

  const eventQuantileMetric = factMetricFactory.build({
    id: "fact_eq1",
    metricType: "quantile",
    quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
    numerator: {
      factTableId: "ft_events",
      column: "amount",
      aggregation: "sum",
    },
  });

  const factTableMap = new Map([["ft_events", factTable]]);

  const settings: ExperimentSnapshotSettings = {
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

  beforeEach(() => {
    // @ts-expect-error -- context not needed for this unit test; exposure list
    // satisfies getExposureQuery(settings.exposureQueryId === "exposure") without
    // jest.spyOn (non-configurable export under @swc/jest).
    integration = new BigQuery("", {
      settings: {
        queries: {
          exposure: [exposureQuery],
        },
      },
    });
  });

  it("getCreateMetricSourceTableQuery emits BYTES sketch + INT64 n_events columns", () => {
    const sql = integration.getCreateMetricSourceTableQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      factTableId: "ft_events",
      metrics: [eventQuantileMetric],
      factTableMap,
      metricSourceTableFullName: "proj.ds.metric_source",
    });
    // KLL sketch stored as BYTES
    expect(sql).toMatch(/_value\s+BYTES/);
    // Companion event-count column for cluster variance
    expect(sql).toMatch(/_n_events\s+INT64/);
  });

  it("getInsertMetricSourceDataQuery emits KLL INIT and COUNT for n_events", () => {
    const sql = integration.getInsertMetricSourceDataQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [eventQuantileMetric],
      lastMaxTimestamp: null,
    });
    // Partial aggregation builds the sketch
    expect(sql).toContain("KLL_QUANTILES.INIT_FLOAT64");
    // Companion count emitted alongside the sketch
    expect(sql).toMatch(/COUNT\([^)]+\)\s+AS\s+\w+_n_events/);
  });

  it("getInsertMetricSourceDataQuery emits KLL MERGE_PARTIAL (not INIT) for 'kll merge' columns", () => {
    const prebuiltSketchMetric = factMetricFactory.build({
      id: "fact_eq_sketch",
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: {
        factTableId: "ft_events",
        column: "latency_ms_kll",
        aggregation: "kll merge",
      },
    });
    const sql = integration.getInsertMetricSourceDataQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [prebuiltSketchMetric],
      lastMaxTimestamp: null,
    });
    // Partial aggregation merges the pre-built sketch; must not INIT.
    expect(sql).toContain("KLL_QUANTILES.MERGE_PARTIAL");
    expect(sql).not.toContain("KLL_QUANTILES.INIT_FLOAT64");
  });

  it("getInsertMetricSourceDataQuery sources n_events from paired '<col>_n_events' (not COUNT) for 'kll merge'", () => {
    const prebuiltSketchMetric = factMetricFactory.build({
      id: "fact_eq_sketch_paired",
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: {
        factTableId: "ft_events",
        column: "latency_ms_kll",
        aggregation: "kll merge",
      },
    });
    const sql = integration.getInsertMetricSourceDataQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [prebuiltSketchMetric],
      lastMaxTimestamp: null,
    });
    // The paired count column must be projected from the source fact table
    // and SUM-aggregated for n_events. COUNT(<col>_value) would be wrong:
    // each row is a pre-aggregated sketch covering many events.
    expect(sql).toContain("latency_ms_kll_n_events");
    expect(sql).toMatch(
      /SUM\(COALESCE\([^)]+_n_events,\s*0\)\)\s+AS\s+\w+_n_events/,
    );
    expect(sql).not.toMatch(/COUNT\([^)]+\)\s+AS\s+\w+_n_events/);
  });

  it("getInsertMetricSourceDataQuery honors quantileSettings.quantileEventCountColumn override", () => {
    // The override lets users name the paired count column anything (not
    // just `<sketch>_n_events`). SQL generation should source from the
    // override column verbatim.
    const overrideMetric = factMetricFactory.build({
      id: "fact_eq_sketch_override",
      metricType: "quantile",
      quantileSettings: {
        type: "event",
        quantile: 0.9,
        ignoreZeros: false,
        quantileEventCountColumn: "rollup_event_count",
      },
      numerator: {
        factTableId: "ft_events",
        column: "latency_ms_kll",
        aggregation: "kll merge",
      },
    });
    const sql = integration.getInsertMetricSourceDataQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [overrideMetric],
      lastMaxTimestamp: null,
    });
    // Override column is projected as the n_events source.
    expect(sql).toContain("rollup_event_count");
    // The default convention name must NOT appear when override is set.
    expect(sql).not.toContain("latency_ms_kll_n_events");
    expect(sql).toMatch(
      /SUM\(COALESCE\([^)]+_n_events,\s*0\)\)\s+AS\s+\w+_n_events/,
    );
  });

  it("getIncrementalRefreshStatisticsQuery emits two-pass KLL rank recovery CTEs", () => {
    const sql = integration.getIncrementalRefreshStatisticsQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      dimensionsForPrecomputation: [],
      dimensionsForAnalysis: [],
      factTableMap,
      metricSources: [
        { factTableId: "ft_events", tableFullName: "proj.ds.metric_source" },
      ],
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [eventQuantileMetric],
      lastMaxTimestamp: null,
    });

    // Pass 1: per-variation sketch merge
    expect(sql).toContain("__eventQuantileSketch");
    expect(sql).toContain("KLL_QUANTILES.MERGE_PARTIAL");

    // Grid extraction still computes 1 point estimate + 20 × 2 bounds, but the
    // bound grid is packed into one array column for BigQuery.
    expect(sql).toContain("__eventQuantileMetric");
    expect(sql).toContain("_quantile_grid");
    expect(sql).not.toMatch(/_quantile_lower_\d+/);
    expect(sql).not.toMatch(/_quantile_upper_\d+/);
    const extractPointCount = (
      sql.match(/KLL_QUANTILES\.EXTRACT_POINT_FLOAT64/g) || []
    ).length;
    // 1 central point + 20 × 2 bounds, plus the first bound referenced once more
    // in the IF(... IS NULL) guard that collapses the grid to NULL when empty.
    expect(extractPointCount).toBe(1 + N_STAR_VALUES.length * 2 + 1);

    // Pass 2: per-user rank recovery via CDF counting
    expect(sql).toContain("KLL_QUANTILES.EXTRACT_FLOAT64");
    expect(sql).toMatch(/LEFT JOIN\s+__eventQuantileMetric\s+qm/);

    // CTE ordering: sketch merge must precede grid extraction, which must
    // precede __joinedData (since __joinedData joins on the grid's q_hat)
    const sketchPos = sql.indexOf("__eventQuantileSketch");
    const gridPos = sql.indexOf("__eventQuantileMetric");
    const joinedPos = sql.indexOf("__joinedData");
    expect(sketchPos).toBeGreaterThan(0);
    expect(gridPos).toBeGreaterThan(sketchPos);
    expect(joinedPos).toBeGreaterThan(gridPos);
  });

  it("getExperimentFactMetricsQuery uses kll grid extraction and post-aggregation rank recovery for 'kll merge' event quantiles", () => {
    const prebuiltSketchMetric = factMetricFactory.build({
      id: "fact_eq_sketch_xp",
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: {
        factTableId: "ft_events",
        column: "latency_ms_kll",
        aggregation: "kll merge",
      },
    });
    const sql = integration.getExperimentFactMetricsQuery({
      settings,
      activationMetric: null,
      dimensions: [],
      segment: null,
      factTableMap,
      metrics: [prebuiltSketchMetric],
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(
        settings,
        resolvedExposureQuery,
      ),
    });

    // __eventQuantileMetric must extract the quantile grid from a merged
    // KLL sketch, not from raw values via APPROX_PERCENTILE.
    expect(sql).toContain("__eventQuantileMetric");
    // After format/indent, EXTRACT_POINT_FLOAT64(KLL_QUANTILES.MERGE_PARTIAL(...))
    // can split across lines AND the formatter inserts spaces between the
    // function name and its opening paren. Collapse whitespace and allow
    // optional spaces around parens before matching.
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toMatch(
      /KLL_QUANTILES\.EXTRACT_POINT_FLOAT64\s*\(\s*KLL_QUANTILES\.MERGE_PARTIAL/,
    );
    // The per-user aggregation lives in __userMetricAggBase; __userMetricAgg
    // is a thin wrapper that joins __userMetricAggBase against
    // __eventQuantileMetric to recover per-user "count below threshold" via
    // kllRankApprox. EXTRACT_FLOAT64 (the cdfArray construction) is the
    // tell-tale sign of kllRankApprox.
    expect(sql).toContain("__userMetricAggBase");
    expect(sql).toContain("KLL_QUANTILES.EXTRACT_FLOAT64");
    expect(sql).toContain("_quantile_grid");
    expect(sql).not.toMatch(/_quantile_lower_\d+/);
    expect(sql).not.toMatch(/_quantile_upper_\d+/);
    expect(flat).toMatch(
      /FROM\s+__userMetricAggBase\s+base\s+LEFT\s+JOIN\s+__eventQuantileMetric/i,
    );
    // n_events must come from the paired count column, not COUNT(rows).
    expect(flat).toMatch(
      /SUM\(COALESCE\([^)]+_n_events,\s*0\)\)\s+AS\s+\w+_n_events/,
    );
    // KLL is mergeable, so __userMetricJoin should be scanned exactly once:
    // __eventQuantileMetric reads merged per-user sketches from
    // __userMetricAggBase rather than re-scanning per-event sketches.
    const userMetricJoinFromCount = (
      flat.match(/FROM\s+__userMetricJoin\b/gi) || []
    ).length;
    expect(userMetricJoinFromCount).toBe(1);
  });

  it("getExperimentFactMetricsQuery falls back to APPROX_QUANTILES (no kll wrapper) for raw event quantiles", () => {
    const sql = integration.getExperimentFactMetricsQuery({
      settings,
      activationMetric: null,
      dimensions: [],
      segment: null,
      factTableMap,
      metrics: [eventQuantileMetric],
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(
        settings,
        resolvedExposureQuery,
      ),
    });

    // Raw event quantile uses APPROX_QUANTILES on the per-event values, no
    // KLL extraction or rank-recovery wrapper.
    expect(sql).toContain("APPROX_QUANTILES");
    expect(sql).toContain("_quantile_grid");
    expect(sql).not.toMatch(/_quantile_lower_\d+/);
    expect(sql).not.toMatch(/_quantile_upper_\d+/);
    expect(sql).not.toContain("KLL_QUANTILES.EXTRACT_FLOAT64");
    // No KLL merge metrics → the per-user aggregation goes directly into
    // __userMetricAgg without the __userMetricAggBase wrapper.
    expect(sql).not.toContain("__userMetricAggBase");
  });

  describe("cross-fact-table ratio metric SQL generation", () => {
    // A second fact table so we can exercise cross-FT ratio metrics whose
    // numerator and denominator live in different caches.
    const denominatorFactTable = factTableFactory.build({
      id: "ft_subscriptions",
      name: "Subscriptions",
      sql: "SELECT * FROM subscriptions",
      userIdTypes: ["user_id"],
    });

    const crossFtMetric = factMetricFactory.build({
      id: "fact_xft_ratio",
      metricType: "ratio",
      numerator: {
        factTableId: "ft_events",
        column: "amount",
        aggregation: "sum",
      },
      denominator: {
        factTableId: "ft_subscriptions",
        column: "tenure_days",
        aggregation: "sum",
      },
    });

    const crossFactTableMap = new Map([
      ["ft_events", factTable],
      ["ft_subscriptions", denominatorFactTable],
    ]);

    it("getCreateMetricSourceTableQuery emits only numerator columns for the numerator FT", () => {
      const sql = integration.getCreateMetricSourceTableQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        factTableId: "ft_events",
        metrics: [crossFtMetric],
        factTableMap: crossFactTableMap,
        metricSourceTableFullName: "proj.ds.metric_source_num",
      });
      // The numerator-side cache holds `_value` but no `_denominator_value`.
      // The role is derived from the metric's column refs vs factTableId.
      expect(sql).toMatch(/fact_xft_ratio_value\b/);
      expect(sql).not.toMatch(/fact_xft_ratio_denominator_value/);
    });

    it("getCreateMetricSourceTableQuery emits only denominator column for the denominator FT", () => {
      const sql = integration.getCreateMetricSourceTableQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        factTableId: "ft_subscriptions",
        metrics: [crossFtMetric],
        factTableMap: crossFactTableMap,
        metricSourceTableFullName: "proj.ds.metric_source_denom",
      });
      // The denominator-side cache holds `_denominator_value` only.
      expect(sql).toMatch(/fact_xft_ratio_denominator_value\b/);
      // The `_value` column does not appear on the denominator side.
      expect(sql).not.toMatch(/fact_xft_ratio_value\b/);
    });

    it("getInsertMetricSourceDataQuery for the numerator side reads from the numerator FT and projects only the numerator side", () => {
      const sql = integration.getInsertMetricSourceDataQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap: crossFactTableMap,
        factTableId: "ft_events",
        metricSourceTableFullName: "proj.ds.metric_source_num",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [crossFtMetric],
        lastMaxTimestamp: null,
      });
      // Only the numerator `_value` column appears in the SELECT projection.
      expect(sql).toMatch(/fact_xft_ratio_value\b/);
      expect(sql).not.toMatch(/fact_xft_ratio_denominator_value/);
    });

    it("getInsertMetricSourceDataQuery for the denominator side reads from the denominator FT and projects only the denominator side", () => {
      const sql = integration.getInsertMetricSourceDataQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap: crossFactTableMap,
        factTableId: "ft_subscriptions",
        metricSourceTableFullName: "proj.ds.metric_source_denom",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [crossFtMetric],
        lastMaxTimestamp: null,
      });
      // Only the denominator column appears in the SELECT projection.
      expect(sql).toMatch(/fact_xft_ratio_denominator_value\b/);
      expect(sql).not.toMatch(/fact_xft_ratio_value\b/);
    });

    it("getIncrementalRefreshStatisticsQuery joins both caches and aliases columns by source index", () => {
      const sql = integration.getIncrementalRefreshStatisticsQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: [],
        factTableMap: crossFactTableMap,
        metricSources: [
          {
            factTableId: "ft_events",
            tableFullName: "proj.ds.metric_source_num",
          },
          {
            factTableId: "ft_subscriptions",
            tableFullName: "proj.ds.metric_source_denom",
          },
        ],
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [crossFtMetric],
        lastMaxTimestamp: null,
      });
      // Both per-source CTEs are emitted with the expected naming.
      expect(sql).toContain("__metricSourceData ");
      expect(sql).toContain("__metricSourceData1");
      expect(sql).toContain("__metricDataAggregated ");
      expect(sql).toContain("__metricDataAggregated1");
      // Each source CTE reads from its own cache table. The formatter
      // breaks the `FROM` clause across lines, so allow whitespace
      // between `FROM` and the table identifier.
      expect(sql).toMatch(/FROM\s+proj\.ds\.metric_source_num\b/);
      expect(sql).toMatch(/FROM\s+proj\.ds\.metric_source_denom\b/);
      // The joined data CTE LEFT JOINs both aggregated caches.
      expect(sql).toMatch(/LEFT JOIN __metricDataAggregated\s+m\s+ON/);
      expect(sql).toMatch(/LEFT JOIN __metricDataAggregated1\s+m1\s+ON/);
      // The numerator and denominator pull from the correct alias.
      expect(sql).toMatch(/m\.fact_xft_ratio_value/);
      expect(sql).toMatch(/m1\.fact_xft_ratio_denominator_value/);
    });

    it("getIncrementalRefreshStatisticsQuery bundles A/B and B/A metrics into one query, with each side reading from the right cache", () => {
      // A/B (events / subscriptions) and B/A (subscriptions / events) are
      // valid in the same joined query: the SQL layer reads each metric's
      // numerator from the cache whose factTableId matches the metric's
      // numerator column ref, independent of which source happens to be
      // source 0 vs source 1. This test pins that contract.
      const aOverB = factMetricFactory.build({
        id: "fact_a_over_b",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_events",
          column: "amount",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_subscriptions",
          column: "tenure_days",
          aggregation: "sum",
        },
      });
      const bOverA = factMetricFactory.build({
        id: "fact_b_over_a",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_subscriptions",
          column: "tenure_days",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_events",
          column: "amount",
          aggregation: "sum",
        },
      });
      const sql = integration.getIncrementalRefreshStatisticsQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: [],
        factTableMap: crossFactTableMap,
        metricSources: [
          { factTableId: "ft_events", tableFullName: "proj.ds.cache_events" },
          {
            factTableId: "ft_subscriptions",
            tableFullName: "proj.ds.cache_subs",
          },
        ],
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [aOverB, bOverA],
        lastMaxTimestamp: null,
      });

      // Only two source CTEs are emitted (single joined query). No
      // __metricSourceData2 etc.
      expect(sql).toContain("__metricSourceData ");
      expect(sql).toContain("__metricSourceData1");
      expect(sql).not.toContain("__metricSourceData2");

      // Source 0 is the events cache (first fact-table encountered while
      // walking [aOverB, bOverA]). All projections for events-side columns
      // route through `m`; subscriptions-side columns route through `m1`.
      expect(sql).toMatch(/FROM\s+proj\.ds\.cache_events\b/);
      expect(sql).toMatch(/FROM\s+proj\.ds\.cache_subs\b/);

      // A/B: numerator = events, denominator = subscriptions
      expect(sql).toMatch(/m\.fact_a_over_b_value/);
      expect(sql).toMatch(/m1\.fact_a_over_b_denominator_value/);
      // B/A: numerator = subscriptions, denominator = events — sides swap
      // alias to match each metric's own orientation.
      expect(sql).toMatch(/m1\.fact_b_over_a_value/);
      expect(sql).toMatch(/m\.fact_b_over_a_denominator_value/);
    });

    it("getCreateMetricSourceCovariateTableQuery + getInsertMetricSourceCovariateDataQuery split a cross-FT ratio metric's covariate across both FTs", () => {
      const raCrossFt = factMetricFactory.build({
        id: "fact_ra_xft",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_events",
          column: "amount",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_subscriptions",
          column: "tenure_days",
          aggregation: "sum",
        },
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
      });

      // Numerator FT's covariate schema/insert holds only `_value`.
      const numCreate = integration.getCreateMetricSourceCovariateTableQuery({
        settings: { ...settings, regressionAdjustmentEnabled: true },
        exposureQuery: resolvedExposureQuery,
        factTableId: "ft_events",
        metrics: [raCrossFt],
        metricSourceCovariateTableFullName: "proj.ds.cov_events",
      });
      expect(numCreate).toMatch(/fact_ra_xft_value\b/);
      expect(numCreate).not.toMatch(/fact_ra_xft_denominator_value/);

      const numInsert = integration.getInsertMetricSourceCovariateDataQuery({
        settings: { ...settings, regressionAdjustmentEnabled: true },
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap: crossFactTableMap,
        factTableId: "ft_events",
        metricSourceCovariateTableFullName: "proj.ds.cov_events",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [raCrossFt],
        lastCovariateSuccessfulMaxTimestamp: null,
      });
      expect(numInsert).toMatch(/fact_ra_xft_value\b/);
      expect(numInsert).not.toMatch(/fact_ra_xft_denominator_value/);

      // Denominator FT's covariate schema/insert holds only `_denominator_value`.
      const denomCreate = integration.getCreateMetricSourceCovariateTableQuery({
        settings: { ...settings, regressionAdjustmentEnabled: true },
        exposureQuery: resolvedExposureQuery,
        factTableId: "ft_subscriptions",
        metrics: [raCrossFt],
        metricSourceCovariateTableFullName: "proj.ds.cov_subs",
      });
      expect(denomCreate).toMatch(/fact_ra_xft_denominator_value\b/);
      expect(denomCreate).not.toMatch(/fact_ra_xft_value[^_]/);

      const denomInsert = integration.getInsertMetricSourceCovariateDataQuery({
        settings: { ...settings, regressionAdjustmentEnabled: true },
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap: crossFactTableMap,
        factTableId: "ft_subscriptions",
        metricSourceCovariateTableFullName: "proj.ds.cov_subs",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [raCrossFt],
        lastCovariateSuccessfulMaxTimestamp: null,
      });
      expect(denomInsert).toMatch(/fact_ra_xft_denominator_value\b/);
      expect(denomInsert).not.toMatch(/fact_ra_xft_value[^_]/);

      // The covariate insert reads from a single CTE aliased `c` —
      // multi-source aliases like `c1.` would be invalid SQL here. This
      // matters because `getFactTablesForMetrics` discovers BOTH FTs of a
      // cross-FT ratio metric (so denominatorSourceIndex becomes 1 in this
      // call), and the stats-query alias scheme `c{idx}` would leak through
      // if we naively reused `m.capCoalesceCovariate`.
      expect(denomInsert).not.toMatch(/\bc[0-9]+\./);
      // The `__newCovariateValues` CTE columns are keyed by the metric-data
      // alias (`m{index}`), and the final SELECT projects through `c.`.
      expect(denomInsert).toMatch(/\bc\.m\d+_covariate_denominator\b/);
    });

    it("getIncrementalRefreshStatisticsQuery joins each side's covariate cache into its own __joinedData{i} for cross-FT CUPED", () => {
      const raCrossFt = factMetricFactory.build({
        id: "fact_ra_xft",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_events",
          column: "amount",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_subscriptions",
          column: "tenure_days",
          aggregation: "sum",
        },
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
      });

      const sql = integration.getIncrementalRefreshStatisticsQuery({
        settings: { ...settings, regressionAdjustmentEnabled: true },
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: [],
        factTableMap: crossFactTableMap,
        // Both pipelines have covariate caches; numerator covariate
        // lives in events, denominator covariate lives in subscriptions.
        metricSources: [
          {
            factTableId: "ft_events",
            tableFullName: "proj.ds.metric_source_num",
            covariateTableFullName: "proj.ds.cov_events",
          },
          {
            factTableId: "ft_subscriptions",
            tableFullName: "proj.ds.metric_source_denom",
            covariateTableFullName: "proj.ds.cov_subs",
          },
        ],
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [raCrossFt],
        lastMaxTimestamp: null,
      });

      // Both covariate caches are joined — one per source's __joinedData{i}.
      expect(sql).toMatch(/FROM\s+proj\.ds\.cov_events\b/);
      expect(sql).toMatch(/FROM\s+proj\.ds\.cov_subs\b/);

      // The numerator covariate column comes from source 0 (events) via `m`,
      // the denominator covariate column comes from source 1 (subscriptions)
      // via `m1` — same alias contract as the non-CUPED cross-FT path.
      // The metric-data layer aliases each metric to `m{index}` (here `m0`)
      // and the CTE column names are `<alias>_covariate_value` and
      // `<alias>_covariate_denominator`.
      expect(sql).toMatch(/m\.m0_covariate_value/);
      expect(sql).toMatch(/m1\.m0_covariate_denominator/);
    });

    it("mixed same-FT + cross-FT RA metrics: per-FT stats only reads same-FT covariates; cross-FT stats reads both caches", () => {
      // Two RA metrics on the same fact table — one same-FT, one cross-FT.
      // This is the realistic shape that exercises the gap between unit
      // tests (single metric in isolation) and the runner orchestration:
      // the per-FT stats query must read ONLY the same-FT metric's
      // covariate column, and the cross-FT pair stats query must read
      // BOTH caches' covariates with the right alias contract.
      const sameFtRa = factMetricFactory.build({
        id: "fact_ra_same_ft",
        metricType: "mean",
        numerator: {
          factTableId: "ft_events",
          column: "amount",
          aggregation: "sum",
        },
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
      });
      const crossFtRa = factMetricFactory.build({
        id: "fact_ra_xft",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_events",
          column: "amount",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_subscriptions",
          column: "tenure_days",
          aggregation: "sum",
        },
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
      });

      // Per-FT stats on ft_events: same-FT metric only. Reads the
      // ft_events covariate cache; must NOT reference the ft_subscriptions
      // covariate cache.
      const perFtSql = integration.getIncrementalRefreshStatisticsQuery({
        settings: { ...settings, regressionAdjustmentEnabled: true },
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: [],
        factTableMap: crossFactTableMap,
        metricSources: [
          {
            factTableId: "ft_events",
            tableFullName: "proj.ds.metric_source_events",
            covariateTableFullName: "proj.ds.cov_events",
          },
        ],
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [sameFtRa],
        lastMaxTimestamp: null,
      });
      expect(perFtSql).toMatch(/FROM\s+proj\.ds\.metric_source_events\b/);
      expect(perFtSql).toMatch(/FROM\s+proj\.ds\.cov_events\b/);
      expect(perFtSql).not.toMatch(/proj\.ds\.cov_subs/);
      expect(perFtSql).not.toMatch(/proj\.ds\.metric_source_denom/);
      // The same-FT metric's covariate value column is read through the
      // single source's alias `m`.
      expect(perFtSql).toMatch(/m\.m0_covariate_value/);

      // Cross-FT pair stats: BOTH metrics' caches are joined. The
      // cross-FT metric drives the two-source layout — the same-FT
      // metric is computed in the per-FT pass above and is not part of
      // this query.
      const crossSql = integration.getIncrementalRefreshStatisticsQuery({
        settings: { ...settings, regressionAdjustmentEnabled: true },
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: [],
        factTableMap: crossFactTableMap,
        metricSources: [
          {
            factTableId: "ft_events",
            tableFullName: "proj.ds.metric_source_events",
            covariateTableFullName: "proj.ds.cov_events",
          },
          {
            factTableId: "ft_subscriptions",
            tableFullName: "proj.ds.metric_source_denom",
            covariateTableFullName: "proj.ds.cov_subs",
          },
        ],
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [crossFtRa],
        lastMaxTimestamp: null,
      });
      expect(crossSql).toMatch(/FROM\s+proj\.ds\.metric_source_events\b/);
      expect(crossSql).toMatch(/FROM\s+proj\.ds\.metric_source_denom\b/);
      expect(crossSql).toMatch(/FROM\s+proj\.ds\.cov_events\b/);
      expect(crossSql).toMatch(/FROM\s+proj\.ds\.cov_subs\b/);
      // Numerator covariate via `m`, denominator covariate via `m1`.
      expect(crossSql).toMatch(/m\.m0_covariate_value/);
      expect(crossSql).toMatch(/m1\.m0_covariate_denominator/);
    });

    it("getIncrementalRefreshStatisticsQuery throws when a cross-FT RA metric is missing its side's covariate cache", () => {
      const raCrossFt = factMetricFactory.build({
        id: "fact_ra_xft",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_events",
          column: "amount",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_subscriptions",
          column: "tenure_days",
          aggregation: "sum",
        },
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
      });

      expect(() =>
        integration.getIncrementalRefreshStatisticsQuery({
          settings: { ...settings, regressionAdjustmentEnabled: true },
          exposureQuery: resolvedExposureQuery,
          activationMetric: null,
          dimensionsForPrecomputation: [],
          dimensionsForAnalysis: [],
          factTableMap: crossFactTableMap,
          // Only the numerator FT got a covariate cache. The denominator
          // side has nowhere to read `_covariate_denominator` from, which
          // would silently emit invalid SQL — so we fail loudly instead.
          metricSources: [
            {
              factTableId: "ft_events",
              tableFullName: "proj.ds.metric_source_num",
              covariateTableFullName: "proj.ds.cov_events",
            },
            {
              factTableId: "ft_subscriptions",
              tableFullName: "proj.ds.metric_source_denom",
            },
          ],
          unitsSourceTableFullName: "proj.ds.units",
          metrics: [raCrossFt],
          lastMaxTimestamp: null,
        }),
      ).toThrow(/ft_subscriptions/);
    });

    it("per-FT insert + covariate insert handle a 3-FT hub where one FT participates in two cross-FT ratios", () => {
      // Hub pipeline: two cross-FT ratios share ft_events as their
      // numerator side, with denominators on two different FTs. The
      // ft_events group ends up holding both metrics, so its data/covariate
      // inserts see metrics that collectively reference 3 FTs. Without
      // scoping FT discovery to the target FT, this would blow up on the
      // 2-FT cap inside `getFactTablesForMetrics`.
      const paymentsFactTable = factTableFactory.build({
        id: "ft_payments",
        name: "Payments",
        sql: "SELECT * FROM payments",
        userIdTypes: ["user_id"],
      });

      const hubFactTableMap = new Map([
        ["ft_events", factTable],
        ["ft_subscriptions", denominatorFactTable],
        ["ft_payments", paymentsFactTable],
      ]);

      const ratioAB = factMetricFactory.build({
        id: "fact_ratio_a_b",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_events",
          column: "conversions",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_subscriptions",
          column: "tenure_days",
          aggregation: "sum",
        },
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
      });
      const ratioAC = factMetricFactory.build({
        id: "fact_ratio_a_c",
        metricType: "ratio",
        numerator: {
          factTableId: "ft_events",
          column: "clicks",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "ft_payments",
          column: "amount",
          aggregation: "sum",
        },
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
      });

      // FT_events hub: data insert sees both metrics. Should NOT throw,
      // and should project both metrics' numerator columns (since A is the
      // numerator side for both) and no denominator columns (B and C are
      // populated by their own per-FT calls).
      const hubInsertSql = integration.getInsertMetricSourceDataQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap: hubFactTableMap,
        factTableId: "ft_events",
        metricSourceTableFullName: "proj.ds.metric_source_events",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [ratioAB, ratioAC],
        lastMaxTimestamp: null,
      });
      expect(hubInsertSql).toMatch(/fact_ratio_a_b_value\b/);
      expect(hubInsertSql).toMatch(/fact_ratio_a_c_value\b/);
      // Denominator columns live in the OTHER FTs' caches — should not
      // appear here.
      expect(hubInsertSql).not.toMatch(/fact_ratio_a_b_denominator_value/);
      expect(hubInsertSql).not.toMatch(/fact_ratio_a_c_denominator_value/);

      // FT_events hub: covariate insert (CUPED) sees both metrics. Same
      // rule — only numerator-side covariate columns appear in the hub's
      // covariate cache.
      const hubCovariateSql =
        integration.getInsertMetricSourceCovariateDataQuery({
          settings: { ...settings, regressionAdjustmentEnabled: true },
          exposureQuery: resolvedExposureQuery,
          activationMetric: null,
          factTableMap: hubFactTableMap,
          factTableId: "ft_events",
          metricSourceCovariateTableFullName: "proj.ds.cov_events",
          unitsSourceTableFullName: "proj.ds.units",
          metrics: [ratioAB, ratioAC],
          lastCovariateSuccessfulMaxTimestamp: null,
        });
      expect(hubCovariateSql).toMatch(/fact_ratio_a_b_value\b/);
      expect(hubCovariateSql).toMatch(/fact_ratio_a_c_value\b/);
      expect(hubCovariateSql).not.toMatch(/fact_ratio_a_b_denominator_value/);
      expect(hubCovariateSql).not.toMatch(/fact_ratio_a_c_denominator_value/);

      // Sanity check: the OTHER FT inserts (B and C) also work — each
      // sees its own denominator side only. (Both calls receive the full
      // [ratioAB, ratioAC] metric list because the runner doesn't know
      // ahead of time which FT each metric is "for"; FT scoping is the
      // SQL layer's job now.)
      const subsInsertSql = integration.getInsertMetricSourceDataQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap: hubFactTableMap,
        factTableId: "ft_subscriptions",
        metricSourceTableFullName: "proj.ds.metric_source_subs",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [ratioAB, ratioAC],
        lastMaxTimestamp: null,
      });
      // FT_subscriptions hosts the denominator of ratioAB only.
      expect(subsInsertSql).toMatch(/fact_ratio_a_b_denominator_value\b/);
      expect(subsInsertSql).not.toMatch(/fact_ratio_a_c/);
      // No numerator columns for either metric land on the FT_subs cache.
      expect(subsInsertSql).not.toMatch(/fact_ratio_a_b_value[^_]/);
    });
  });

  it("getExperimentFactMetricsQuery packs the unit-quantile n_star grid into a single ARRAY column", () => {
    // Unit quantiles previously emitted 1 + N_STAR_VALUES.length*2 = 41 scalar
    // columns per metric, which capped chunkMetrics at ~18 metrics/query and
    // caused the BQ job fan-out reported by customers. The array packing keeps
    // the same statistical content (same percentile values, same selection in
    // getQuantileBoundsFromQueryResponse) but emits 2 columns per metric, so
    // many more quantile metrics fit per query.
    const unitQuantileMetric = factMetricFactory.build({
      id: "fact_uq1",
      metricType: "quantile",
      quantileSettings: { type: "unit", quantile: 0.9, ignoreZeros: false },
      numerator: {
        factTableId: "ft_events",
        column: "amount",
        aggregation: "sum",
      },
    });
    const sql = integration.getExperimentFactMetricsQuery({
      settings,
      activationMetric: null,
      dimensions: [],
      segment: null,
      factTableMap,
      metrics: [unitQuantileMetric],
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(
        settings,
        resolvedExposureQuery,
      ),
    });

    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toMatch(/AS\s+m0_quantile_grid/);
    // The legacy per-nstar scalar columns must not appear when the grid is
    // packed into an array.
    expect(sql).not.toMatch(/m0_quantile_lower_\d+/);
    expect(sql).not.toMatch(/m0_quantile_upper_\d+/);
    // Central quantile and quantile_n are still required by the read-side
    // selection logic.
    expect(sql).toContain("m0_quantile");
    expect(sql).toContain("m0_quantile_n");
  });
});
