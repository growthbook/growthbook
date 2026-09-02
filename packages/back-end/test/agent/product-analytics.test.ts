import {
  isProductAnalyticsExplorationRequest,
  pollProductAnalyticsExploration,
} from "back-end/src/agent/product-analytics";

const explorationPaths = ["metric", "fact-table", "data-source", "funnel"].map(
  (type) => `/api/v1/product-analytics/${type}-exploration`,
);

describe("Product Analytics callApi recognition", () => {
  it.each(explorationPaths)("recognizes %s", (path) => {
    expect(isProductAnalyticsExplorationRequest({ method: "POST", path })).toBe(
      true,
    );
  });

  it("rejects wrong methods, versions, and unrelated paths", () => {
    expect(
      isProductAnalyticsExplorationRequest({
        method: "GET",
        path: explorationPaths[0],
      }),
    ).toBe(false);
    expect(
      isProductAnalyticsExplorationRequest({
        method: "POST",
        path: "/api/v2/product-analytics/metric-exploration",
      }),
    ).toBe(false);
    expect(
      isProductAnalyticsExplorationRequest({
        method: "POST",
        path: "/api/v1/experiments/exp_1/snapshot",
      }),
    ).toBe(false);
  });
});

function explorationResult(status: "running" | "success" | "error") {
  return {
    status: 200,
    body: {
      exploration: {
        id: "ae_1",
        status,
        result: { rows: status === "success" ? [{ dimensions: [] }] : [] },
      },
    },
  };
}

describe("pollProductAnalyticsExploration", () => {
  it("polls running explorations by id", async () => {
    const getExploration = jest
      .fn()
      .mockResolvedValue(explorationResult("success"));

    const result = await pollProductAnalyticsExploration(
      explorationResult("running"),
      getExploration,
      { wait: async () => {} },
    );

    expect(result).toEqual(explorationResult("success"));
    expect(getExploration).toHaveBeenCalledWith("ae_1");
  });

  it("returns a terminal exploration error", async () => {
    const result = await pollProductAnalyticsExploration(
      explorationResult("running"),
      async () => explorationResult("error"),
      { wait: async () => {} },
    );

    expect(result).toEqual(explorationResult("error"));
  });

  it("propagates cancellation from the tool AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      pollProductAnalyticsExploration(
        explorationResult("running"),
        async () => explorationResult("success"),
        {
          signal: controller.signal,
          wait: async (_ms, signal) => {
            signal?.throwIfAborted();
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns a clear pending result on timeout", async () => {
    const times = [0, 100];
    const result = await pollProductAnalyticsExploration(
      explorationResult("running"),
      async () => explorationResult("success"),
      {
        timeoutMs: 50,
        now: () => times.shift() ?? 100,
        wait: async () => {},
      },
    );

    expect(result).toMatchObject({
      status: 200,
      body: {
        pollingTimedOut: true,
        message: expect.stringContaining("ae_1"),
        exploration: { status: "running" },
      },
    });
  });
});
