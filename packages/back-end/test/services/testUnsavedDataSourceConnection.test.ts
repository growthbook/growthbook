import { DataSourceInterface } from "shared/types/datasource";
import { testUnsavedDataSourceConnection } from "back-end/src/services/datasource";
import { closeMssqlPool } from "back-end/src/util/mssqlPoolManager";
import { ReqContext } from "back-end/types/request";

const mockTestConnection = jest.fn();
const mockTestedIds: string[] = [];

jest.mock("back-end/src/integrations/Postgres", () => ({
  __esModule: true,
  default: jest
    .fn()
    .mockImplementation((ctx: unknown, datasource: DataSourceInterface) => {
      mockTestedIds.push(datasource.id);
      return { testConnection: mockTestConnection };
    }),
}));

jest.mock("back-end/src/util/mssqlPoolManager", () => ({
  closeMssqlPool: jest.fn().mockResolvedValue(undefined),
}));

const context = {} as ReqContext;

const datasource = {
  id: "ds_saved",
  name: "Saved",
  description: "",
  organization: "org_1",
  type: "postgres",
  params: "",
  settings: {},
  projects: [],
  dateCreated: null,
  dateUpdated: null,
} as DataSourceInterface;

describe("testUnsavedDataSourceConnection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTestedIds.length = 0;
  });

  it("tests under a throwaway id and closes that id's pool", async () => {
    mockTestConnection.mockResolvedValue(true);

    await testUnsavedDataSourceConnection(context, datasource);

    expect(mockTestConnection).toHaveBeenCalledTimes(1);
    expect(mockTestedIds).toHaveLength(1);
    const [testedId] = mockTestedIds;
    expect(testedId).not.toBe(datasource.id);
    expect(closeMssqlPool).toHaveBeenCalledTimes(1);
    expect(closeMssqlPool).toHaveBeenCalledWith(testedId);
  });

  it("uses a different id for each test", async () => {
    mockTestConnection.mockResolvedValue(true);

    await testUnsavedDataSourceConnection(context, datasource);
    await testUnsavedDataSourceConnection(context, datasource);

    expect(mockTestedIds[0]).not.toBe(mockTestedIds[1]);
  });

  it("closes the pool and rethrows when the connection fails", async () => {
    mockTestConnection.mockRejectedValue(new Error("connection refused"));

    await expect(
      testUnsavedDataSourceConnection(context, datasource),
    ).rejects.toThrow("connection refused");

    expect(closeMssqlPool).toHaveBeenCalledTimes(1);
    expect(closeMssqlPool).toHaveBeenCalledWith(mockTestedIds[0]);
  });
});
