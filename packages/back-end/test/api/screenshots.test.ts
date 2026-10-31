import type { ModelMessage } from "ai";
import {
  attachScreenshots,
  PREVIEW_SCREENSHOT_TOOL,
  SCREENSHOTS_PER_TURN_MAX,
  screenshotsShown,
} from "back-end/src/api/visual-editor-ai/screenshots";

const png = Buffer.from("fake-png").toString("base64");

const callStep = (
  calls: Array<{ id: string; tool: string }>,
): ModelMessage => ({
  role: "assistant",
  content: calls.map((c) => ({
    type: "tool-call" as const,
    toolCallId: c.id,
    toolName: c.tool,
    input: {},
  })),
});

const shownResult = (id: string): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: id,
      toolName: PREVIEW_SCREENSHOT_TOOL,
      output: { type: "json", value: { ok: true, shown: true } },
    },
  ],
});

// One pending screenshot call alongside a pending getInnerHTML call.
const pending: ModelMessage[] = [
  callStep([
    { id: "s1", tool: PREVIEW_SCREENSHOT_TOOL },
    { id: "h1", tool: "getInnerHTML" },
  ]),
];

describe("attachScreenshots", () => {
  it("marks the result shown and builds one labelled image message", () => {
    const res = attachScreenshots(
      pending,
      [
        {
          toolCallId: "s1",
          toolName: PREVIEW_SCREENSHOT_TOOL,
          result: { ok: true, width: 800, height: 400 },
        },
        { toolCallId: "h1", toolName: "getInnerHTML", result: { ok: true } },
      ],
      [{ toolCallId: "s1", data: png, mimeType: "image/jpeg" }],
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.results[0].result).toMatchObject({
      ok: true,
      width: 800,
      height: 400,
      shown: true,
    });
    // Other tools' results pass through untouched.
    expect(res.results[1].result).toEqual({ ok: true });
    expect(res.message?.role).toBe("user");
    const content = res.message?.content;
    if (!Array.isArray(content)) throw new Error("expected content parts");
    expect(content.map((p) => p.type)).toEqual(["text", "image"]);
    expect(content[0]).toMatchObject({ text: expect.stringContaining("s1") });
    expect(content[1]).toMatchObject({ mediaType: "image/jpeg" });
  });

  it("builds no message when the extension reports a capture failure", () => {
    const failure = { ok: false, error: "tab-not-visible" };
    const res = attachScreenshots(
      pending,
      [
        {
          toolCallId: "s1",
          toolName: PREVIEW_SCREENSHOT_TOOL,
          result: failure,
        },
      ],
      [],
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.message).toBeNull();
    expect(res.results[0].result).toEqual(failure);
  });

  it("turns a claimed success without an image into an error", () => {
    const res = attachScreenshots(
      pending,
      [
        {
          toolCallId: "s1",
          toolName: PREVIEW_SCREENSHOT_TOOL,
          result: { ok: true },
        },
      ],
      [],
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.message).toBeNull();
    expect(res.results[0].result).toMatchObject({ ok: false });
  });

  it("rejects an image that doesn't answer a pending screenshot call", () => {
    for (const toolCallId of ["h1", "nope"]) {
      const res = attachScreenshots(
        pending,
        [],
        [{ toolCallId, data: png, mimeType: "image/png" }],
      );
      expect(res.ok).toBe(false);
    }
  });

  it("rejects two images for the same call", () => {
    const res = attachScreenshots(
      pending,
      [],
      [
        { toolCallId: "s1", data: png, mimeType: "image/png" },
        { toolCallId: "s1", data: png, mimeType: "image/png" },
      ],
    );
    expect(res.ok).toBe(false);
  });

  it("drops images past the per-turn budget", () => {
    // Earlier rounds already showed the full budget.
    const earlier: ModelMessage[] = [];
    for (let i = 0; i < SCREENSHOTS_PER_TURN_MAX; i++) {
      earlier.push(
        callStep([{ id: `old${i}`, tool: PREVIEW_SCREENSHOT_TOOL }]),
        shownResult(`old${i}`),
      );
    }
    const res = attachScreenshots(
      [...earlier, ...pending],
      [
        {
          toolCallId: "s1",
          toolName: PREVIEW_SCREENSHOT_TOOL,
          result: { ok: true },
        },
      ],
      [{ toolCallId: "s1", data: png, mimeType: "image/png" }],
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.message).toBeNull();
    expect(res.results[0].result).toMatchObject({
      ok: false,
      error: expect.stringContaining("budget"),
    });
  });
});

describe("screenshotsShown", () => {
  it("counts only screenshot results that were shown", () => {
    const transcript: ModelMessage[] = [
      shownResult("a"),
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "b",
            toolName: PREVIEW_SCREENSHOT_TOOL,
            output: { type: "json", value: { ok: false, error: "x" } },
          },
          {
            type: "tool-result",
            toolCallId: "c",
            toolName: "getInnerHTML",
            output: { type: "json", value: { shown: true } },
          },
        ],
      },
    ];
    expect(screenshotsShown(transcript)).toBe(1);
  });
});
