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

// IS_CLOUD is a module-level const; expose it through a getter so individual
// tests can flip it. Everything else keeps its real value. The backing store
// lives on globalThis rather than in a local binding: the getter fires during
// module IMPORT (logger reads IS_CLOUD at load), before any local declaration
// has initialized — a let/const would be in its temporal dead zone there, and
// the hoisted-`var` alternative gets auto-rewritten to `let` by eslint's
// no-var fixer at commit time (which silently broke this file once already).
type IsCloudStore = { __mockIsCloud?: boolean };
const setMockIsCloud = (value: boolean) => {
  (globalThis as IsCloudStore).__mockIsCloud = value;
};
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  get IS_CLOUD() {
    return (globalThis as IsCloudStore).__mockIsCloud ?? false;
  },
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
    setMockIsCloud(false);
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
    setMockIsCloud(true);
    expect(() =>
      buildSnowflakeConnection({
        ...baseParams,
        authMethod: "workload-identity",
        workloadIdentityProvider: "AWS",
      }),
    ).toThrow("only supported on self-hosted");
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
