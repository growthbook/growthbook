import { testQueryValidity } from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

// @ts-expect-error - we are not testing all the properties of the integration
const mockDataSourceIntegration: SourceIntegrationInterface = {
  getTestValidityQuery: jest.fn(),
  runTestQuery: jest.fn(),
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
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query,
      undefined,
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments",
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
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query,
      undefined,
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments",
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
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query,
      undefined,
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments",
    );
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
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments",
    );
  });
});
