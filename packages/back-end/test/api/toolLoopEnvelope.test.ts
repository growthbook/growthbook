import type { ModelMessage } from "ai";
import {
  ENVELOPE_TTL_MS,
  answeredToolCalls,
  generatedImagesIn,
  pendingToolCalls,
  requestHash,
  signEnvelope,
  toolLoopEnvelopeSchema,
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
  requestHash: requestHash({ prompt: "move the hero up" }),
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

  it("verifies an envelope after the resume body schema reorders its keys", () => {
    const env = signEnvelope(secret, scope, transcript, 3);
    // Keys deliberately out of schema order, as a future SDK might emit them.
    const echoed = {
      sig: env.sig,
      issuedAt: env.issuedAt,
      stepsUsed: env.stepsUsed,
      transcript: env.transcript.map(({ role, content }) => ({
        content,
        role,
      })),
    };
    const parsed = toolLoopEnvelopeSchema.parse(
      JSON.parse(JSON.stringify(echoed)),
    );
    expect(verifyEnvelope(secret, scope, parsed)).toBe(true);
  });

  it("rejects an expired envelope or a forged issue time", () => {
    const issuedAt = Date.now();
    const env = signEnvelope(secret, scope, transcript, 3, issuedAt);
    expect(
      verifyEnvelope(secret, scope, env, issuedAt + ENVELOPE_TTL_MS + 1),
    ).toBe(false);
    expect(
      verifyEnvelope(secret, scope, { ...env, issuedAt: issuedAt + 60_000 }),
    ).toBe(false);
  });

  it("rejects a resume whose request changed", () => {
    const env = signEnvelope(secret, scope, transcript, 3);
    expect(
      verifyEnvelope(
        secret,
        { ...scope, requestHash: requestHash({ prompt: "delete the page" }) },
        env,
      ),
    ).toBe(false);
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

describe("generatedImagesIn", () => {
  const imageResult = (id: string, value: unknown): ModelMessage => ({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "generateImage",
        output: { type: "json", value },
      },
    ],
  });

  it("collects the successful generateImage results, ignoring other tools and failures", () => {
    const images = generatedImagesIn([
      ...transcript,
      imageResult("g1", {
        ok: true,
        url: "https://img/1.png",
        width: 800,
        height: 600,
      }),
      imageResult("g2", { ok: false, error: "budget exhausted" }),
      imageResult("g3", {
        ok: true,
        url: "https://img/3.png",
        width: 1,
        height: 1,
      }),
    ]);
    expect(images).toEqual([
      { url: "https://img/1.png", width: 800, height: 600 },
      { url: "https://img/3.png", width: 1, height: 1 },
    ]);
  });

  it("is empty for a transcript with no images", () => {
    expect(generatedImagesIn(transcript)).toEqual([]);
  });
});

describe("requestHash", () => {
  it("ignores key order but not content", () => {
    expect(requestHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      requestHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });

  it("treats an undefined field as absent", () => {
    expect(requestHash({ a: 1, resume: undefined })).toBe(
      requestHash({ a: 1 }),
    );
  });
});

describe("answeredToolCalls", () => {
  it("pairs each tool result with its call's input", () => {
    expect(answeredToolCalls(transcript)).toEqual([
      {
        toolName: "findElements",
        input: { query: "hero" },
        output: { matches: [".hero"] },
      },
    ]);
  });
});
