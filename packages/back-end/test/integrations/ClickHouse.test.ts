import { createClient } from "@clickhouse/client";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import ClickHouse, {
  getClickHouseTLSOptions,
  getClickHouseUrl,
} from "back-end/src/integrations/ClickHouse";

jest.mock("@clickhouse/client", () => {
  const actual = jest.requireActual("@clickhouse/client");
  return {
    ClickHouseError: actual.ClickHouseError,
    ClickHouseLogLevel: actual.ClickHouseLogLevel,
    createClient: jest.fn(),
  };
});

const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

const CA = "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----";
const CERT = "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----";

describe("getClickHouseTLSOptions", () => {
  it("returns nothing when SSL is off, even if certs are set", () => {
    expect(
      getClickHouseTLSOptions({
        ssl: false,
        caCert: CA,
        clientCert: CERT,
        clientKey: KEY,
      }),
    ).toBeUndefined();
  });

  it("returns nothing when SSL is on without certs", () => {
    expect(getClickHouseTLSOptions({ ssl: true })).toBeUndefined();
  });

  it("passes a custom CA cert", () => {
    expect(getClickHouseTLSOptions({ ssl: true, caCert: CA })).toEqual({
      ca_cert: Buffer.from(CA),
    });
  });

  it("passes a CA cert with a client cert and key for mutual TLS", () => {
    expect(
      getClickHouseTLSOptions({
        ssl: true,
        caCert: CA,
        clientCert: CERT,
        clientKey: KEY,
      }),
    ).toEqual({
      ca_cert: Buffer.from(CA),
      cert: Buffer.from(CERT),
      key: Buffer.from(KEY),
    });
  });

  it("rejects a client cert without a key", () => {
    expect(() =>
      getClickHouseTLSOptions({ ssl: true, caCert: CA, clientCert: CERT }),
    ).toThrow("Client cert and client key must be provided together.");
  });

  it("rejects a client cert without a CA cert", () => {
    expect(() =>
      getClickHouseTLSOptions({
        ssl: true,
        clientCert: CERT,
        clientKey: KEY,
      }),
    ).toThrow(
      "A CA cert is required when using a client cert with ClickHouse.",
    );
  });
});

describe("getClickHouseUrl", () => {
  it("keeps the existing http default when SSL is off", () => {
    expect(getClickHouseUrl({ url: "clickhouse.local", port: 8123 })).toBe(
      "http://clickhouse.local:8123",
    );
  });

  it("defaults a scheme-less URL to https when SSL is on", () => {
    expect(
      getClickHouseUrl({ url: "clickhouse.local", port: 8443, ssl: true }),
    ).toBe("https://clickhouse.local:8443");
  });

  it("keeps an explicit https URL", () => {
    expect(
      getClickHouseUrl({
        url: "https://clickhouse.local",
        port: 8443,
        ssl: true,
      }),
    ).toBe("https://clickhouse.local:8443");
  });

  it("rejects an http URL when SSL is on", () => {
    expect(() =>
      getClickHouseUrl({
        url: "http://clickhouse.local",
        port: 8123,
        ssl: true,
      }),
    ).toThrow(
      "SSL is required, but the ClickHouse URL uses http://. Use an https:// URL instead.",
    );
  });
});

describe("ClickHouse password with TLS", () => {
  const baseParams = {
    url: "https://clickhouse.local",
    port: 8443,
    username: "growthbook",
    password: "secret",
    database: "analytics",
    ssl: true,
    caCert: CA,
  };

  async function sentPassword(params: Partial<ClickHouseConnectionParams>) {
    mockCreateClient.mockReturnValue({
      query: jest.fn().mockResolvedValue({ json: async () => ({ data: [] }) }),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof createClient>);
    // @ts-expect-error -- only the datasource type is needed here
    const integration = new ClickHouse("", { type: "clickhouse" });
    integration.params = { ...baseParams, ...params };
    await integration.runQuery("SELECT 1", undefined, {
      queryType: "connectionTest",
    });
    return mockCreateClient.mock.lastCall?.[0]?.password;
  }

  afterEach(() => jest.clearAllMocks());

  it("keeps the password with only a CA cert", async () => {
    expect(await sentPassword({})).toBe("secret");
  });

  it("does not send the password with a client cert", async () => {
    expect(
      await sentPassword({ clientCert: CERT, clientKey: KEY }),
    ).toBeUndefined();
  });
});
