import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { AggregatedFactTableInterface } from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";
import BigQuery from "back-end/src/integrations/BigQuery";
import { ApiReqContext } from "back-end/types/api";
import {
  getFactTableSettingsHashForAggregatedFactTable,
  getMetricSettingsHashForAggregatedFactTable,
} from "back-end/src/enterprise/services/data-pipeline";
import { getColumnsForMetric } from "back-end/src/integrations/sql/fact-metrics/columns-for-metric";
import { resolveCovariateInsertPath } from "back-end/src/integrations/sql/fact-metrics/resolve-covariate-insert-path";
import { factTableFactory } from "./factories/FactTable.factory";
import { factMetricFactory } from "./factories/FactMetric.factory";

const FT_ID = "ft_events";
const ID_TYPE = "user_id";
const DATASOURCE_ID = "ds_1";
const TABLE = "proj.ds.gb_aggregated_ft_events_user_id";

const factTable = factTableFactory.build({
  id: FT_ID,
  name: "Events",
  sql: "SELECT * FROM events",
  userIdTypes: [ID_TYPE],
  aggregatedFactTableSettings: {
    idTypes: [ID_TYPE],
    updateTime: { time: "02:00", timezone: "UTC" },
    lookbackWindow: 60,
  },
});

const raMetric: FactMetricInterface = factMetricFactory.build({
  id: "fact_ra1",
  metricType: "mean",
  numerator: { factTableId: FT_ID, column: "amount", aggregation: "sum" },
  regressionAdjustmentEnabled: true,
});

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
  regressionAdjustmentEnabled: true,
  attributionModel: "firstExposure",
  experimentId: "exp_1",
  queryFilter: "",
  segment: "",
  skipPartialData: false,
  datasourceId: DATASOURCE_ID,
  exposureQueryId: "exposure",
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
  variations: [],
};

function buildRegistry(
  overrides: Partial<AggregatedFactTableInterface> = {},
  metrics: FactMetricInterface[] = [raMetric],
): AggregatedFactTableInterface {
  return {
    id: "aft_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasourceId: DATASOURCE_ID,
    factTableId: FT_ID,
    idType: ID_TYPE,
    tableFullName: TABLE,
    lastMaxTimestamp: new Date(),
    firstEventDate: new Date("2023-01-01"),
    lastEventDate: new Date(),
    factTableSettingsHash:
      getFactTableSettingsHashForAggregatedFactTable(factTable),
    inFlightExecutionId: null,
    metricState: metrics.map((m) => ({
      metricId: m.id,
      settingsHash: getMetricSettingsHashForAggregatedFactTable({
        factMetric: m,
        factTableId: FT_ID,
      }),
      columns: getColumnsForMetric(m, FT_ID),
      builtAt: new Date(),
    })),
    currentExecutionId: null,
    lastRunId: null,
    ...overrides,
  } as AggregatedFactTableInterface;
}

function makeContext(
  registry: AggregatedFactTableInterface | null,
): ApiReqContext {
  return {
    logger: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    models: {
      aggregatedFactTables: {
        getByKey: jest.fn().mockResolvedValue(registry),
      },
    },
  } as unknown as ApiReqContext;
}

describe("resolveCovariateInsertPath", () => {
  it("uses the aggregated path when all gates and metrics pass", async () => {
    const result = await resolveCovariateInsertPath({
      context: makeContext(buildRegistry()),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({
      path: "aggregated",
      aggregatedTableFullName: TABLE,
      idType: ID_TYPE,
      reason: "aggregated",
    });
  });

  it("falls back to legacy when the table does not cover the covariate window", async () => {
    // Covariate window ends at the experiment start (2024-01-01); a table whose
    // newest day is before that window does not cover it, regardless of how
    // recent it is relative to wall-clock time.
    const notCovered = buildRegistry({
      lastEventDate: new Date("2023-12-01"),
    });
    const result = await resolveCovariateInsertPath({
      context: makeContext(notCovered),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({ path: "legacy", reason: "window-not-covered" });
  });

  it("uses the aggregated path for an old experiment when the table covers the past window even if the table is behind now", async () => {
    // Experiment started 2024-01-01; the nightly job stopped at 2024-02-15.
    // The covariate window is entirely before the experiment start, so the
    // table still fully covers it even though it's far behind wall-clock time.
    const behind = buildRegistry({
      lastEventDate: new Date("2024-02-15"),
    });
    const result = await resolveCovariateInsertPath({
      context: makeContext(behind),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({
      path: "aggregated",
      aggregatedTableFullName: TABLE,
      idType: ID_TYPE,
      reason: "aggregated",
    });
  });

  it("falls back to legacy when the table starts after the covariate window begins", async () => {
    // Covariate window starts ~2023-12-22 (start 2024-01-01 minus 10 RA days);
    // a table whose first day is after that misses the earliest covariate days.
    const startsLate = buildRegistry({
      firstEventDate: new Date("2023-12-25"),
    });
    const result = await resolveCovariateInsertPath({
      context: makeContext(startsLate),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({ path: "legacy", reason: "window-not-covered" });
  });

  it("falls back to legacy when the exposure id type is not materialized", async () => {
    const result = await resolveCovariateInsertPath({
      context: makeContext(buildRegistry()),
      factTable: factTableFactory.build({
        id: FT_ID,
        userIdTypes: [ID_TYPE, "anonymous_id"],
        aggregatedFactTableSettings: {
          idTypes: [ID_TYPE],
          updateTime: { time: "02:00", timezone: "UTC" },
          lookbackWindow: 60,
        },
      }),
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: "anonymous_id",
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({
      path: "legacy",
      reason: "id-type-not-materialized",
    });
  });

  it("falls back to legacy when the registry lookup throws (failsafe)", async () => {
    const context = {
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      models: {
        aggregatedFactTables: {
          getByKey: jest.fn().mockRejectedValue(new Error("db down")),
        },
      },
    } as unknown as ApiReqContext;
    const result = await resolveCovariateInsertPath({
      context,
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({ path: "legacy", reason: "error" });
  });

  it("falls back to legacy when the registry has no materialized table", async () => {
    const result = await resolveCovariateInsertPath({
      context: makeContext(buildRegistry({ tableFullName: null })),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({ path: "legacy", reason: "no-materialized-table" });
  });

  it("falls back to legacy when a metric's settings hash drifted", async () => {
    const registry = buildRegistry();
    registry.metricState[0].settingsHash = "stale-hash";
    const result = await resolveCovariateInsertPath({
      context: makeContext(registry),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({ path: "legacy", reason: "metrics-not-covered" });
  });

  it("falls back to legacy when any one metric in the group is missing (all-or-nothing)", async () => {
    const newMetric = factMetricFactory.build({
      id: "fact_ra2",
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
      regressionAdjustmentEnabled: true,
    });
    // Registry only knows about raMetric, not the newly-added metric.
    const result = await resolveCovariateInsertPath({
      context: makeContext(buildRegistry()),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric, newMetric],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({ path: "legacy", reason: "metrics-not-covered" });
  });

  it("falls back to legacy for event-quantile metrics (unsafe re-aggregation)", async () => {
    const eventQuantile = factMetricFactory.build({
      id: "fact_eq",
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: { factTableId: FT_ID, column: "amount", aggregation: "sum" },
      regressionAdjustmentEnabled: true,
    });
    const result = await resolveCovariateInsertPath({
      context: makeContext(buildRegistry({}, [eventQuantile])),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [eventQuantile],
      settings,
      activationMetric: null,
    });
    expect(result).toEqual({ path: "legacy", reason: "metrics-not-covered" });
  });
});

describe("covariate insert SQL builders", () => {
  let integration: BigQuery;

  const exposureQuery: ExposureQuery = {
    id: "exposure",
    name: "Exposure",
    description: "",
    query: "*",
    userIdType: ID_TYPE,
    dimensions: [],
  };

  const factTableMap = new Map([[FT_ID, factTable]]);

  beforeEach(() => {
    // @ts-expect-error -- context not needed for these unit tests; the exposure
    // list satisfies getExposureQuery without a real datasource.
    integration = new BigQuery("", {
      settings: { queries: { exposure: [exposureQuery] } },
    });
  });

  const baseParams = {
    settings,
    exposureQuery: {
      query: exposureQuery.query,
      userIdType: exposureQuery.userIdType,
    },
    activationMetric: null,
    factTableMap,
    factTableId: FT_ID,
    metricSourceCovariateTableFullName: "proj.ds.cov",
    unitsSourceTableFullName: "proj.ds.units",
    metrics: [raMetric],
    lastCovariateSuccessfulMaxTimestamp: null,
  };

  // Experiment starting mid-day (not at a UTC day boundary) with a 14-day
  // regression-adjustment window. Covariate window = [2025-10-10 14:00,
  // 2025-10-24 14:00); floored to whole UTC days that is [2025-10-10,
  // 2025-10-24), i.e. 14 full days ending the day before the experiment start.
  const lateStartSettings: ExperimentSnapshotSettings = {
    ...settings,
    startDate: new Date("2025-10-24T14:00:00Z"),
  };
  const raMetric14: FactMetricInterface = {
    ...factMetricFactory.build({
      id: "fact_ra14",
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "amount", aggregation: "sum" },
      regressionAdjustmentEnabled: true,
    }),
    regressionAdjustmentDays: 14,
  };
  const lateStartParams = {
    ...baseParams,
    settings: lateStartSettings,
    metrics: [raMetric14],
  };

  it("legacy builder scans raw events with the per-row covariate window", () => {
    const sql = integration.getInsertMetricSourceCovariateDataQuery({
      ...baseParams,
      alignLegacyScanToDailyGrain: false,
    });
    expect(sql).toContain("proj.ds.cov");
    // Scans the raw fact table CTE, not the aggregated registry table.
    expect(sql).toContain("__factTable");
    expect(sql).not.toContain(TABLE);
    expect(sql).toMatchSnapshot();
  });

  it("legacy builder aligns the per-row covariate window to whole UTC days when requested", () => {
    const aligned = integration.getInsertMetricSourceCovariateDataQuery({
      ...lateStartParams,
      alignLegacyScanToDailyGrain: true,
    });
    const unaligned = integration.getInsertMetricSourceCovariateDataQuery({
      ...lateStartParams,
      alignLegacyScanToDailyGrain: false,
    });
    // Unaligned keeps the exact mid-day window bounds.
    expect(unaligned).toContain("2025-10-10 14:00:00.000");
    expect(unaligned).toContain("2025-10-24 14:00:00.000");
    // Aligned floors both bounds to the UTC day boundary (00:00), so it never
    // touches the experiment-start instant.
    expect(aligned).toContain("2025-10-10 00:00:00.000");
    expect(aligned).toContain("2025-10-24 00:00:00.000");
    expect(aligned).not.toContain("14:00:00");
    expect(aligned).not.toEqual(unaligned);
    expect(aligned).toMatchSnapshot();
  });

  it("aggregated builder reads daily partials and re-aggregates them", () => {
    const sql =
      integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery({
        ...baseParams,
        aggregatedTableFullName: TABLE,
        idType: ID_TYPE,
      });
    expect(sql).toContain("proj.ds.cov");
    // Reads from the registry table, not the raw fact table CTE.
    expect(sql).toContain(TABLE);
    expect(sql).not.toContain("__factTable");
    // Re-aggregates the daily partials over the day-grained covariate window.
    expect(sql).toContain("event_date");
    expect(sql.replace(/\s+/g, "")).toContain("SUM(COALESCE(");
    expect(sql).toMatchSnapshot();
  });

  it("aggregated builder floors the window to whole UTC days and excludes the experiment-start day", () => {
    // Start 2025-10-24 14:00 UTC, 14 RA days. The covariate window floors to
    // [2025-10-10, 2025-10-24): 14 full days. The strict `<` on the end day
    // means nothing from the experiment-start day (Oct 24) leaks into the
    // covariate, which would otherwise bias CUPED.
    const sql =
      integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery({
        ...lateStartParams,
        aggregatedTableFullName: TABLE,
        idType: ID_TYPE,
      });
    const compact = sql.replace(/\s+/g, " ");
    expect(compact).toContain("event_date >= CAST('2025-10-10' AS DATE)");
    expect(compact).toContain("event_date < CAST('2025-10-24' AS DATE)");
    // No data from the experiment-start day or later, and no mid-day instants.
    expect(sql).not.toContain("2025-10-25");
    expect(sql).not.toContain("14:00:00");
  });

  it("aggregated and daily-aligned legacy builders cover the same calendar days", () => {
    const aggregated =
      integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery({
        ...lateStartParams,
        aggregatedTableFullName: TABLE,
        idType: ID_TYPE,
      });
    const legacyAligned = integration.getInsertMetricSourceCovariateDataQuery({
      ...lateStartParams,
      alignLegacyScanToDailyGrain: true,
    });
    // Both compute [2025-10-10, 2025-10-24): the aggregated path against the
    // DATE `event_date` column, the legacy path against the raw timestamp
    // floored to the same day boundaries. Equivalent because the day bounds
    // are at UTC midnight.
    expect(aggregated).toContain("CAST('2025-10-10' AS DATE)");
    expect(aggregated).toContain("CAST('2025-10-24' AS DATE)");
    expect(legacyAligned).toContain("2025-10-10 00:00:00.000");
    expect(legacyAligned).toContain("2025-10-24 00:00:00.000");
  });
});
