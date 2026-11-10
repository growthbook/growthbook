import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
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
jest.mock("fs/promises", () => {
  const actual = jest.requireActual("fs/promises");
  return { ...actual, readFile: jest.fn(actual.readFile) };
});
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: false,
  IS_MULTI_ORG: false,
}));

const mockSecrets = jest.requireMock<{
  IS_CLOUD: boolean;
  IS_MULTI_ORG: boolean;
}>("back-end/src/util/secrets");
const mockReadFile = jest.mocked(readFile);
const mockCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

const CA = "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----";
const CERT = "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----";

describe("getClickHouseTLSOptions", () => {
  it("returns nothing when SSL is off, even if certs are set", async () => {
    expect(
      await getClickHouseTLSOptions({
        ssl: false,
        caCert: CA,
        clientCert: CERT,
        clientKey: KEY,
      }),
    ).toBeUndefined();
  });

  it("returns nothing when SSL is on without certs", async () => {
    expect(await getClickHouseTLSOptions({ ssl: true })).toBeUndefined();
  });

  it("passes a custom CA cert", async () => {
    expect(await getClickHouseTLSOptions({ ssl: true, caCert: CA })).toEqual({
      ca_cert: Buffer.from(CA),
    });
  });

  it("passes a CA cert with a client cert and key for mutual TLS", async () => {
    expect(
      await getClickHouseTLSOptions({
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

  it("rejects a client cert without a key", async () => {
    await expect(
      getClickHouseTLSOptions({ ssl: true, caCert: CA, clientCert: CERT }),
    ).rejects.toThrow("Client cert and client key must be provided together.");
  });

  it("passes a client cert without a CA cert, leaving the default CAs", async () => {
    expect(
      await getClickHouseTLSOptions({
        ssl: true,
        clientCert: CERT,
        clientKey: KEY,
      }),
    ).toStrictEqual({
      cert: Buffer.from(CERT),
      key: Buffer.from(KEY),
    });
  });
});

describe("getClickHouseTLSOptions with certificate file paths", () => {
  let dir: string;
  let caCertPath: string;
  let clientCertPath: string;
  let clientKeyPath: string;

  beforeEach(async () => {
    mockSecrets.IS_CLOUD = false;
    mockSecrets.IS_MULTI_ORG = false;
    dir = await mkdtemp(path.join(os.tmpdir(), "clickhouse-tls-"));
    caCertPath = path.join(dir, "ca.crt");
    clientCertPath = path.join(dir, "tls.crt");
    clientKeyPath = path.join(dir, "tls.key");
    await writeFile(caCertPath, CA);
    await writeFile(clientCertPath, CERT);
    await writeFile(clientKeyPath, KEY);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the certs from files", async () => {
    expect(
      await getClickHouseTLSOptions({
        ssl: true,
        caCertPath,
        clientCertPath,
        clientKeyPath,
      }),
    ).toEqual({
      ca_cert: Buffer.from(CA),
      cert: Buffer.from(CERT),
      key: Buffer.from(KEY),
    });
  });

  it("re-reads the files on every call so rotation is picked up", async () => {
    const params = { ssl: true, clientCertPath, clientKeyPath };
    await getClickHouseTLSOptions(params);
    const rotated = CERT.replace("cert", "rotated");
    await writeFile(clientCertPath, rotated);

    expect((await getClickHouseTLSOptions(params))?.cert).toEqual(
      Buffer.from(rotated),
    );
  });

  it("mixes a pasted CA cert with a client cert from files", async () => {
    expect(
      await getClickHouseTLSOptions({
        ssl: true,
        caCert: CA,
        clientCertPath,
        clientKeyPath,
      }),
    ).toEqual({
      ca_cert: Buffer.from(CA),
      cert: Buffer.from(CERT),
      key: Buffer.from(KEY),
    });
  });

  it("sends the chain after a leaf-only client cert", async () => {
    const clientCertChainPath = path.join(dir, "chain.crt");
    await writeFile(clientCertChainPath, CA);

    expect(
      await getClickHouseTLSOptions({
        ssl: true,
        clientCertPath,
        clientKeyPath,
        clientCertChainPath,
      }),
    ).toStrictEqual({
      cert: Buffer.from(`${CERT}\n${CA}`),
      key: Buffer.from(KEY),
    });
  });

  it("ignores the paths when SSL is off", async () => {
    expect(
      await getClickHouseTLSOptions({
        ssl: false,
        caCertPath: path.join(dir, "missing.crt"),
      }),
    ).toBeUndefined();
  });

  it.each<{
    name: string;
    params: () => Partial<ClickHouseConnectionParams>;
    error: RegExp;
  }>([
    {
      name: "a pasted value and a path for the same cert",
      params: () => ({ caCert: CA, caCertPath }),
      error: /either the ClickHouse CA cert or its file path, not both/,
    },
    {
      name: "a chain without a client cert",
      params: () => ({ caCertPath, clientCertChainPath: caCertPath }),
      error: /client cert chain requires a client cert/,
    },
    {
      name: "a client cert path without a key",
      params: () => ({ clientCertPath }),
      error: /must be provided together/,
    },
    {
      name: "a file that can't be read",
      params: () => ({ caCertPath: path.join(dir, "missing.crt") }),
      error: /Unable to read the ClickHouse CA cert file/,
    },
  ])("rejects $name", async ({ params, error }) => {
    await expect(
      getClickHouseTLSOptions({ ssl: true, ...params() }),
    ).rejects.toThrow(error);
  });

  it("re-reads once when a rotation pairs the old cert with the new key", async () => {
    const pair = (name: string) => {
      const [cert, key] = [`${name}.crt`, `${name}.key`].map((f) =>
        path.join(dir, f),
      );
      const args = "req -x509 -newkey rsa:2048 -nodes -days 1 -subj".split(" ");
      execFileSync(
        "openssl",
        [...args, `/CN=${name}`, "-keyout", key, "-out", cert],
        { stdio: "ignore" },
      );
      return { cert: readFileSync(cert), key: readFileSync(key) };
    };
    const current = pair("current");
    const stale = pair("stale");
    await writeFile(clientCertPath, current.cert);
    await writeFile(clientKeyPath, current.key);
    // The first key read lands just after the Secret swapped in a new pair
    const realReadFile = jest.requireActual("fs/promises").readFile;
    let keyReads = 0;
    mockReadFile.mockImplementation((async (file: string) =>
      file === clientKeyPath && keyReads++ === 0
        ? stale.key
        : realReadFile(file)) as typeof readFile);

    try {
      const tls = await getClickHouseTLSOptions({
        ssl: true,
        clientCertPath,
        clientKeyPath,
      });

      expect(keyReads).toBe(2);
      expect(tls).toStrictEqual({ cert: current.cert, key: current.key });
    } finally {
      mockReadFile.mockImplementation(realReadFile);
    }
  });

  it("rejects a path that isn't a regular file", async () => {
    const fifo = path.join(dir, "pipe");
    execFileSync("mkfifo", [fifo]);

    for (const caCertPath of [dir, fifo]) {
      await expect(
        getClickHouseTLSOptions({ ssl: true, caCertPath }),
      ).rejects.toThrow(/expected a regular file/);
    }
  });

  it("rejects a file over 1 MB", async () => {
    const big = path.join(dir, "big.crt");
    await writeFile(big, CA + " ".repeat(1024 * 1024));

    await expect(
      getClickHouseTLSOptions({ ssl: true, caCertPath: big }),
    ).rejects.toThrow(/at most 1 MB/);
  });

  it("rejects an empty file without echoing its contents", async () => {
    const empty = path.join(dir, "empty.key");
    await writeFile(empty, "");

    await expect(
      getClickHouseTLSOptions({
        ssl: true,
        clientCertPath,
        clientKeyPath: empty,
      }),
    ).rejects.toThrow(/client key file .* is empty or not PEM-encoded/);
  });

  it.each(["IS_CLOUD", "IS_MULTI_ORG"] as const)(
    "rejects file paths when %s is set",
    async (flag) => {
      mockSecrets[flag] = true;

      await expect(
        getClickHouseTLSOptions({ ssl: true, caCertPath }),
      ).rejects.toThrow(/single organization/);
    },
  );
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
