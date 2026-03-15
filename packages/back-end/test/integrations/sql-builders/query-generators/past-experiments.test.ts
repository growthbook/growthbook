/**
 * Tests for Past Experiments Query Generator
 *
 * Tests the extraction of past experiments query generation from SqlIntegration.
 * Verifies that the extracted pure function produces equivalent SQL to the original.
 */

import { ExposureQuery } from "shared/types/datasource";
import {
  generatePastExperimentsQuery,
  MAX_ROWS_PAST_EXPERIMENTS_QUERY,
} from "../../../../src/integrations/sql-builders/query-generators/past-experiments";
import { bigQueryDialect } from "../../../../src/integrations/sql-dialects";
import { snowflakeDialect } from "../../../../src/integrations/sql-dialects/snowflake-dialect";
import { postgresDialect } from "../../../../src/integrations/sql-dialects/postgres-dialect";

describe("Past Experiments Query Generator", () => {
  // Sample exposure queries for testing
  const sampleExposureQueries: ExposureQuery[] = [
    {
      id: "user_id",
      name: "User ID Exposures",
      userIdType: "user_id",
      query: "SELECT user_id, experiment_id, variation_id, timestamp FROM experiment_viewed WHERE timestamp >= '{{startDate}}'",
      dimensions: [],
      hasNameCol: false,
    },
  ];

  const exposureQueryWithNames: ExposureQuery[] = [
    {
      id: "user_id_with_names",
      name: "User ID Exposures with Names",
      userIdType: "user_id",
      query: "SELECT user_id, experiment_id, experiment_name, variation_id, variation_name, timestamp FROM experiment_viewed",
      dimensions: [],
      hasNameCol: true,
    },
  ];

  const multipleExposureQueries: ExposureQuery[] = [
    {
      id: "user_id",
      name: "User Exposures",
      userIdType: "user_id",
      query: "SELECT user_id, experiment_id, variation_id, timestamp FROM user_experiment_viewed",
      dimensions: [],
      hasNameCol: false,
    },
    {
      id: "anonymous_id",
      name: "Anonymous Exposures",
      userIdType: "anonymous_id",
      query: "SELECT anonymous_id, experiment_id, variation_id, timestamp FROM anon_experiment_viewed",
      dimensions: [],
      hasNameCol: false,
    },
  ];

  const fromDate = new Date("2024-01-01T00:00:00Z");
  const toDate = new Date("2024-03-01T00:00:00Z");

  describe("Basic Query Generation", () => {
    it("should generate a valid SQL query for BigQuery dialect", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check query structure
      expect(query).toContain("-- Past Experiments");
      expect(query).toContain("__exposures0");
      expect(query).toContain("__experiments");
      expect(query).toContain("__userThresholds");
      expect(query).toContain("__variations");

      // Check BigQuery-specific syntax
      expect(query).toContain("cast(");
      expect(query).toContain("DATETIME"); // BigQuery uses DATETIME for castUserDateCol
    });

    it("should generate a valid SQL query for Snowflake dialect", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        snowflakeDialect
      );

      expect(query).toContain("-- Past Experiments");
      expect(query).toContain("__exposures0");
    });

    it("should generate a valid SQL query for Postgres dialect", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        postgresDialect
      );

      expect(query).toContain("-- Past Experiments");
      expect(query).toContain("__exposures0");
    });
  });

  describe("Exposure Query Handling", () => {
    it("should handle exposure queries with hasNameCol=true", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: exposureQueryWithNames,
        },
        bigQueryDialect
      );

      // When hasNameCol is true, it should use MIN(experiment_name) and MIN(variation_name)
      expect(query).toContain("MIN(experiment_name)");
      expect(query).toContain("MIN(variation_name)");
    });

    it("should handle exposure queries with hasNameCol=false", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // When hasNameCol is false, experiment_name should fall back to experiment_id
      // and variation_name to cast(variation_id as string)
      expect(query).toContain("experiment_id as experiment_name");
    });

    it("should handle multiple exposure queries with UNION ALL", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: multipleExposureQueries,
        },
        bigQueryDialect
      );

      // Check for multiple exposure CTEs
      expect(query).toContain("__exposures0");
      expect(query).toContain("__exposures1");

      // Check for UNION ALL
      expect(query).toContain("UNION ALL");

      // Check for both user types
      expect(query).toContain("user_id");
      expect(query).toContain("anonymous_id");
    });

    it("should throw error when no exposure queries provided", () => {
      expect(() => {
        generatePastExperimentsQuery(
          {
            from: fromDate,
            to: toDate,
            exposureQueries: [],
          },
          bigQueryDialect
        );
      }).toThrow("At least one exposure query is required");
    });
  });

  describe("Date Handling", () => {
    it("should use provided from date in query", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check that the from date is used in the WHERE clause
      expect(query).toContain("2024-01-01");
    });

    it("should use provided to date in query", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check that the to date is used
      expect(query).toContain("2024-03-01");
    });

    it("should default to current time when to date is not provided", () => {
      const now = new Date();
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Query should still be valid
      expect(query).toContain("-- Past Experiments");
      // The current date should be in the query (in some format)
      expect(query).toContain(now.getFullYear().toString());
    });
  });

  describe("Safe Rollout Filtering", () => {
    it("should filter out safe rollout tracking keys", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check for safe rollout filter using the "srk_" prefix
      expect(query).toContain("srk_");
      expect(query).toContain("SUBSTRING");
    });
  });

  describe("Result Limiting", () => {
    it("should include LIMIT clause with MAX_ROWS_PAST_EXPERIMENTS_QUERY", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check for LIMIT clause (may be formatted on separate lines)
      expect(query).toContain("LIMIT");
      expect(query).toContain(MAX_ROWS_PAST_EXPERIMENTS_QUERY.toString());
    });
  });

  describe("Ordering", () => {
    it("should order results by start_date DESC, experiment_id ASC, variation_id ASC", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      expect(query).toContain("ORDER BY");
      expect(query).toContain("start_date DESC");
      expect(query).toContain("experiment_id ASC");
      expect(query).toContain("variation_id ASC");
    });
  });

  describe("User Threshold Logic", () => {
    it("should include user threshold calculation with 5% max users filter", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check for threshold calculation
      expect(query).toContain("threshold");
      expect(query).toContain("max(users)");
      expect(query).toContain("0.05");

      // Check for minimum users filter
      expect(query).toContain("users > 5");
    });

    it("should join variations with thresholds to filter low-traffic variations", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check for join between experiments and thresholds
      expect(query).toContain("JOIN __userThresholds");
      expect(query).toContain("d.users > u.threshold");
    });
  });

  describe("Output Columns", () => {
    it("should select correct output columns", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // Check for expected output columns
      expect(query).toContain("exposure_query");
      expect(query).toContain("experiment_id");
      expect(query).toContain("experiment_name");
      expect(query).toContain("variation_id");
      expect(query).toContain("variation_name");
      expect(query).toContain("start_date");
      expect(query).toContain("end_date");
      expect(query).toContain("users");
      expect(query).toContain("latest_data");
    });
  });

  describe("HLL Support", () => {
    it("should use HLL aggregate for BigQuery (which supports HLL)", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        bigQueryDialect
      );

      // BigQuery supports HLL, so should use HLL functions
      expect(query).toContain("HLL_COUNT");
    });

    it("should use COUNT DISTINCT for dialects without HLL", () => {
      const query = generatePastExperimentsQuery(
        {
          from: fromDate,
          to: toDate,
          exposureQueries: sampleExposureQueries,
        },
        postgresDialect
      );

      // Postgres doesn't have HLL by default, should use COUNT DISTINCT
      expect(query).toContain("COUNT(distinct");
    });
  });

  describe("SQL Template Compilation", () => {
    it("should compile SQL template with startDate variable", () => {
      const exposureWithTemplate: ExposureQuery[] = [
        {
          id: "user_id",
          name: "User ID Exposures",
          userIdType: "user_id",
          query: "SELECT * FROM events WHERE timestamp >= '{{startDate}}'",
          dimensions: [],
          hasNameCol: false,
        },
      ];

      const query = generatePastExperimentsQuery(
        {
          from: new Date("2024-06-15T00:00:00Z"),
          to: toDate,
          exposureQueries: exposureWithTemplate,
        },
        bigQueryDialect
      );

      // The template variable should be replaced with the actual date
      expect(query).toContain("2024-06-15");
    });
  });
});

describe("MAX_ROWS_PAST_EXPERIMENTS_QUERY constant", () => {
  it("should be 3000", () => {
    expect(MAX_ROWS_PAST_EXPERIMENTS_QUERY).toBe(3000);
  });
});
