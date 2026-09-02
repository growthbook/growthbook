import { extractExplorationResultData } from "@/enterprise/hooks/useAIChat/extractExplorationResultData";
import { processSSEEvent } from "@/enterprise/hooks/useAIChat/processSSEEvent";
import type { ActiveTurnItem } from "@/enterprise/hooks/useAIChat/types";

const config = { type: "metric", chartType: "line" };
const exploration = { status: "success", config };
const body = { exploration };
const successfulOutput = { status: 200, body };

describe("extractExplorationResultData", () => {
  it.each([
    "/api/v1/product-analytics/metric-exploration",
    "/api/v1/product-analytics/fact-table-exploration/",
    "/v1/product-analytics/data-source-exploration?cache=never",
    "/product-analytics/funnel-exploration",
  ])("extracts successful callApi exploration responses for %s", (path) => {
    expect(
      extractExplorationResultData(
        "callApi",
        { method: "POST", path },
        successfulOutput,
      ),
    ).toEqual(body);
  });

  it("accepts serialized persisted callApi output", () => {
    expect(
      extractExplorationResultData(
        "callApi",
        {
          method: "POST",
          path: "/api/v1/product-analytics/metric-exploration",
        },
        JSON.stringify(successfulOutput),
      ),
    ).toEqual(body);
  });

  it.each([
    {
      name: "another tool",
      toolName: "search",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      },
      output: successfulOutput,
    },
    {
      name: "a non-POST method",
      toolName: "callApi",
      input: {
        method: "GET",
        path: "/api/v1/product-analytics/metric-exploration",
      },
      output: successfulOutput,
    },
    {
      name: "an unrecognized endpoint",
      toolName: "callApi",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration/extra",
      },
      output: successfulOutput,
    },
    {
      name: "a non-2xx response",
      toolName: "callApi",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      },
      output: { status: 400, body },
    },
    {
      name: "a running exploration",
      toolName: "callApi",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      },
      output: {
        status: 200,
        body: { exploration: { status: "running", config } },
      },
    },
    {
      name: "an errored exploration",
      toolName: "callApi",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      },
      output: {
        status: 200,
        body: { exploration: { status: "error", config } },
      },
    },
    {
      name: "a missing chart config",
      toolName: "callApi",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      },
      output: {
        status: 200,
        body: { exploration: { status: "success" } },
      },
    },
    {
      name: "malformed output",
      toolName: "callApi",
      input: {
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      },
      output: "{not json",
    },
  ])("rejects $name", ({ toolName, input, output }) => {
    expect(
      extractExplorationResultData(toolName, input, output),
    ).toBeUndefined();
  });

  it("retains runExploration extraction and its normalized top-level config", () => {
    const normalizedConfig = { ...config, chartType: "bar" };
    expect(
      extractExplorationResultData("runExploration", undefined, {
        status: "success",
        snapshotId: "snapshot-1",
        exploration,
        config: normalizedConfig,
      }),
    ).toEqual({
      snapshotId: "snapshot-1",
      exploration,
      config: normalizedConfig,
    });
  });

  it("rejects unsuccessful and malformed runExploration output", () => {
    expect(
      extractExplorationResultData("runExploration", undefined, {
        status: "error",
        exploration,
      }),
    ).toBeUndefined();
    expect(
      extractExplorationResultData("runExploration", undefined, {
        status: "success",
        exploration: { status: "success" },
      }),
    ).toBeUndefined();
  });
});

describe("processSSEEvent callApi exploration results", () => {
  it("uses the previously streamed tool input to populate toolResultData", () => {
    const currentItems: ActiveTurnItem[] = [
      {
        kind: "tool-status",
        id: "call-1",
        toolCallId: "call-1",
        toolName: "callApi",
        label: "Calling API",
        status: "running",
        toolInput: {
          method: "POST",
          path: "/api/v1/product-analytics/metric-exploration",
        },
      },
    ];

    const result = processSSEEvent(
      {
        type: "tool-call-end",
        data: {
          toolCallId: "call-1",
          toolName: "callApi",
          output: successfulOutput,
        },
      },
      currentItems,
      {},
      () => 1,
    );

    expect(result.activeTurnItems?.[0]).toMatchObject({
      status: "done",
      toolResultData: body,
      toolOutput: successfulOutput,
    });
  });
});
