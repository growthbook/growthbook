import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { AggregatedFactTableInterface } from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";
import BigQuery from "back-end/src/integrations/BigQuery";
import { ApiReqContext } from "back-end/types/api";
import { getMetricSettingsHashForAggregatedFactTable } from "back-end/src/enterprise/services/data-pipeline";
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
  aggregatedFactTableIdTypes: [ID_TYPE],
});

const raMetric: FactMetricInterface = factMetricFactory.build({
  id: "fact_ra1",
  metricType: "mean",
  numerator: { factTableId: FT_ID, column: "amount", aggregation: "sum" },
  regressionAdjustmentEnabled: true,
});

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
    firstEventDate: new Date("2024-01-01"),
    lastEventDate: new Date(),
    factTableSettingsHash: "ft-hash",
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
    });
    expect(result).toEqual({
      path: "aggregated",
      aggregatedTableFullName: TABLE,
      idType: ID_TYPE,
    });
  });

  it("falls back to legacy when the table is stale", async () => {
    const stale = buildRegistry({
      lastEventDate: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    const result = await resolveCovariateInsertPath({
      context: makeContext(stale),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
    });
    expect(result).toEqual({ path: "legacy" });
  });

  it("falls back to legacy when the exposure id type is not materialized", async () => {
    const result = await resolveCovariateInsertPath({
      context: makeContext(buildRegistry()),
      factTable: factTableFactory.build({
        id: FT_ID,
        userIdTypes: [ID_TYPE, "anonymous_id"],
        aggregatedFactTableIdTypes: [ID_TYPE],
      }),
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: "anonymous_id",
      regressionAdjustedMetrics: [raMetric],
    });
    expect(result).toEqual({ path: "legacy" });
  });

  it("falls back to legacy when the registry has no materialized table", async () => {
    const result = await resolveCovariateInsertPath({
      context: makeContext(buildRegistry({ tableFullName: null })),
      factTable,
      datasourceId: DATASOURCE_ID,
      exposureUserIdType: ID_TYPE,
      regressionAdjustedMetrics: [raMetric],
    });
    expect(result).toEqual({ path: "legacy" });
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
    });
    expect(result).toEqual({ path: "legacy" });
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
    });
    expect(result).toEqual({ path: "legacy" });
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
    });
    expect(result).toEqual({ path: "legacy" });
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

  beforeEach(() => {
    // @ts-expect-error -- context not needed for these unit tests; the exposure
    // list satisfies getExposureQuery without a real datasource.
    integration = new BigQuery("", {
      settings: { queries: { exposure: [exposureQuery] } },
    });
  });

  const baseParams = {
    settings,
    activationMetric: null,
    factTableMap,
    factTableId: FT_ID,
    metricSourceCovariateTableFullName: "proj.ds.cov",
    unitsSourceTableFullName: "proj.ds.units",
    metrics: [raMetric],
    lastCovariateSuccessfulMaxTimestamp: null,
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

  it("legacy builder aligns the scan to daily grain when requested", () => {
    const aligned = integration.getInsertMetricSourceCovariateDataQuery({
      ...baseParams,
      alignLegacyScanToDailyGrain: true,
    });
    const unaligned = integration.getInsertMetricSourceCovariateDataQuery({
      ...baseParams,
      alignLegacyScanToDailyGrain: false,
    });
    // The aligned scan starts a calendar day earlier than the unaligned one.
    expect(aligned).not.toEqual(unaligned);
    expect(aligned).toContain("2023-12-21");
    expect(unaligned).not.toContain("2023-12-21");
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
});
