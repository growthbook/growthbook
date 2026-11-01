import { clickHouseDialect, postgresDialect } from "shared/dialects";
import type { ExperimentAggregateUnitsQueryParams } from "shared/types/integrations";
import ClickHouse from "back-end/src/integrations/ClickHouse";
import { getBanditStatisticsCTE } from "back-end/src/integrations/sql/ctes/bandit-statistics-cte";
import { getBanditStatisticsFactMetricCTE } from "back-end/src/integrations/sql/ctes/bandit-statistics-fact-metric-cte";
import { getExperimentAggregateUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-aggregate-units-query";

function makeIntegration(useMaterializedCTEs?: boolean): ClickHouse {
  // @ts-expect-error -- No request context or credentials needed for SQL generation.
  const integration = new ClickHouse(null, { type: "clickhouse" });
  integration.params = {
    port: 8123,
    database: "analytics",
    password: "",
    useMaterializedCTEs,
  };
  return integration;
}

describe("ClickHouse materialized CTEs", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, false])(
    "preserves existing SQL when the option is %s",
    (value) => {
      const dialect = makeIntegration(value).getSqlDialect();
      expect(dialect.useMaterializedCTEs).toBe(false);
      expect(banditSql(dialect)).toEqual(banditSql(clickHouseDialect));
    },
  );

  function banditSql(dialect: ReturnType<ClickHouse["getSqlDialect"]>) {
    return [
      getBanditStatisticsCTE(dialect, {
        baseIdType: "device_id",
        metricData: [],
        dimensionCols: [],
        hasRegressionAdjustment: false,
      }),
      getBanditStatisticsFactMetricCTE(dialect, {
        baseIdType: "device_id",
        metricData: [],
        dimensionCols: [],
        factTablesWithIndices: [],
        regressionAdjustedTableIndices: new Set(),
        percentileTableIndices: new Set(),
      }),
    ];
  }

  it("materializes only period statistics in both Bandit SQL paths", () => {
    const original = banditSql(clickHouseDialect);
    const modified = banditSql(makeIntegration(true).getSqlDialect());
    modified.forEach((sql, i) => {
      expect(sql).toContain("__banditPeriodStatistics AS MATERIALIZED (");
      expect(sql.match(/\bMATERIALIZED\b/g)).toHaveLength(1);
      expect(sql.replace("AS MATERIALIZED (", "AS (")).toBe(original[i]);
    });
  });

  it("does not change the shared dialect or other connections", () => {
    makeIntegration(true).getSqlDialect();
    expect(clickHouseDialect.useMaterializedCTEs).toBeUndefined();
    expect(postgresDialect.useMaterializedCTEs).toBeUndefined();
    expect(makeIntegration().getSqlDialect().useMaterializedCTEs).toBe(false);
  });

  function healthParams(): ExperimentAggregateUnitsQueryParams {
    const startDate = new Date("2026-01-01T00:00:00Z");
    const endDate = new Date("2026-02-01T00:00:00Z");
    return {
      settings: {
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
          stddev: 1,
        },
        regressionAdjustmentEnabled: false,
        attributionModel: "firstExposure",
        experimentId: "exp_1",
        queryFilter: "",
        segment: "",
        skipPartialData: false,
        datasourceId: "ds_1",
        exposureQueryId: "exposure",
        startDate,
        endDate,
        variations: [],
      },
      unitsSettings: {
        experimentId: "exp_1",
        exposureQuery: {
          identifierType: "device_id",
          query: "SELECT * FROM exposures",
        },
        startDate,
        endDate,
        skipPartialData: false,
        attributionModel: "firstExposure",
        queryFilter: "",
        variations: [],
        metricSettings: [],
      },
      dimensions: [],
      useUnitsTable: false,
      factTableMap: new Map(),
    };
  }

  it("materializes Health units only when they are reused", () => {
    const integration = makeIntegration(true);
    const datasource = { ...integration.datasource, settings: {} };
    const params = healthParams();
    const single = getExperimentAggregateUnitsQuery(
      integration.getSqlDialect(),
      datasource,
      params,
    );
    expect(single).not.toContain("MATERIALIZED");

    params.dimensions = [{ id: "country", specifiedSlices: ["US", "GB"] }];
    const original = getExperimentAggregateUnitsQuery(
      clickHouseDialect,
      datasource,
      params,
    );
    const enabled = getExperimentAggregateUnitsQuery(
      integration.getSqlDialect(),
      datasource,
      params,
    );
    expect(enabled).toContain("__distinctUnits AS MATERIALIZED (");
    expect(enabled.match(/\bMATERIALIZED\b/g)).toHaveLength(1);
    // Ignore formatting around the newly inserted keyword.
    expect(enabled.replace(/\bMATERIALIZED\s*/g, "").replace(/\s+/g, "")).toBe(
      original.replace(/\s+/g, ""),
    );
    expect(
      getExperimentAggregateUnitsQuery(postgresDialect, datasource, params),
    ).not.toContain("MATERIALIZED");
  });

  it.each([undefined, false])(
    "does not probe unsupported features when the option is %s",
    async (value) => {
      const integration = makeIntegration(value);
      const run = jest
        .spyOn(integration, "runQuery")
        .mockResolvedValue({ rows: [] });
      await expect(integration.testConnection()).resolves.toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0][0]).toBe("SELECT 1");
    },
  );

  it("validates the SQL syntax and session setting when enabled", async () => {
    const integration = makeIntegration(true);
    const run = jest
      .spyOn(integration, "runQuery")
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ result: "2", enabled: 1 }] });
    await expect(integration.testConnection()).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toContain("AS MATERIALIZED");
    expect(run.mock.calls[1][0]).toContain(
      "getSetting('enable_materialized_cte')",
    );
    expect(run.mock.calls[1][2]).toEqual({ queryType: "connectionTest" });
  });

  it("rejects an enabled option when ClickHouse silently ignores materialization", async () => {
    const integration = makeIntegration(true);
    jest
      .spyOn(integration, "runQuery")
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ result: "2", enabled: 0 }] });
    await expect(integration.testConnection()).rejects.toThrow(
      "enable_materialized_cte = 1",
    );
  });

  it("explains how to disable the option on an incompatible ClickHouse version", async () => {
    const integration = makeIntegration(true);
    jest
      .spyOn(integration, "runQuery")
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("Syntax error: MATERIALIZED"));
    await expect(integration.testConnection()).rejects.toThrow(
      "Disable 'Use materialized CTEs (experimental)'",
    );
  });

  it("preserves ordinary connection errors", async () => {
    const integration = makeIntegration(true);
    jest
      .spyOn(integration, "runQuery")
      .mockRejectedValue(new Error("Authentication failed"));
    await expect(integration.testConnection()).rejects.toThrow(
      /^Authentication failed$/,
    );
  });
});
