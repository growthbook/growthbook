import { getSourceIntegrationObject } from "../../src/services/datasource";
import { DataSourceInterface } from "../../types/datasource";

jest.mock("../../src/services/datasource");
const { testQueryValidity } = jest.requireActual(
  "../../src/services/datasource"
);

const mockDataSourceIntegration = {
  getTestValidityQuery: jest.fn(),
  runTestQuery: jest.fn(),
};

const mockedGetSourceIntegrationObject: jest.MockedFunction<
  typeof getSourceIntegrationObject
> = getSourceIntegrationObject as jest.MockedFunction<
  typeof getSourceIntegrationObject
>;

const mockDataSource: DataSourceInterface = {
  id: "123",
  organization: "test",
  name: "Test Data Source",
  type: "postgres",
  description: "desc",
  params: "params",
  settings: {
    queries: {
      exposure: [
        {
          id: "anonymous_id",
          userIdType: "anonymous_id",
          dimensions: ["device", "browser"],
          name: "Anonymous Visitors",
          description: "",
          query: "SELECT anonymous_id FROM experiment_viewed",
        },
        {
          id: "user_id",
          userIdType: "user_id",
          dimensions: ["device", "browser"],
          name: "Logged in Users",
          description: "",
          query: "SELECT bad query",
          error: "Error: bad query",
        },
      ],
    },
  },
  dateCreated: new Date(),
  dateUpdated: new Date(),
};

describe("testQueryValidity", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetSourceIntegrationObject.mockReturnValue(mockDataSourceIntegration);
  });

  it("should return undefined if integration does not support test queries", async () => {
    // @ts-expect-error - we are testing something similar to mixpanel which doesn't have the functions
    mockedGetSourceIntegrationObject.mockReturnValue({});

    const query = {
      id: "user_id",
      name: "Logged in Users",
      userIdType: "user_id",
      dimensions: ["country"],
      hasNameCol: true,
      query: "SELECT * FROM experiments",
    };

    const result = await testQueryValidity(mockDataSource, query);

    expect(result).toBeUndefined();
  });

  it('should return "No rows returned" if test query returns no results', async () => {
    const query = {
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

    const result = await testQueryValidity(mockDataSource, query);

    expect(result).toBe("No rows returned");
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments"
    );
  });

  it('should return "Missing required columns in response" if test query results do not contain all required columns', async () => {
    const query = {
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

    const result = await testQueryValidity(mockDataSource, query);

    expect(result).toBe(
      "Missing required columns in response: user_id, country, experiment_name, variation_name"
    );
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments"
    );
  });

  it("should return undefined if test query results contain all required columns", async () => {
    const query = {
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

    const result = await testQueryValidity(mockDataSource, query);

    expect(result).toBeUndefined();
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments"
    );
  });

  it("should return the error message if an error occurs while running the test query", async () => {
    const query = {
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

    const result = await testQueryValidity(mockDataSource, query);

    expect(result).toBe("Test query failed");
    expect(mockDataSourceIntegration.getTestValidityQuery).toHaveBeenCalledWith(
      query.query
    );
    expect(mockDataSourceIntegration.runTestQuery).toHaveBeenCalledWith(
      "SELECT * FROM experiments"
    );
  });
});
