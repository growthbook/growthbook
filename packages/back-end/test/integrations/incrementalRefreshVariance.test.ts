/**
 * Integration tests to verify that incremental refresh SQL queries
 * correctly include sum_squares columns for variance calculation
 */

import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { DataSourceInterface } from "back-end/types/datasource";
import {
  FactMetricInterface,
  FactTableInterface,
} from "back-end/types/fact-table";
import {
  CreateMetricSourceTableQueryParams,
  InsertMetricSourceDataQueryParams,
  IncrementalRefreshStatisticsQueryParams,
} from "shared/types/integrations";

describe("Incremental Refresh Variance SQL Tests", () => {
  // Mock data source
  const mockDataSource: DataSourceInterface = {
    id: "test-ds",
    organization: "test-org",
    name: "Test PostgreSQL",
    type: "postgres",
    params: JSON.stringify({
      host: "localhost",
      port: 5432,
      database: "testdb",
      user: "testuser",
      password: "testpass",
    } as PostgresConnectionParams),
    settings: {
      queries: {
        exposure: [{
          id: "exp1",
          name: "Test Exposure",
          userIdType: "user_id",
          query: "SELECT * FROM exposures",
          dimensions: [],
        }],
      },
    },
    dateCreated: new Date(),
    dateUpdated: new Date(),
    description: "",
  };

  // Mock fact table
  const mockFactTable: FactTableInterface = {
    id: "ft1",
    name: "Test Fact Table",
    description: "",
    organization: "test-org",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasource: "test-ds",
    owner: "",
    projects: [],
    tags: [],
    sql: "SELECT * FROM events",
    eventName: "",
    userIdTypes: ["user_id"],
    columns: [],
    filters: [],
  };

  // Mock metric
  const mockMetric: FactMetricInterface = {
    id: "m1",
    name: "Test Metric",
    description: "",
    organization: "test-org",
    owner: "",
    datasource: "test-ds",
    projects: [],
    tags: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    metricType: "mean",
    numerator: {
      factTableId: "ft1",
      column: "value",
      filters: [],
    },
  };

  // Mock ratio metric
  const mockRatioMetric: FactMetricInterface = {
    ...mockMetric,
    id: "m2",
    metricType: "ratio",
    denominator: {
      factTableId: "ft1",
      column: "count",
      filters: [],
    },
  };

  describe("CREATE TABLE query", () => {
    it("should include sum_squares columns in metric source table schema", () => {
      const integration = getSourceIntegrationObject({} as any, mockDataSource);

      const params: CreateMetricSourceTableQueryParams = {
        settings: {
          experimentId: "exp1",
          exposureQueryId: "exp1",
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-31"),
        },
        metrics: [mockMetric],
        factTableMap: new Map([[mockFactTable.id, mockFactTable]]),
        metricSourceTableFullName: "test_metrics_source",
      };

      const sql = integration.getCreateMetricSourceTableQuery(params);

      // Verify that sum_squares column exists for the metric value
      expect(sql).toContain("m1_sum_squares");
      expect(sql).toMatch(/m1_sum_squares\s+(FLOAT|DOUBLE PRECISION|NUMERIC)/i);
    });

    it("should include denominator sum_squares for ratio metrics", () => {
      const integration = getSourceIntegrationObject({} as any, mockDataSource);

      const params: CreateMetricSourceTableQueryParams = {
        settings: {
          experimentId: "exp1",
          exposureQueryId: "exp1",
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-31"),
        },
        metrics: [mockRatioMetric],
        factTableMap: new Map([[mockFactTable.id, mockFactTable]]),
        metricSourceTableFullName: "test_metrics_source",
      };

      const sql = integration.getCreateMetricSourceTableQuery(params);

      // Verify both numerator and denominator sum_squares columns exist
      expect(sql).toContain("m2_sum_squares");
      expect(sql).toContain("m2_denominator_sum_squares");
    });
  });

  describe("INSERT query", () => {
    it("should compute sum_squares in daily aggregation", () => {
      const integration = getSourceIntegrationObject({} as any, mockDataSource);

      const params: InsertMetricSourceDataQueryParams = {
        settings: {
          experimentId: "exp1",
          exposureQueryId: "exp1",
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-31"),
        },
        metrics: [mockMetric],
        factTableMap: new Map([[mockFactTable.id, mockFactTable]]),
        metricSourceTableFullName: "test_metrics_source",
        unitsSourceTableFullName: "test_units_source",
        activationMetric: null,
        lastMaxTimestamp: null,
      };

      const sql = integration.getInsertMetricSourceDataQuery(params);

      // Verify sum_squares is computed using SUM(POWER(..., 2))
      expect(sql).toContain("SUM(POWER(");
      expect(sql).toMatch(/SUM\(POWER\([^,]+,\s*2\)\)\s+AS\s+m1_sum_squares/);
    });

    it("should compute denominator sum_squares for ratio metrics", () => {
      const integration = getSourceIntegrationObject({} as any, mockDataSource);

      const params: InsertMetricSourceDataQueryParams = {
        settings: {
          experimentId: "exp1",
          exposureQueryId: "exp1",
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-31"),
        },
        metrics: [mockRatioMetric],
        factTableMap: new Map([[mockFactTable.id, mockFactTable]]),
        metricSourceTableFullName: "test_metrics_source",
        unitsSourceTableFullName: "test_units_source",
        activationMetric: null,
        lastMaxTimestamp: null,
      };

      const sql = integration.getInsertMetricSourceDataQuery(params);

      // Verify both numerator and denominator sum_squares are computed
      expect(sql).toMatch(/m2_sum_squares/);
      expect(sql).toMatch(/m2_denominator_sum_squares/);
    });
  });

  describe("Statistics query", () => {
    it("should reaggregate sum_squares not recompute from sums", () => {
      const integration = getSourceIntegrationObject({} as any, mockDataSource);

      const params: IncrementalRefreshStatisticsQueryParams = {
        settings: {
          experimentId: "exp1",
          exposureQueryId: "exp1",
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-31"),
        },
        metrics: [mockMetric],
        factTableMap: new Map([[mockFactTable.id, mockFactTable]]),
        metricSourceTableFullName: "test_metrics_source",
        unitsSourceTableFullName: "test_units_source",
        activationMetric: null,
        dimensions: [],
      };

      const sql = integration.getIncrementalRefreshStatisticsQuery(params);

      // Verify sum_squares is SUMMED, not recomputed with POWER
      expect(sql).toMatch(/SUM\(umj\.m1_sum_squares\)/);

      // Verify we're NOT computing POWER on the aggregated values
      // (the bug we're fixing)
      const metricDataAggregatedSection = sql.match(
        /__metricDataAggregated AS \(([\s\S]*?)\)/
      );
      if (metricDataAggregatedSection) {
        const cteSql = metricDataAggregatedSection[1];
        // Should NOT have POWER(umj.m1_value, 2)
        expect(cteSql).not.toMatch(/POWER\(umj\.m1_value/);
      }
    });
  });
});
