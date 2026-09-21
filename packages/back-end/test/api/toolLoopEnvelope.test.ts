import type { ModelMessage } from "ai";
import {
  pendingToolCalls,
  signEnvelope,
  toolResultsMessage,
  verifyEnvelope,
  type EnvelopeScope,
} from "back-end/src/api/visual-editor-ai/toolLoopEnvelope";

const secret = "test-secret";
const scope: EnvelopeScope = {
  orgId: "org_1",
  userId: "u_1",
  visualChangesetId: "vcs_1",
  variationId: "var_1",
};

// One step that called a server tool (answered) and a DOM tool (pending).
const transcript: ModelMessage[] = [
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "findElements",
        input: { query: "hero" },
      },
      {
        type: "tool-call",
        toolCallId: "c2",
        toolName: "getInnerHTML",
        input: { selector: ".hero" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "findElements",
        output: { type: "json", value: { matches: [".hero"] } },
      },
    ],
  },
];

describe("signEnvelope / verifyEnvelope", () => {
  it("verifies an envelope after a JSON round trip", () => {
    const env = signEnvelope(secret, scope, transcript, 3);
    const echoed = JSON.parse(JSON.stringify(env));
    expect(verifyEnvelope(secret, scope, echoed)).toBe(true);
  });

  it("rejects a tampered transcript, step count, scope, or secret", () => {
    const env = signEnvelope(secret, scope, transcript, 3);
    const altered = JSON.parse(JSON.stringify(env));
    altered.transcript[0].content[1].input.selector = "body";
    expect(verifyEnvelope(secret, scope, altered)).toBe(false);
    expect(verifyEnvelope(secret, scope, { ...env, stepsUsed: 0 })).toBe(false);
    expect(verifyEnvelope(secret, { ...scope, orgId: "org_2" }, env)).toBe(
      false,
    );
    expect(verifyEnvelope("other", scope, env)).toBe(false);
    expect(verifyEnvelope(secret, scope, { ...env, sig: "" })).toBe(false);
  });
});

describe("pendingToolCalls", () => {
  it("returns only the calls without a result", () => {
    expect(pendingToolCalls(transcript)).toEqual([
      {
        toolCallId: "c2",
        toolName: "getInnerHTML",
        input: { selector: ".hero" },
      },
    ]);
  });

  it("is empty when every call was answered", () => {
    const answered: ModelMessage[] = [
      ...transcript,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "getInnerHTML",
            output: { type: "json", value: { html: "<h1/>" } },
          },
        ],
      },
    ];
    expect(pendingToolCalls(answered)).toEqual([]);
  });
});

describe("toolResultsMessage", () => {
  const pending = pendingToolCalls(transcript);

  it("builds the tool message when every pending call is answered once", () => {
    const out = toolResultsMessage(pending, [
      { toolCallId: "c2", toolName: "getInnerHTML", result: { html: "<h1/>" } },
    ]);
    expect(out).toEqual({
      ok: true,
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "getInnerHTML",
            output: { type: "json", value: { html: "<h1/>" } },
          },
        ],
      },
    });
  });

  it("rejects missing, unexpected, misnamed, and duplicate results", () => {
    expect(toolResultsMessage(pending, [])).toMatchObject({
      ok: false,
      error: expect.stringContaining("Missing"),
    });
    expect(
      toolResultsMessage(pending, [
        { toolCallId: "c9", toolName: "getInnerHTML", result: {} },
      ]),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Unexpected"),
    });
    expect(
      toolResultsMessage(pending, [
        { toolCallId: "c2", toolName: "getComputedStyles", result: {} },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining("expected") });
    expect(
      toolResultsMessage(pending, [
        { toolCallId: "c2", toolName: "getInnerHTML", result: {} },
        { toolCallId: "c2", toolName: "getInnerHTML", result: {} },
      ]),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Duplicate") });
  });

  it("normalizes an undefined result to null", () => {
    const out = toolResultsMessage(pending, [
      { toolCallId: "c2", toolName: "getInnerHTML", result: undefined },
    ]);
    expect(
      out.ok && out.message.role === "tool" && out.message.content[0],
    ).toMatchObject({
      output: { type: "json", value: null },
    });
  });
});
