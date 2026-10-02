import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";

jest.mock("snowflake-sdk", () => ({
  createConnection: jest.fn(() => ({})),
}));

// The real module drags in a circular import chain; only TEST_QUERY_SQL is needed.
jest.mock("back-end/src/integrations/SqlIntegration", () => ({
  TEST_QUERY_SQL: "select 1",
}));

type SnowflakeModule = typeof import("back-end/src/services/snowflake");

// IS_CLOUD is captured at module load, so each case builds its own module instance.
const loadModule = (isCloud: boolean) => {
  let buildSnowflakeConnection:
    | SnowflakeModule["buildSnowflakeConnection"]
    | undefined;
  let createConnection: jest.Mock | undefined;
  jest.isolateModules(() => {
    jest.doMock("back-end/src/util/secrets", () => ({
      ...jest.requireActual("back-end/src/util/secrets"),
      IS_CLOUD: isCloud,
    }));
    ({ buildSnowflakeConnection } = jest.requireActual<SnowflakeModule>(
      "back-end/src/services/snowflake",
    ));
    ({ createConnection } = jest.requireMock<{ createConnection: jest.Mock }>(
      "snowflake-sdk",
    ));
  });
  return {
    buildSnowflakeConnection: buildSnowflakeConnection!,
    createConnection: createConnection!,
  };
};

const baseParams: SnowflakeConnectionParams = {
  account: "xy12345",
  username: "GB_USER",
  password: "",
  database: "DB",
  schema: "PUBLIC",
};

describe("buildSnowflakeConnection auth methods", () => {
  const { buildSnowflakeConnection, createConnection } = loadModule(false);
  const connectionOptions = (): Record<string, unknown> =>
    createConnection.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes WORKLOAD_IDENTITY and the provider for workload-identity", () => {
    buildSnowflakeConnection({
      ...baseParams,
      authMethod: "workload-identity",
      workloadIdentityProvider: "AWS",
    });

    const opts = connectionOptions();
    expect(opts.authenticator).toBe("WORKLOAD_IDENTITY");
    expect(opts.workloadIdentityProvider).toBe("AWS");
    expect(opts.password).toBeUndefined();
    expect(opts.privateKey).toBeUndefined();
  });

  it("throws before connecting when workload-identity has no provider", () => {
    expect(() =>
      buildSnowflakeConnection({
        ...baseParams,
        authMethod: "workload-identity",
      }),
    ).toThrow("Workload Identity authentication requires a cloud provider");
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("rejects an unsupported workload-identity provider before connecting", () => {
    expect(() =>
      buildSnowflakeConnection({
        ...baseParams,
        authMethod: "workload-identity",
        // @ts-expect-error direct API requests are not constrained by the union type
        workloadIdentityProvider: "aws",
      }),
    ).toThrow("requires a cloud provider");
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("rejects workload-identity on GrowthBook Cloud before connecting", () => {
    const cloud = loadModule(true);
    expect(() =>
      cloud.buildSnowflakeConnection({
        ...baseParams,
        authMethod: "workload-identity",
        workloadIdentityProvider: "AWS",
      }),
    ).toThrow("only supported on self-hosted");
    expect(cloud.createConnection).not.toHaveBeenCalled();
  });

  it("defaults to password auth when authMethod is unset", () => {
    buildSnowflakeConnection({ ...baseParams, password: "hunter2" });

    const opts = connectionOptions();
    expect(opts.password).toBe("hunter2");
    expect(opts.authenticator).toBeUndefined();
    expect(opts.workloadIdentityProvider).toBeUndefined();
  });
});

describe("snowflakeMonitoringToStatistics", () => {
  // Loaded lazily so it doesn't share a module instance with the isolated
  // IS_CLOUD cases above
  let snowflakeMonitoringToStatistics: SnowflakeModule["snowflakeMonitoringToStatistics"];
  beforeAll(() => {
    ({ snowflakeMonitoringToStatistics } = jest.requireActual<SnowflakeModule>(
      "back-end/src/services/snowflake",
    ));
  });

  // Trimmed from real /monitoring/queries/{id} responses
  const response = (query: Record<string, unknown>) => ({
    data: { queries: [query] },
  });

  it("maps warehouse execution stats", () => {
    expect(
      snowflakeMonitoringToStatistics(
        response({
          startTime: 1790906152954,
          endTime: 1790906165101,
          warehouseName: "GB_WH",
          warehouseExternalSize: "X-Small",
          clusterNumber: 1,
          stats: {
            xpExecTime: 9792,
            scanBytes: 4644879984,
            scanFiles: 2,
            scanOriginalFiles: 291,
            queuedLoadTime: 1479,
            queuedResumeTime: 453,
            ioLocalTempWriteBytes: 573087744,
          },
        }),
      ),
    ).toEqual({
      executionDurationMs: 9792,
      bytesProcessed: 4644879984,
      partitionsScanned: 2,
      partitionsTotal: 291,
      queuedOverloadMs: 1479,
      queuedProvisioningMs: 453,
      bytesSpilledLocal: 573087744,
      bytesSpilledRemote: 0,
      warehouseStartTime: 1790906152954,
      warehouseEndTime: 1790906165101,
      warehouseName: "GB_WH",
      warehouseSize: "X-Small",
      warehouseClusterNumber: 1,
    });
  });

  it("reports zeros for a query that used no warehouse", () => {
    const statistics = snowflakeMonitoringToStatistics(
      response({
        warehouseName: "GB_WH",
        warehouseExternalSize: null,
        clusterNumber: -1,
        stats: { gsExecTime: 25, compilationTime: 145 },
      }),
    );
    expect(statistics).toMatchObject({
      executionDurationMs: 0,
      bytesProcessed: 0,
      warehouseClusterNumber: -1,
    });
    expect(statistics?.warehouseSize).toBeUndefined();
  });

  it("returns undefined for an unexpected response", () => {
    expect(snowflakeMonitoringToStatistics({ data: { queries: [] } })).toBe(
      undefined,
    );
    expect(snowflakeMonitoringToStatistics({ success: false })).toBe(undefined);
    expect(snowflakeMonitoringToStatistics(null)).toBe(undefined);
  });
});
