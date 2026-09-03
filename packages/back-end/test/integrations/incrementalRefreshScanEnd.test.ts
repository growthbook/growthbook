import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import BigQuery from "back-end/src/integrations/BigQuery";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

// The metric source insert must never scan fact table rows stamped later than
// the refresh's own start time. The scan's MAX(timestamp) is persisted as the
// cache watermark, and a future-stamped row (a client-side event time from a
// device clock set ahead) would push the watermark into the future, after
// which every later refresh loads nothing until the wall clock catches up.

const exposureQuery: ExposureQuery = {
  id: "exposure",
  name: "Exposure",
  description: "",
  query: "SELECT * FROM exposures",
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
  sql: "SELECT * FROM events WHERE ts <= '{{endDate}}'",
  userIdTypes: ["user_id"],
});
const factTableMap = new Map([["ft_events", factTable]]);

// 7 day conversion window: the scan end is the phase end date plus 7 days.
const conversionWindowMetric = factMetricFactory.build({
  id: "fact_conversion",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "value", aggregation: "sum" },
  windowSettings: {
    type: "conversion",
    delayValue: 0,
    delayUnit: "hours",
    windowValue: 7,
    windowUnit: "days",
  },
});

const noWindowMetric = factMetricFactory.build({
  id: "fact_no_window",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "value", aggregation: "sum" },
  windowSettings: {
    type: "",
    delayValue: 0,
    delayUnit: "hours",
    windowValue: 0,
    windowUnit: "hours",
  },
});

const baseSettings: ExperimentSnapshotSettings = {
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
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-01-15T00:00:00Z"),
  variations: [],
};

function factTableCte(sql: string): string {
  const start = sql.indexOf("__factTable AS (");
  const end = sql.indexOf("__maxTimestamp AS (");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("incremental refresh metric source scan end", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context not needed for this unit test
    integration = new BigQuery("", {
      settings: { queries: { exposure: [exposureQuery] } },
    });
  });

  function buildSql({
    settings,
    metric,
    incrementalRefreshStartTime,
  }: {
    settings: ExperimentSnapshotSettings;
    metric: typeof conversionWindowMetric;
    incrementalRefreshStartTime: Date;
  }) {
    return integration.getInsertMetricSourceDataQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [metric],
      lastMaxTimestamp: null,
      incrementalRefreshStartTime,
    });
  }

  it("bounds the scan at the refresh start time for a running phase", () => {
    // Running phase: the snapshot end date is the snapshot time, and the
    // conversion window would otherwise push the scan 7 days into the future.
    const sql = buildSql({
      settings: baseSettings,
      metric: conversionWindowMetric,
      incrementalRefreshStartTime: new Date("2024-01-15T00:05:00Z"),
    });
    const cte = factTableCte(sql);
    expect(cte).toMatch(/m\.timestamp\s*<=\s*'2024-01-15 00:05:00'/);
    expect(cte).not.toContain("2024-01-22");
    // The fact table's own {{endDate}} template sees the same bound.
    expect(cte).toContain("ts <= '2024-01-15 00:05:00'");
    // The lower bound is untouched.
    expect(cte).toMatch(/m\.timestamp\s*>=\s*'2024-01-01 00:00:00'/);
  });

  it("keeps the conversion window scan end for an ended phase", () => {
    // Ended phase refreshed later: the phase end plus the window is in the
    // past, so the scan still covers the whole window.
    const sql = buildSql({
      settings: { ...baseSettings, endDate: new Date("2024-01-10T00:00:00Z") },
      metric: conversionWindowMetric,
      incrementalRefreshStartTime: new Date("2024-01-20T00:00:00Z"),
    });
    const cte = factTableCte(sql);
    expect(cte).toMatch(/m\.timestamp\s*<=\s*'2024-01-17 00:00:00'/);
    expect(cte).not.toContain("2024-01-20");
  });

  it("keeps the snapshot end date for a metric without a conversion window", () => {
    const sql = buildSql({
      settings: baseSettings,
      metric: noWindowMetric,
      incrementalRefreshStartTime: new Date("2024-01-15T00:05:00Z"),
    });
    const cte = factTableCte(sql);
    expect(cte).toMatch(/m\.timestamp\s*<=\s*'2024-01-15 00:00:00'/);
    expect(cte).not.toContain("00:05:00");
  });
});
