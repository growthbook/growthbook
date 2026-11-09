import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { createClient } from "@clickhouse/client";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import ClickHouse from "back-end/src/integrations/ClickHouse";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: false,
}));
jest.mock("@clickhouse/client", () => ({
  createClient: jest.fn(),
  ClickHouseError: class ClickHouseError extends Error {},
  ClickHouseLogLevel: { ERROR: 4 },
}));

const mockSecrets = jest.requireMock<{ IS_CLOUD: boolean }>(
  "back-end/src/util/secrets",
);
const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

const baseParams: ClickHouseConnectionParams = {
  url: "https://clickhouse.example.com",
  port: 8443,
  username: "growthbook",
  password: "secret",
  database: "analytics",
};

describe("ClickHouse client connection", () => {
  let integration: ClickHouse;
  let dir: string;
  let caCertPath: string;
  let clientCertPath: string;
  let clientKeyPath: string;

  function lastClientConfig() {
    return mockCreateClient.mock.lastCall?.[0];
  }

  function runQuery() {
    return integration.runQuery("SELECT 1", undefined, {
      queryType: "connectionTest",
    });
  }

  beforeEach(async () => {
    mockSecrets.IS_CLOUD = false;
    dir = await mkdtemp(path.join(os.tmpdir(), "clickhouse-tls-"));
    caCertPath = path.join(dir, "ca.crt");
    clientCertPath = path.join(dir, "tls.crt");
    clientKeyPath = path.join(dir, "tls.key");
    await writeFile(caCertPath, "ca-v1");
    await writeFile(clientCertPath, "cert-v1");
    await writeFile(clientKeyPath, "key-v1");

    mockCreateClient.mockReturnValue({
      query: jest.fn().mockResolvedValue({ json: async () => ({ data: [] }) }),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof createClient>);

    // @ts-expect-error -- only the datasource type is needed for this unit test
    integration = new ClickHouse("", { type: "clickhouse" });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("uses password auth without TLS options by default", async () => {
    integration.params = {
      ...baseParams,
      url: "http://clickhouse.example.com",
    };

    await runQuery();

    const config = lastClientConfig();
    expect(config?.url).toBe("http://clickhouse.example.com:8443");
    expect(config?.username).toBe("growthbook");
    expect(config?.password).toBe("secret");
    expect(config?.tls).toBeUndefined();
  });

  it("verifies the server with a CA cert and keeps password auth", async () => {
    integration.params = { ...baseParams, caCertPath };

    await runQuery();

    const config = lastClientConfig();
    expect(config?.password).toBe("secret");
    expect(config?.tls).toEqual({ ca_cert: Buffer.from("ca-v1") });
  });

  it("uses certificate auth and does not send the password", async () => {
    integration.params = {
      ...baseParams,
      caCertPath,
      clientCertPath,
      clientKeyPath,
    };

    await runQuery();

    const config = lastClientConfig();
    expect(config?.username).toBe("growthbook");
    expect(config?.password).toBeUndefined();
    expect(config?.tls).toEqual({
      ca_cert: Buffer.from("ca-v1"),
      cert: Buffer.from("cert-v1"),
      key: Buffer.from("key-v1"),
    });
  });

  it("re-reads cert files for every query so rotation is picked up", async () => {
    integration.params = {
      ...baseParams,
      password: undefined,
      caCertPath,
      clientCertPath,
      clientKeyPath,
    };

    await runQuery();
    await writeFile(clientCertPath, "cert-v2");
    await writeFile(clientKeyPath, "key-v2");
    await runQuery();

    expect(mockCreateClient).toHaveBeenCalledTimes(2);
    expect(lastClientConfig()?.tls).toEqual({
      ca_cert: Buffer.from("ca-v1"),
      cert: Buffer.from("cert-v2"),
      key: Buffer.from("key-v2"),
    });
  });

  it.each<{
    name: string;
    params: () => Partial<ClickHouseConnectionParams>;
    error: RegExp;
  }>([
    {
      name: "a client cert without a key",
      params: () => ({ caCertPath, clientCertPath }),
      error: /must be set together/,
    },
    {
      name: "a client key without a cert",
      params: () => ({ caCertPath, clientKeyPath }),
      error: /must be set together/,
    },
    {
      name: "a client cert without a CA cert",
      params: () => ({ clientCertPath, clientKeyPath }),
      error: /CA certificate path is required/,
    },
    {
      name: "an http URL",
      params: () => ({ url: "http://clickhouse.example.com", caCertPath }),
      error: /require an https:\/\/ URL/,
    },
    {
      name: "an unreadable file",
      params: () => ({
        caCertPath,
        clientCertPath,
        clientKeyPath: path.join(dir, "missing.key"),
      }),
      error: /Unable to read ClickHouse client key file/,
    },
  ])("rejects $name", async ({ params, error }) => {
    integration.params = { ...baseParams, ...params() };

    await expect(runQuery()).rejects.toThrow(error);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects cert file paths on GrowthBook Cloud", async () => {
    mockSecrets.IS_CLOUD = true;
    integration.params = { ...baseParams, caCertPath };

    await expect(runQuery()).rejects.toThrow(
      /only supported when self-hosting/,
    );
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
