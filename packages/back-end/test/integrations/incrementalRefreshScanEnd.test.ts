import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import BigQuery from "back-end/src/integrations/BigQuery";
import { getIncrementalMetricScanEnd } from "back-end/src/services/experiments";
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
  identifierType: exposureQuery.userIdType,
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
      type: "bigquery",
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

  it("bounds a running phase's scan at a lagged analysis end date", () => {
    // Scheduled run at 03:00 analyzing through midnight. Scanning to 03:00
    // would move the watermark past users exposed after midnight, who aren't
    // in the units table yet, and the next refresh would skip their rows.
    const sql = buildSql({
      settings: baseSettings,
      metric: conversionWindowMetric,
      incrementalRefreshStartTime: getIncrementalMetricScanEnd(
        {},
        baseSettings,
        new Date("2024-01-15T03:00:00Z"),
      ),
    });
    const cte = factTableCte(sql);
    expect(cte).toMatch(/m\.timestamp\s*<=\s*'2024-01-15 00:00:00'/);
    expect(cte).not.toContain("03:00:00");
  });

  it("scans an ended phase to the refresh start time", () => {
    const endDate = new Date("2024-01-10T00:00:00Z");
    const now = new Date("2024-01-20T00:00:00Z");
    expect(
      getIncrementalMetricScanEnd({ dateEnded: endDate }, { endDate }, now),
    ).toEqual(now);
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

describe("regular experiment query scan end", () => {
  // Scheduled run 3 hours after its cutoff (baseSettings.endDate).
  const runTime = new Date("2024-01-15T03:00:00Z");
  let integration: BigQuery;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(runTime);
    // @ts-expect-error -- context not needed for this unit test
    integration = new BigQuery("", {
      type: "bigquery",
      settings: { queries: { exposure: [exposureQuery] } },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function buildSql(settings: ExperimentSnapshotSettings) {
    return integration.getExperimentFactMetricsQuery({
      settings,
      activationMetric: null,
      dimensions: [],
      segment: null,
      factTableMap,
      metrics: [conversionWindowMetric],
      unitsSource: "exposureQuery",
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(
        settings,
        resolvedExposureQuery,
      ),
    });
  }

  it("extends the scan by the conversion window past the end date", () => {
    const sql = buildSql(baseSettings);
    expect(sql).toContain("ts <= '2024-01-22 00:00:00'");
    expect(sql).toMatch(/m\.timestamp\s*<=\s*'2024-01-22 00:00:00'/);
  });

  it("stops the scan at a cutoff end date", () => {
    const sql = buildSql({ ...baseSettings, endDateIsCutoff: true });
    expect(sql).toContain("ts <= '2024-01-15 00:00:00'");
    expect(sql).toMatch(/m\.timestamp\s*<=\s*'2024-01-15 00:00:00'/);
    expect(sql).not.toContain("2024-01-22");
  });

  it("judges in-progress conversions against the run time without a cutoff", () => {
    const sql = buildSql({ ...baseSettings, skipPartialData: true });
    expect(sql).toMatch(
      /first_exposure_timestamp\s*<=\s*'2024-01-08 03:00:00'/,
    );
  });

  it("judges in-progress conversions against a cutoff end date", () => {
    const sql = buildSql({
      ...baseSettings,
      skipPartialData: true,
      endDateIsCutoff: true,
    });
    expect(sql).toMatch(
      /first_exposure_timestamp\s*<=\s*'2024-01-08 00:00:00'/,
    );
    expect(sql).not.toContain("2024-01-08 03:00:00");
  });
});
