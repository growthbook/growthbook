import { createConnection } from "snowflake-sdk";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { buildSnowflakeConnection } from "back-end/src/services/snowflake";

jest.mock("snowflake-sdk", () => ({
  createConnection: jest.fn(() => ({})),
}));

// snowflake.ts only needs TEST_QUERY_SQL from SqlIntegration; importing the real
// module drags in a circular import chain that breaks under jest's module order.
jest.mock("back-end/src/integrations/SqlIntegration", () => ({
  TEST_QUERY_SQL: "select 1",
}));

const baseParams: SnowflakeConnectionParams = {
  account: "xy12345",
  username: "GB_USER",
  password: "",
  database: "DB",
  schema: "PUBLIC",
};

function connectionOptions(): Record<string, unknown> {
  return (createConnection as jest.Mock).mock.calls[0][0];
}

describe("buildSnowflakeConnection auth methods", () => {
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
    // secretless: no stored-credential fields on the connection
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

  it("defaults to password auth when authMethod is unset", () => {
    buildSnowflakeConnection({ ...baseParams, password: "hunter2" });

    const opts = connectionOptions();
    expect(opts.password).toBe("hunter2");
    expect(opts.authenticator).toBeUndefined();
    expect(opts.workloadIdentityProvider).toBeUndefined();
  });
});
