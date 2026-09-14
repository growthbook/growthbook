import nodeFetch from "node-fetch";
import { cancellableFetch, getHttpOptions } from "back-end/src/util/http.util";

// proxy-agent is stubbed in jest.config.js, so assert on the agent's presence, not its class.
jest.mock("node-fetch");
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  WEBHOOK_PROXY: "http://smokescreen.test:4750",
  USE_PROXY: false,
}));

const mockedFetch = nodeFetch as unknown as jest.Mock;

function proxyRefused() {
  const err = new Error(
    "request to https://example.com/hook failed, reason: connect ECONNREFUSED 10.0.1.131:4750",
  ) as Error & { code: string };
  err.name = "FetchError";
  err.code = "ECONNREFUSED";
  return err;
}

const abortOptions = { maxTimeMs: 1000, maxContentSize: 1000 };

describe("cancellableFetch with WEBHOOK_PROXY set", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("routes requests through the proxy agent", () => {
    expect(getHttpOptions().agent).toBeDefined();
  });

  it("keeps using the proxy after the proxy refuses a connection", async () => {
    mockedFetch.mockRejectedValueOnce(proxyRefused());
    await expect(
      cancellableFetch("https://example.com/hook", {}, abortOptions),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });

    mockedFetch.mockRejectedValueOnce(proxyRefused());
    await expect(
      cancellableFetch("https://example.com/hook", {}, abortOptions),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    for (const [, init] of mockedFetch.mock.calls) {
      expect(init.agent).toBeDefined();
    }
  });
});
