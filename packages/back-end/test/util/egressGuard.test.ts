import http from "http";
import type { AddressInfo } from "net";
import {
  getGuardedAgent,
  isBlockedAddress,
} from "back-end/src/util/egressGuard";
import { cancellableFetch } from "back-end/src/util/http.util";

let mockBlockPrivate = false;
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  get WEBHOOK_BLOCK_PRIVATE_NETWORKS() {
    return mockBlockPrivate;
  },
}));

function get(url: string) {
  return new Promise<void>((resolve, reject) => {
    const req = http.get(url, { agent: getGuardedAgent(new URL(url)) }, () =>
      resolve(),
    );
    req.on("error", reject);
  });
}

afterEach(() => {
  mockBlockPrivate = false;
});

describe("isBlockedAddress", () => {
  it.each([
    "169.254.169.254",
    "169.254.170.2",
    "100.100.100.200",
    "fe80::1",
    "fd00:ec2::254",
    "::ffff:169.254.169.254",
  ])("always blocks %s", (address) => {
    expect(isBlockedAddress(address, false)).toBe(true);
  });

  it.each(["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "::1"])(
    "blocks %s only when private networks are blocked",
    (address) => {
      expect(isBlockedAddress(address, false)).toBe(false);
      expect(isBlockedAddress(address, true)).toBe(true);
    },
  );

  it.each(["8.8.8.8", "2606:4700:4700::1111"])("allows %s", (address) => {
    expect(isBlockedAddress(address, true)).toBe(false);
  });
});

describe("getGuardedAgent", () => {
  it("rejects a metadata IP literal before connecting", async () => {
    await expect(
      get("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow("Requests to 169.254.169.254 are not allowed");
  });

  it("rejects an IPv4-mapped IPv6 literal", async () => {
    await expect(get("http://[::ffff:169.254.169.254]/")).rejects.toThrow(
      "are not allowed",
    );
  });

  it("rejects a hostname that resolves to a blocked address", async () => {
    mockBlockPrivate = true;
    await expect(get("http://localhost:1/healthcheck")).rejects.toThrow(
      "are not allowed",
    );
  });
});

describe("cancellableFetch", () => {
  const abortOptions = { maxTimeMs: 2000, maxContentSize: 1000 };
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const location = { "/to-http": "http:", "/to-https": "https:" }[
        req.url ?? ""
      ];
      if (location) {
        res.writeHead(302, { Location: `${location}//169.254.169.254/` });
      } else {
        res.writeHead(200);
      }
      res.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("allows a permitted URL", async () => {
    const { responseWithoutBody, stringBody } = await cancellableFetch(
      `${base}/ok`,
      {},
      abortOptions,
    );
    expect(responseWithoutBody.status).toBe(200);
    expect(stringBody).toBe("ok");
  });

  it.each(["/to-http", "/to-https"])(
    "rejects a redirect from %s to a blocked address",
    async (path) => {
      await expect(
        cancellableFetch(`${base}${path}`, {}, abortOptions),
      ).rejects.toThrow("Requests to 169.254.169.254 are not allowed");
    },
  );
});
