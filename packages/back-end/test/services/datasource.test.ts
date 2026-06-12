import { testQueryValidity } from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

// @ts-expect-error - we are not testing all the properties of the integration
const mockDataSourceIntegration: SourceIntegrationInterface = {
  getTestValidityQuery: jest.fn(),
  runTestQuery: jest.fn(),
};

// Mock integration that supports LIMIT 0 column validation (like BigQuery/Snowflake)
// @ts-expect-error - we are not testing all the properties of the integration
const mockLimitZeroIntegration: SourceIntegrationInterface = {
  getTestValidityQuery: jest.fn(),
  runTestQuery: jest.fn(),
  supportsLimitZeroColumnValidation: jest.fn().mockReturnValue(true),
};

describe("testQueryValidity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return undefined if integration does not support test queries", async () => {
    const query = {
      id: "user_id",
      name: "Logged in Users",
      userIdType: "user_id",
      dimensions: ["country"],
      hasNameCol: true,
      query: "SELECT * FROM experiments",
    };

    // @ts-expect-error - we are testing the case where integration does not support test queries
    const result = await testQueryValidity({}, query);

    expect(result).toBeUndefined();
  });

  describe("datasources without LIMIT 0 support (row-based validation)", () => {
    it('should return "No rows returned" if test query returns no results', async () => {
      const query = {
        id: "user_id",
        name: "Logged in Users",
        userIdType: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        query: "SELECT * FROM experiments",
      };

      mockDataSourceIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM experiments");
      mockDataSourceIntegration.runTestQuery = jest
        .fn()
        .mockResolvedValue({ results: [] });

      const result = await testQueryValidity(mockDataSourceIntegration, query);

      expect(result).toBe("No rows returned");
      expect(
        mockDataSourceIntegration.getTestValidityQuery,
      ).toHaveBeenCalledWith(query.query, undefined, undefined, "timestamp");
      expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
        "SELECT * FROM experiments",
        undefined,
        "testQuery",
      );
    });

    it('should return "Missing required columns in response" if test query results do not contain all required columns', async () => {
      const query = {
        id: "user_id",
        name: "Logged in Users",
        userIdType: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        query: "SELECT * FROM experiments",
      };

      mockDataSourceIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM experiments");
      mockDataSourceIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [
          {
            experiment_id: 1,
            variation_id: 1,
            timestamp: "2022-01-01",
          },
        ],
      });

      const result = await testQueryValidity(mockDataSourceIntegration, query);

      expect(result).toBe(
        "Missing required columns in response: user_id, country, experiment_name, variation_name",
      );
      expect(
        mockDataSourceIntegration.getTestValidityQuery,
      ).toHaveBeenCalledWith(query.query, undefined, undefined, "timestamp");
      expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
        "SELECT * FROM experiments",
        undefined,
        "testQuery",
      );
    });

    it("should return undefined if test query results contain all required columns", async () => {
      const query = {
        id: "user_id",
        name: "Logged in Users",
        userIdType: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        query: "SELECT * FROM experiments",
      };

      mockDataSourceIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM experiments");
      mockDataSourceIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [
          {
            user_id: 1,
            experiment_id: 1,
            variation_id: 1,
            timestamp: "2022-01-01",
            country: "US",
            experiment_name: "A",
            variation_name: "A1",
          },
        ],
      });

      const result = await testQueryValidity(mockDataSourceIntegration, query);

      expect(result).toBeUndefined();
      expect(
        mockDataSourceIntegration.getTestValidityQuery,
      ).toHaveBeenCalledWith(query.query, undefined, undefined, "timestamp");
      expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
        "SELECT * FROM experiments",
        undefined,
        "testQuery",
      );
    });
  });

  describe("datasources with LIMIT 0 support (column metadata validation)", () => {
    it('should return "Unable to determine columns from query" if no column metadata is returned', async () => {
      const query = {
        id: "user_id",
        name: "Logged in Users",
        userIdType: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        query: "SELECT * FROM experiments",
      };

      mockLimitZeroIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM experiments LIMIT 0");
      mockLimitZeroIntegration.runTestQuery = jest
        .fn()
        .mockResolvedValue({ results: [], columns: [] });

      const result = await testQueryValidity(mockLimitZeroIntegration, query);

      expect(result).toBe("Unable to determine columns from query");
    });

    it('should return "Missing required columns in response" if column metadata does not contain all required columns', async () => {
      const query = {
        id: "user_id",
        name: "Logged in Users",
        userIdType: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        query: "SELECT * FROM experiments",
      };

      mockLimitZeroIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM experiments LIMIT 0");
      mockLimitZeroIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [],
        columns: [
          { name: "experiment_id" },
          { name: "variation_id" },
          { name: "timestamp" },
        ],
      });

      const result = await testQueryValidity(mockLimitZeroIntegration, query);

      expect(result).toBe(
        "Missing required columns in response: user_id, country, experiment_name, variation_name",
      );
    });

    it("should return undefined if column metadata contains all required columns", async () => {
      const query = {
        id: "user_id",
        name: "Logged in Users",
        userIdType: "user_id",
        dimensions: ["country"],
        hasNameCol: true,
        query: "SELECT * FROM experiments",
      };

      mockLimitZeroIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM experiments LIMIT 0");
      mockLimitZeroIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [],
        columns: [
          { name: "user_id" },
          { name: "experiment_id" },
          { name: "variation_id" },
          { name: "timestamp" },
          { name: "country" },
          { name: "experiment_name" },
          { name: "variation_name" },
        ],
      });

      const result = await testQueryValidity(mockLimitZeroIntegration, query);

      expect(result).toBeUndefined();
    });
  });

  it("should return the error message if an error occurs while running the test query", async () => {
    const query = {
      id: "user_id",
      name: "Logged in Users",
      userIdType: "user_id",
      dimensions: ["country"],
      hasNameCol: true,
      query: "SELECT * FROM experiments",
    };

    mockDataSourceIntegration.getTestValidityQuery = jest
      .fn()
      .mockReturnValue("SELECT * FROM experiments");
    mockDataSourceIntegration.runTestQuery = jest
      .fn()
      .mockRejectedValue(new Error("Test query failed"));

    const result = await testQueryValidity(mockDataSourceIntegration, query);

    expect(result).toBe("Test query failed");
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query,
      undefined,
      undefined,
      "timestamp",
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments",
      undefined,
      "testQuery",
    );
  });

  describe("column type validation", () => {
    it("should return error when timestamp column value is a non-date string — row-based inference", async () => {
      const query = {
        id: "u",
        name: "Test Query",
        userIdType: "user_id",
        dimensions: [],
        hasNameCol: false,
        query: "SELECT * FROM t",
      };

      mockDataSourceIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM t LIMIT 1");
      mockDataSourceIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [
          {
            user_id: "1",
            experiment_id: "e1",
            variation_id: "v1",
            timestamp: "not-a-date",
          },
        ],
      });

      const result = await testQueryValidity(mockDataSourceIntegration, query);

      expect(result).toBe(
        'Column "timestamp" must be date, but is string in experiment assignment query "Test Query"',
      );
    });

    it("should return error when timestamp type is string in engine metadata — BigQuery LIMIT 0", async () => {
      const query = {
        id: "u",
        name: "BigQuery Test",
        userIdType: "user_id",
        dimensions: [],
        hasNameCol: false,
        query: "SELECT * FROM t",
      };

      mockLimitZeroIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM t LIMIT 0");
      mockLimitZeroIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [],
        columns: [
          { name: "user_id", dataType: "string" },
          { name: "experiment_id", dataType: "string" },
          { name: "variation_id", dataType: "string" },
          { name: "timestamp", dataType: "string" },
        ],
      });

      const result = await testQueryValidity(mockLimitZeroIntegration, query);

      expect(result).toBe(
        'Column "timestamp" must be date, but is string in experiment assignment query "BigQuery Test"',
      );
    });

    it("should pass validation when timestamp is an ISO date string in row data", async () => {
      const query = {
        id: "u",
        name: "Valid Test",
        userIdType: "user_id",
        dimensions: [],
        hasNameCol: false,
        query: "SELECT * FROM t",
      };

      mockDataSourceIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM t LIMIT 1");
      mockDataSourceIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [
          {
            user_id: "1",
            experiment_id: "e1",
            variation_id: "v1",
            timestamp: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const result = await testQueryValidity(mockDataSourceIntegration, query);

      expect(result).toBeUndefined();
    });

    it("should pass validation when timestamp type is date in engine metadata — BigQuery LIMIT 0", async () => {
      const query = {
        id: "u",
        name: "BigQuery Date Test",
        userIdType: "user_id",
        dimensions: [],
        hasNameCol: false,
        query: "SELECT * FROM t",
      };

      mockLimitZeroIntegration.getTestValidityQuery = jest
        .fn()
        .mockReturnValue("SELECT * FROM t LIMIT 0");
      mockLimitZeroIntegration.runTestQuery = jest.fn().mockResolvedValue({
        results: [],
        columns: [
          { name: "user_id", dataType: "string" },
          { name: "experiment_id", dataType: "string" },
          { name: "variation_id", dataType: "string" },
          { name: "timestamp", dataType: "date" },
        ],
      });

      const result = await testQueryValidity(mockLimitZeroIntegration, query);

      expect(result).toBeUndefined();
    });
  });
});
