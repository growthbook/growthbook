import { processSSEEvent } from "@/enterprise/hooks/useAIChat/processSSEEvent";

describe("processSSEEvent tool preparation", () => {
  it("switches from preparing to calling when tool arguments are complete", () => {
    const started = processSSEEvent(
      {
        type: "tool-call-start",
        data: { toolName: "callApi", toolCallId: "call-1" },
      },
      [],
      { callApi: "Calling the API…" },
      () => 1,
      { callApi: "Putting together an API request…" },
    );

    expect(started.activeTurnItems?.[0]).toMatchObject({
      label: "Putting together an API request…",
      status: "running",
    });

    const ready = processSSEEvent(
      {
        type: "tool-call-input",
        data: {
          toolName: "callApi",
          toolCallId: "call-1",
          input: { method: "GET", path: "/api/v1/features" },
        },
      },
      started.activeTurnItems ?? [],
      { callApi: "Calling the API…" },
      () => 2,
      { callApi: "Putting together an API request…" },
    );

    expect(ready.activeTurnItems?.[0]).toMatchObject({
      label: "Calling the API…",
      toolInput: { method: "GET", path: "/api/v1/features" },
      status: "running",
    });
  });
});
