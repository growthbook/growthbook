import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import BigQuery from "back-end/src/integrations/BigQuery";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
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

  it("reports KLL support", () => {
    expect(integration.hasQuantileKLL()).toBe(true);
  });

  it("maps kll data type to BYTES", () => {
    expect(integration.getSqlDialect().getDataType("kll")).toBe("BYTES");
  });

  it("generates KLL INIT with hardcoded precision 1000", () => {
    expect(integration.getSqlDialect().kllInit("m.value")).toBe(
      "KLL_QUANTILES.INIT_FLOAT64(m.value, 1000)",
    );
  });

  it("generates KLL MERGE_PARTIAL", () => {
    expect(integration.getSqlDialect().kllMergePartial("sketch_col")).toBe(
      "KLL_QUANTILES.MERGE_PARTIAL(sketch_col)",
    );
  });

  it("generates KLL EXTRACT_POINT", () => {
    expect(
      integration.getSqlDialect().kllExtractPoint("sketch_col", 0.95),
    ).toBe("KLL_QUANTILES.EXTRACT_POINT_FLOAT64(sketch_col, 0.95)");
  });

  it("generates KLL EXTRACT (quantile array)", () => {
    expect(
      integration.getSqlDialect().kllExtractQuantiles("sketch_col", 100),
    ).toBe("KLL_QUANTILES.EXTRACT_FLOAT64(sketch_col, 100)");
  });

  it("generates rank approximation via CDF counting", () => {
    const sql = integration
      .getSqlDialect()
      .kllRankApprox("m.sketch", "qm.q_hat", "m.n_events", 100);
    // 100 quantiles → 101 points at levels {0, 1/100, ..., 1}.
    // count of points strictly below percentile p is ≈100p, so divide by 100
    // (not 101) for an unbiased estimate.
    expect(sql).toContain("KLL_QUANTILES.EXTRACT_FLOAT64(m.sketch, 100)");
    expect(sql).toContain("WHERE p < qm.q_hat");
    expect(sql).toContain("* m.n_events / 100.0");
    expect(sql).toContain("COALESCE(");
  });

  it("generates quantile grid columns from a KLL sketch", () => {
    const grid = integration.getKllQuantileGridColumns(
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
    expect(metadata.intermediateDataType).toBe("kll");
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
    expect(metadata.intermediateDataType).toBe("kll");
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
      activationMetric: null,
      factTableMap,
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
      activationMetric: null,
      factTableMap,
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
      activationMetric: null,
      factTableMap,
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
      activationMetric: null,
      factTableMap,
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
      activationMetric: null,
      dimensionsForPrecomputation: [],
      dimensionsForAnalysis: [],
      factTableMap,
      metricSourceTableFullName: "proj.ds.metric_source",
      metricSourceCovariateTableFullName: null,
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [eventQuantileMetric],
      lastMaxTimestamp: null,
    });

    // Pass 1: per-variation sketch merge
    expect(sql).toContain("__eventQuantileSketch");
    expect(sql).toContain("KLL_QUANTILES.MERGE_PARTIAL");

    // Grid extraction: 1 point estimate + 20 × 2 bounds = 41 EXTRACT_POINT calls
    expect(sql).toContain("__eventQuantileMetric");
    const extractPointCount = (
      sql.match(/KLL_QUANTILES\.EXTRACT_POINT_FLOAT64/g) || []
    ).length;
    expect(extractPointCount).toBe(1 + N_STAR_VALUES.length * 2);

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
    });

    // Raw event quantile uses APPROX_QUANTILES on the per-event values, no
    // KLL extraction or rank-recovery wrapper.
    expect(sql).toContain("APPROX_QUANTILES");
    expect(sql).not.toContain("KLL_QUANTILES.EXTRACT_FLOAT64");
    // No KLL merge metrics → the per-user aggregation goes directly into
    // __userMetricAgg without the __userMetricAggBase wrapper.
    expect(sql).not.toContain("__userMetricAggBase");
  });
});
