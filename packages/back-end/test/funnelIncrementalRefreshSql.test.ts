import { ExposureQuery } from "shared/types/datasource";
import {
  FunnelFactMetricInterface,
  MetricFunnelStep,
} from "shared/types/fact-table";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import BigQuery from "back-end/src/integrations/BigQuery";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

const exposureQuery: ExposureQuery = {
  id: "user_id",
  name: "Exposure",
  description: "Exposure",
  query: "SELECT user_id, timestamp, variation_id FROM events",
  userIdType: "user_id",
  dimensions: [],
};

const resolvedExposureQuery = {
  query: exposureQuery.query,
  userIdType: exposureQuery.userIdType,
};

const eventsFactTable = factTableFactory.build({
  id: "events",
  name: "Events",
  sql: "SELECT user_id, timestamp, event_name, amount FROM events",
  userIdTypes: ["user_id"],
  columns: [
    {
      column: "event_name",
      datatype: "string",
      name: "Event Name",
      description: "",
      numberFormat: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      deleted: false,
    },
  ],
});

const factTableMap = new Map([[eventsFactTable.id, eventsFactTable]]);

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
  exposureQueryId: "user_id",
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
  variations: [],
};

function buildStep(
  name: string,
  overrides: Partial<MetricFunnelStep> = {},
): MetricFunnelStep {
  return {
    name,
    factTableId: "events",
    rowFilters: [
      { column: "event_name", operator: "=" as const, values: [name] },
    ],
    optional: false,
    conversionWindow: null,
    ...overrides,
  };
}

function buildFunnelMetric({
  id = "fact__funnel",
  steps,
  concurrencyWindowSeconds = 0,
}: {
  id?: string;
  steps: MetricFunnelStep[];
  concurrencyWindowSeconds?: number;
}): FunnelFactMetricInterface {
  return {
    ...factMetricFactory.build({ id }),
    id,
    name: "Checkout Funnel",
    metricType: "funnel",
    numerator: null,
    funnelSettings: { steps, concurrencyWindowSeconds },
  };
}

let integration: BigQuery;
beforeEach(() => {
  // @ts-expect-error -- context not needed; exposure list satisfies
  // getExposureQuery(settings.exposureQueryId) without jest.spyOn.
  integration = new BigQuery("", {
    type: "bigquery",
    settings: { queries: { exposure: [exposureQuery] } },
  });
});

// Step 0 has no conversion window (stored as a scalar resolved-ts, merged with
// MIN); step 1 has a 2h window (stored as an array, merged with concat).
const scalarStep0Funnel = buildFunnelMetric({
  steps: [
    buildStep("view"),
    buildStep("purchase", { conversionWindow: { unit: "hours", value: 2 } }),
  ],
  concurrencyWindowSeconds: 300,
});

// Step 0 has a 6h exposure-relative window, so every step is an array.
const windowedStep0Funnel = buildFunnelMetric({
  id: "fact__funnel_w",
  steps: [
    buildStep("view", { conversionWindow: { unit: "hours", value: 6 } }),
    buildStep("purchase", { conversionWindow: { unit: "days", value: 1 } }),
  ],
});

function insertSql(metrics: FunnelFactMetricInterface[]): string {
  return integration.getInsertMetricSourceDataQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    activationMetric: null,
    factTableMap,
    factTableId: "events",
    metricSourceTableFullName: "proj.ds.metric_source",
    unitsSourceTableFullName: "proj.ds.units",
    metrics,
    lastMaxTimestamp: null,
  });
}

function readSql(metrics: FunnelFactMetricInterface[]): string {
  return integration.getIncrementalRefreshStatisticsQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    activationMetric: null,
    dimensionsForPrecomputation: [],
    dimensionsForAnalysis: [],
    factTableMap,
    metricSources: [
      { factTableId: "events", tableFullName: "proj.ds.metric_source" },
    ],
    unitsSourceTableFullName: "proj.ds.units",
    metrics,
    lastMaxTimestamp: null,
  });
}

function inlineSql(metrics: FunnelFactMetricInterface[]): string {
  return getExperimentFactMetricsQuery(
    bigQueryDialect,
    { ...integration.datasource, type: "bigquery" },
    {
      settings,
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(settings, {
        query: exposureQuery.query,
        userIdType: exposureQuery.userIdType,
      }),
      activationMetric: null,
      dimensions: [],
      segment: null,
      metrics,
      factTableMap,
    },
  );
}

describe("funnel incremental refresh — cache schema", () => {
  it("emits a scalar resolved-ts column for a windowless step 0 and an array column for later steps", () => {
    const sql = integration.getCreateMetricSourceTableQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      factTableId: "events",
      metrics: [scalarStep0Funnel],
      factTableMap,
      metricSourceTableFullName: "proj.ds.metric_source",
    });
    // Step 0 (no window) → decomposable scalar MIN column. BigQuery event
    // timestamps are DATETIME (castUserDateCol), so the column is DATETIME.
    expect(sql).toMatch(/_step_0_resolved_ts\s+DATETIME/);
    // Step 1 (windowed) → array of candidate event timestamps.
    expect(sql).toMatch(/_step_1_arr\s+ARRAY<DATETIME>/);
    // A windowless step 0 must NOT also emit an array column.
    expect(sql).not.toMatch(/_step_0_arr/);
  });

  it("still stores a scalar step 0 even when step 0 has an exposure window", () => {
    const sql = integration.getCreateMetricSourceTableQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      factTableId: "events",
      metrics: [windowedStep0Funnel],
      factTableMap,
      metricSourceTableFullName: "proj.ds.metric_source",
    });
    // Step 0 anchors on exposure (known at write), so it's resolved to a scalar
    // regardless of window; only later steps are arrays.
    expect(sql).toMatch(/_step_0_resolved_ts\s+DATETIME/);
    expect(sql).not.toMatch(/_step_0_arr/);
    expect(sql).toMatch(/_step_1_arr\s+ARRAY<DATETIME>/);
  });
});

describe("funnel incremental refresh — write (per-day partials)", () => {
  it("gates each step's timestamp on that step's row filters", () => {
    const sql = insertSql([scalarStep0Funnel]);
    expect(sql).toContain("(event_name = 'view')");
    expect(sql).toContain("(event_name = 'purchase')");
  });

  it("aggregates step 0 (no window) with MIN and later steps with a sorted array", () => {
    const sql = insertSql([scalarStep0Funnel]);
    // Step 0: decomposable MIN into the resolved-ts column.
    expect(sql).toMatch(
      /MIN\([^)]*_step_0_ts\s*\)\s+AS\s+\w+_step_0_resolved_ts/,
    );
    // Step 1: sorted array (BigQuery ARRAY_AGG ... IGNORE NULLS ORDER BY).
    expect(sql).toMatch(/ARRAY_AGG\([^)]*_step_1_ts\s+IGNORE NULLS/i);
    expect(sql).toMatch(/AS\s+\w+_step_1_arr/);
  });

  it("does not project a scalar _value column for a funnel", () => {
    // The funnel branch early-returns before the numeratorAggFns path; a
    // stray _value output column would be an unresolvable reference.
    expect(insertSql([scalarStep0Funnel])).not.toMatch(/AS\s+\w+_value\b/);
  });

  it("applies step 0's own conversion window at write when it has one", () => {
    const sql = insertSql([windowedStep0Funnel]);
    // Step 0's 6h window (21600s) is applied against exposure in the row CASE,
    // then MIN resolves it — no step-0 array is stored.
    expect(sql).toContain("21600");
    expect(sql).toMatch(
      /MIN\([^)]*_step_0_ts\s*\)\s+AS\s+\w+_step_0_resolved_ts/,
    );
    expect(sql).not.toMatch(/AS\s+\w+_step_0_arr/);
  });
});

describe("funnel incremental refresh — read (merge + resolve)", () => {
  it("merges cached per-day columns across days (MIN for scalar step 0, concat for arrays)", () => {
    const sql = readSql([scalarStep0Funnel]);
    // Scalar step 0 merged with MIN across days.
    expect(sql).toMatch(
      /MIN\([^)]*_step_0_resolved_ts\s*\)\s+AS\s+m0_step_0_resolved_ts/,
    );
    // Array step merged with the new ARRAY_CONCAT_AGG primitive.
    expect(sql).toMatch(
      /ARRAY_CONCAT_AGG\([^)]*_step_1_arr\s*\)\s+AS\s+m0_step_1_arr/i,
    );
  });

  it("runs the shared resolution chain over the merged arrays and carries exposure through", () => {
    const sql = readSql([scalarStep0Funnel]);
    // Private pre-resolution CTE + the incremental resolver takes over __joinedData.
    expect(sql).toContain("__joinedDataSteps");
    expect(sql).toContain("__funnelResolveInc");
    // Exposure timestamp is carried onto the funnel source for step windowing.
    expect(sql).toContain("first_exposure_timestamp");
  });

  it("emits one sum per step and no main_sum / _value", () => {
    const sql = readSql([scalarStep0Funnel]);
    expect(sql).toContain("m0_step_0_sum");
    expect(sql).toContain("m0_step_1_sum");
    expect(sql).not.toContain("m0_step_2_sum");
    expect(sql).not.toContain("m0_main_sum");
    expect(sql).not.toContain("m0_value");
  });

  it("merges a windowed step 0 as a pre-resolved scalar (no step-0 resolve CTE)", () => {
    const sql = readSql([windowedStep0Funnel]);
    // Step 0 is resolved to a scalar at write (window applied there), so the
    // read merges it with MIN and the resolver never resolves step 0.
    expect(sql).not.toContain("__funnelResolveInc_0");
    expect(sql).toMatch(
      /MIN\([^)]*_step_0_resolved_ts\s*\)\s+AS\s+m0_step_0_resolved_ts/,
    );
    expect(sql).not.toMatch(/ARRAY_CONCAT_AGG\([^)]*_step_0_arr\)/);
  });
});

// --- Multifact funnel setup (steps across two different fact tables) ---
const ordersFactTable = factTableFactory.build({
  id: "orders",
  name: "Orders",
  sql: "SELECT user_id, timestamp, order_id, status FROM orders",
  userIdTypes: ["user_id"],
  columns: [
    {
      column: "status",
      datatype: "string",
      name: "Status",
      description: "",
      numberFormat: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      deleted: false,
    },
  ],
});

const multiFtFactTableMap = new Map([
  [eventsFactTable.id, eventsFactTable],
  [ordersFactTable.id, ordersFactTable],
]);

const multiFtFunnel = buildFunnelMetric({
  id: "fact__mf_funnel",
  steps: [
    buildStep("view"), // step 0 in "events"
    {
      name: "order",
      factTableId: "orders",
      rowFilters: [
        { column: "status", operator: "=" as const, values: ["completed"] },
      ],
      optional: false,
      conversionWindow: { unit: "hours" as const, value: 24 },
    }, // step 1 in "orders"
  ],
  concurrencyWindowSeconds: 600,
});

function multiFtSchemaSql(factTableId: string): string {
  return integration.getCreateMetricSourceTableQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    factTableId,
    metrics: [multiFtFunnel],
    factTableMap: multiFtFactTableMap,
    metricSourceTableFullName: `proj.ds.metric_source_${factTableId}`,
  });
}

function multiFtInsertSql(factTableId: string): string {
  return integration.getInsertMetricSourceDataQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    activationMetric: null,
    factTableMap: multiFtFactTableMap,
    factTableId,
    metricSourceTableFullName: `proj.ds.metric_source_${factTableId}`,
    unitsSourceTableFullName: "proj.ds.units",
    metrics: [multiFtFunnel],
    lastMaxTimestamp: null,
  });
}

function multiFtReadSql(): string {
  return integration.getIncrementalRefreshStatisticsQuery({
    settings,
    exposureQuery: resolvedExposureQuery,
    activationMetric: null,
    dimensionsForPrecomputation: [],
    dimensionsForAnalysis: [],
    factTableMap: multiFtFactTableMap,
    metricSources: [
      { factTableId: "events", tableFullName: "proj.ds.metric_source_events" },
      { factTableId: "orders", tableFullName: "proj.ds.metric_source_orders" },
    ],
    unitsSourceTableFullName: "proj.ds.units",
    metrics: [multiFtFunnel],
    lastMaxTimestamp: null,
  });
}

describe("multifact funnel incremental refresh — cache schema", () => {
  it("emits step 0 columns in the events table and step 1 columns in the orders table", () => {
    const eventsSql = multiFtSchemaSql("events");
    const ordersSql = multiFtSchemaSql("orders");

    // Events table: step 0 (scalar resolved-ts), no step 1
    expect(eventsSql).toMatch(/_step_0_resolved_ts\s+DATETIME/);
    expect(eventsSql).not.toMatch(/_step_1_arr/);

    // Orders table: step 1 (array), no step 0
    expect(ordersSql).toMatch(/_step_1_arr\s+ARRAY<DATETIME>/);
    expect(ordersSql).not.toMatch(/_step_0_resolved_ts/);
  });
});

describe("multifact funnel incremental refresh — write", () => {
  it("writes only each table's own steps' data", () => {
    const eventsSql = multiFtInsertSql("events");
    const ordersSql = multiFtInsertSql("orders");

    // Events insert writes step 0 (view filter) but not step 1
    expect(eventsSql).toContain("(event_name = 'view')");
    expect(eventsSql).not.toContain("(status = 'completed')");

    // Orders insert writes step 1 (order filter) but not step 0
    expect(ordersSql).toContain("(status = 'completed')");
    expect(ordersSql).not.toContain("(event_name = 'view')");
  });
});

describe("multifact funnel incremental refresh — read (flatten + resolve)", () => {
  it("reads from both cache tables", () => {
    const sql = multiFtReadSql();
    expect(sql).toContain("proj.ds.metric_source_events");
    expect(sql).toContain("proj.ds.metric_source_orders");
  });

  it("flattens sources into __unitMetricsBase before resolving", () => {
    const sql = multiFtReadSql();
    expect(sql).toContain("__unitMetricsBase");
  });

  it("runs the resolution chain on the flattened table", () => {
    const sql = multiFtReadSql();
    expect(sql).toContain("__funnelResolveIncMultiFt_");
    expect(sql).toContain("__unitMetrics");
  });

  it("does NOT run per-source funnel resolution", () => {
    const sql = multiFtReadSql();
    // Single-FT funnels produce __joinedDataSteps / __funnelResolveInc_;
    // multifact funnels should NOT have these per-source resolution CTEs.
    expect(sql).not.toContain("__joinedDataSteps");
    expect(sql).not.toContain("__funnelResolveInc_");
  });

  it("emits per-step sums in the statistics output", () => {
    const sql = multiFtReadSql();
    expect(sql).toContain("m0_step_0_sum");
    expect(sql).toContain("m0_step_1_sum");
  });
});

describe("funnel incremental refresh — resolution parity with inline", () => {
  const intervalSecondsSet = (sql: string): Set<number> =>
    new Set(
      [...sql.matchAll(/INTERVAL\s+(\d+)\s+SECOND/gi)].map((m) =>
        parseInt(m[1], 10),
      ),
    );

  it("resolves with the same conversion/concurrency window constants as inline", () => {
    const metrics = [scalarStep0Funnel];
    // 2h conversion (7200) + 300s concurrency slack on step 1.
    const inlineWindows = intervalSecondsSet(inlineSql(metrics));
    expect(inlineWindows.has(7200)).toBe(true);
    expect(inlineWindows.has(300)).toBe(true);
    // The incremental read's resolution chain reuses the identical arithmetic.
    const readWindows = intervalSecondsSet(readSql(metrics));
    expect(readWindows.has(7200)).toBe(true);
    expect(readWindows.has(300)).toBe(true);
  });

  it("produces the same per-step value and sum columns as inline", () => {
    const metrics = [windowedStep0Funnel];
    const inline = inlineSql(metrics);
    const incremental = readSql(metrics);
    for (const col of [
      "m0_step_0_value",
      "m0_step_1_value",
      "m0_step_0_sum",
      "m0_step_1_sum",
    ]) {
      expect(inline).toContain(col);
      expect(incremental).toContain(col);
    }
  });
});
