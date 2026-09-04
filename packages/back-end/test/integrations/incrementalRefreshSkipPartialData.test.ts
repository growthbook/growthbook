import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import BigQuery from "back-end/src/integrations/BigQuery";
import { getIncrementalRefreshMetricSources } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

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
const factTableMap = new Map([["ft_events", factTable]]);

/** 1 day delay + 3 day window = 96 hours to convert */
const longWindowMetric = factMetricFactory.build({
  id: "fact_long_window",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
  windowSettings: {
    type: "conversion",
    delayValue: 1,
    delayUnit: "days",
    windowValue: 3,
    windowUnit: "days",
  },
});

/** 0 delay + 1 day window = 24 hours to convert */
const shortWindowMetric = factMetricFactory.build({
  id: "fact_short_window",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
  windowSettings: {
    type: "conversion",
    delayValue: 0,
    delayUnit: "hours",
    windowValue: 1,
    windowUnit: "days",
  },
});

const NOW = new Date("2024-02-10T12:00:00.000Z");

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
  startDate: new Date("2024-01-01"),
  // Phase still running: the cutoff must come from "now - window", not the
  // phase end date.
  endDate: new Date("2999-01-01"),
  variations: [],
};

function unitsCte(sql: string): string {
  const start = sql.indexOf("__experimentUnits AS (");
  const end = sql.indexOf("__metricDataAggregated");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("incremental refresh statistics query with skipPartialData", () => {
  let integration: BigQuery;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    // @ts-expect-error -- context not needed for this unit test
    integration = new BigQuery("", {
      settings: { queries: { exposure: [exposureQuery] } },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function buildSql(
    settings: ExperimentSnapshotSettings,
    metrics = [longWindowMetric],
    asOf?: Date,
  ) {
    return integration.getIncrementalRefreshStatisticsQuery({
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
      metrics,
      lastMaxTimestamp: null,
      asOf,
    });
  }

  it("does not filter units when in-progress conversions are included", () => {
    const sql = buildSql({ ...baseSettings, skipPartialData: false });
    expect(unitsCte(sql)).not.toContain("first_exposure_timestamp <=");
  });

  it("only analyzes units with a full conversion window when excluded", () => {
    const sql = buildSql({ ...baseSettings, skipPartialData: true });
    const cte = unitsCte(sql);
    // 96 hours before NOW
    const cutoff = integration
      .getSqlDialect()
      .toTimestamp(new Date("2024-02-06T12:00:00.000Z"));
    expect(cte).toContain(`e.first_exposure_timestamp <= ${cutoff}`);
    expect(cte).toMatch(
      /FROM\s+proj\.ds\.units e\s+WHERE\s+e\.first_exposure_timestamp <=/,
    );
  });

  it("uses the longest window when a mixed-window slice excludes in-progress conversions", () => {
    const sql = buildSql({ ...baseSettings, skipPartialData: true }, [
      shortWindowMetric,
      longWindowMetric,
    ]);
    // 96 hours before NOW (long window), not 24
    const cutoff = integration
      .getSqlDialect()
      .toTimestamp(new Date("2024-02-06T12:00:00.000Z"));
    expect(unitsCte(sql)).toContain(`e.first_exposure_timestamp <= ${cutoff}`);
  });

  it("subtracts a sub-hour window in elapsed time, not truncated hours", () => {
    const halfHourMetric = factMetricFactory.build({
      id: "fact_half_hour",
      metricType: "mean",
      numerator: {
        factTableId: "ft_events",
        column: "amount",
        aggregation: "sum",
      },
      windowSettings: {
        type: "conversion",
        delayValue: 0,
        delayUnit: "minutes",
        windowValue: 30,
        windowUnit: "minutes",
      },
    });
    const sql = buildSql({ ...baseSettings, skipPartialData: true }, [
      halfHourMetric,
    ]);
    const cutoff = integration
      .getSqlDialect()
      .toTimestamp(new Date("2024-02-10T11:30:00.000Z"));
    expect(unitsCte(sql)).toContain(`e.first_exposure_timestamp <= ${cutoff}`);
  });

  it("allows a mixed-window slice when in-progress conversions are included", () => {
    expect(() =>
      buildSql({ ...baseSettings, skipPartialData: false }, [
        shortWindowMetric,
        longWindowMetric,
      ]),
    ).not.toThrow();
  });

  it("never cuts off after the phase end date", () => {
    const sql = buildSql({
      ...baseSettings,
      skipPartialData: true,
      endDate: new Date("2024-01-31T00:00:00.000Z"),
    });
    const cutoff = integration
      .getSqlDialect()
      .toTimestamp(new Date("2024-01-31T00:00:00.000Z"));
    expect(unitsCte(sql)).toContain(`e.first_exposure_timestamp <= ${cutoff}`);
  });

  it("anchors the cutoff to cache coverage, not wall-clock now", () => {
    const coverage = new Date("2024-02-08T12:00:00.000Z");
    const sql = buildSql(
      { ...baseSettings, skipPartialData: true },
      [longWindowMetric],
      coverage,
    );
    // 96 hours before coverage, not NOW
    const cutoff = integration
      .getSqlDialect()
      .toTimestamp(new Date("2024-02-04T12:00:00.000Z"));
    expect(unitsCte(sql)).toContain(`e.first_exposure_timestamp <= ${cutoff}`);
  });
});

describe("incremental refresh metric grouping with skipPartialData", () => {
  const fakeIntegration = {
    getSourceProperties: () => ({ maxColumns: 1000 }),
  } as unknown as Parameters<
    typeof getIncrementalRefreshMetricSources
  >[0]["integration"];

  it("keeps metrics with different conversion windows in one cache when included", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [shortWindowMetric, longWindowMetric],
      existingMetricSources: [],
      integration: fakeIntegration,
      snapshotSettings: { ...baseSettings, skipPartialData: false },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].metrics.map((m) => m.id).sort()).toEqual([
      "fact_long_window",
      "fact_short_window",
    ]);
  });

  it("keeps metrics with different conversion windows in one cache when excluded", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [shortWindowMetric, longWindowMetric],
      existingMetricSources: [],
      integration: fakeIntegration,
      snapshotSettings: { ...baseSettings, skipPartialData: true },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].metrics.map((m) => m.id).sort()).toEqual([
      "fact_long_window",
      "fact_short_window",
    ]);
    expect(groups[0].groupId).not.toContain("_cw");
    expect(groups[0].groupId).not.toContain(".");
  });

  it("does not encode a sub-hour window in the group key", () => {
    const halfHourMetric = factMetricFactory.build({
      id: "fact_half_hour",
      metricType: "mean",
      numerator: {
        factTableId: "ft_events",
        column: "amount",
        aggregation: "sum",
      },
      windowSettings: {
        type: "conversion",
        delayValue: 0,
        delayUnit: "minutes",
        windowValue: 30,
        windowUnit: "minutes",
      },
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [halfHourMetric],
      existingMetricSources: [],
      integration: fakeIntegration,
      snapshotSettings: { ...baseSettings, skipPartialData: true },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toContain("ft_events_");
    expect(groups[0].groupId).not.toContain("_cw");
    expect(groups[0].groupId).not.toContain(".");
  });

  it("keeps same-window metrics together when excluded", () => {
    const anotherLong = factMetricFactory.build({
      ...longWindowMetric,
      id: "fact_long_window_2",
    });
    const groups = getIncrementalRefreshMetricSources({
      metrics: [longWindowMetric, anotherLong],
      existingMetricSources: [],
      integration: fakeIntegration,
      snapshotSettings: { ...baseSettings, skipPartialData: true },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].metrics.map((m) => m.id).sort()).toEqual([
      "fact_long_window",
      "fact_long_window_2",
    ]);
    expect(groups[0].groupId).not.toContain("_cw");
  });
});
