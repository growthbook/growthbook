import type { LookupAddress } from "node:dns";

type EndpointModule = typeof import("back-end/src/services/aiEndpoint");

const undiciFetch = jest.fn();
const AgentMock = jest.fn();
const ProxyAgentMock = jest.fn();
jest.mock("undici", () => ({
  fetch: (...args: unknown[]) => undiciFetch(...args),
  Agent: function (opts: unknown) {
    AgentMock(opts);
  },
  ProxyAgent: function (url: unknown) {
    ProxyAgentMock(url);
  },
}));

const dnsLookup = jest.fn();
jest.mock("node:dns", () => ({
  lookup: (...args: unknown[]) => dnsLookup(...args),
}));

const loadModule = (env: Record<string, string> = {}): EndpointModule => {
  let mod: EndpointModule | undefined;
  jest.isolateModules(() => {
    jest.doMock("back-end/src/util/secrets", () => ({
      ...jest.requireActual("back-end/src/util/secrets"),
      IS_CLOUD: true,
      WEBHOOK_PROXY: env.WEBHOOK_PROXY ?? "",
    }));
    mod = jest.requireActual<EndpointModule>(
      "back-end/src/services/aiEndpoint",
    );
  });
  if (!mod) throw new Error("Could not load aiEndpoint");
  return mod;
};

const resolveTo = (...addresses: string[]) =>
  dnsLookup.mockImplementation((_host, _opts, cb) =>
    cb(
      null,
      addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })) as LookupAddress[],
    ),
  );

const runLookup = (mod: EndpointModule, all: boolean) =>
  new Promise<{ err: Error | null; result: unknown }>((resolve) =>
    mod.publicOnlyLookup("gateway.example.com", { all }, (err, result) =>
      resolve({ err, result }),
    ),
  );

beforeEach(() => {
  undiciFetch.mockReset().mockResolvedValue({ status: 200, ok: true });
  AgentMock.mockReset();
  ProxyAgentMock.mockReset();
  dnsLookup.mockReset();
});

describe("guardedAIFetch", () => {
  it.each([
    "http://gateway.example.com/v1/models",
    "https://127.0.0.1/v1/models",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/v1/models",
    "https://10.0.0.5/v1/models",
  ])("refuses %s without connecting", async (url) => {
    const mod = loadModule();
    await expect(mod.guardedAIFetch(url)).rejects.toBeInstanceOf(
      mod.NonPublicAIEndpointError,
    );
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it("refuses redirects and connects through the DNS-checking agent", async () => {
    const mod = loadModule();
    await mod.guardedAIFetch("https://gateway.example.com/v1/models", {
      method: "GET",
    });

    const [, init] = undiciFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect(AgentMock).toHaveBeenCalledWith({
      connect: { lookup: mod.publicOnlyLookup },
    });
    expect(ProxyAgentMock).not.toHaveBeenCalled();
  });

  it("goes through WEBHOOK_PROXY when one is set", async () => {
    const mod = loadModule({ WEBHOOK_PROXY: "http://smokescreen:4750" });
    await mod.guardedAIFetch("https://gateway.example.com/v1/models");

    expect(ProxyAgentMock).toHaveBeenCalledWith("http://smokescreen:4750");
    expect(AgentMock).not.toHaveBeenCalled();
  });
});

describe("publicOnlyLookup", () => {
  it("passes public answers through", async () => {
    const mod = loadModule();
    resolveTo("104.18.32.7", "2606:4700::6810:1");

    expect((await runLookup(mod, true)).result).toEqual([
      { address: "104.18.32.7", family: 4 },
      { address: "2606:4700::6810:1", family: 6 },
    ]);
    expect((await runLookup(mod, false)).err).toBeNull();
  });

  it.each([
    [["127.0.0.1"]],
    [["169.254.169.254"]],
    [["104.18.32.7", "10.0.0.5"]],
    [["2606:4700::6810:1", "::1"]],
    [[]],
  ])("refuses %j", async (addresses) => {
    const mod = loadModule();
    resolveTo(...addresses);

    const { err } = await runLookup(mod, true);
    expect(err).toBeInstanceOf(mod.NonPublicAIEndpointError);
  });

  it("is recognized after undici wraps it", () => {
    const mod = loadModule();
    const wrapped = Object.assign(new TypeError("fetch failed"), {
      cause: new mod.NonPublicAIEndpointError("blocked"),
    });
    expect(mod.isNonPublicAIEndpointError(wrapped)).toBe(true);
    expect(mod.isNonPublicAIEndpointError(new Error("ECONNRESET"))).toBe(false);
  });
});
