import type { ModelMessage } from "ai";
import { _withAnthropicCacheBreakpoint } from "back-end/src/enterprise/services/ai";

describe("Anthropic rolling cache breakpoint", () => {
  it("keeps the system breakpoint and moves the rolling breakpoint to the latest message", () => {
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: "Stable instructions",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      {
        role: "user",
        content: "Initial request",
        providerOptions: {
          anthropic: {
            cacheControl: { type: "ephemeral" },
            customOption: true,
          },
        },
      },
      {
        role: "assistant",
        content: "Intermediate response",
      },
    ];

    const result = _withAnthropicCacheBreakpoint(messages);

    expect(result[0]?.providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
    expect(result[1]?.providerOptions?.anthropic).toEqual({
      customOption: true,
    });
    expect(result[2]?.providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    });
  });
});
