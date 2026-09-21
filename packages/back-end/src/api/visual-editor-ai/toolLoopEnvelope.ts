import { createHmac, timingSafeEqual } from "crypto";
import type { ModelMessage } from "ai";

// The stateless tool loop hands the model's transcript to the extension and
// gets it back on the next request, so no instance has to remember anything.
// The envelope is HMAC-signed over the transcript, the step count, and who
// it belongs to: the extension can answer tool calls (that is the point) but
// can't forge assistant turns, server-tool results, or reset the budget.

export interface EnvelopeScope {
  orgId: string;
  userId: string;
  visualChangesetId: string;
  variationId: string;
}

export interface ToolLoopEnvelope {
  transcript: ModelMessage[];
  stepsUsed: number;
  sig: string;
}

export interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ClientToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
}

// JSON round-trips preserve key order, so the client echoing the envelope it
// received reproduces this byte for byte.
const canonical = (
  scope: EnvelopeScope,
  transcript: unknown,
  stepsUsed: number,
): string => JSON.stringify({ scope, transcript, stepsUsed });

const digest = (secret: string, payload: string): string =>
  createHmac("sha256", secret).update(payload).digest("hex");

export function signEnvelope(
  secret: string,
  scope: EnvelopeScope,
  transcript: ModelMessage[],
  stepsUsed: number,
): ToolLoopEnvelope {
  return {
    transcript,
    stepsUsed,
    sig: digest(secret, canonical(scope, transcript, stepsUsed)),
  };
}

export function verifyEnvelope(
  secret: string,
  scope: EnvelopeScope,
  envelope: { transcript: unknown; stepsUsed: number; sig: string },
): boolean {
  const expected = Buffer.from(
    digest(secret, canonical(scope, envelope.transcript, envelope.stepsUsed)),
  );
  const given = Buffer.from(envelope.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Tool calls in the transcript with no result yet — what the client owes.
export function pendingToolCalls(
  transcript: ModelMessage[],
): PendingToolCall[] {
  const calls: PendingToolCall[] = [];
  const answered = new Set<string>();
  for (const m of transcript) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "tool-call") {
          calls.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          });
        }
      }
    } else if (m.role === "tool") {
      for (const part of m.content) {
        if (part.type === "tool-result") answered.add(part.toolCallId);
      }
    }
  }
  return calls.filter((c) => !answered.has(c.toolCallId));
}

export interface GeneratedImageRef {
  url: string;
  width: number;
  height: number;
}

// Images generateImage produced earlier in this logical turn. Each resume
// runs in a fresh process with a fresh per-turn image counter, so the paid
// budget has to be re-seeded from the signed transcript or every round would
// start it from zero.
export function generatedImagesIn(
  transcript: ModelMessage[],
): GeneratedImageRef[] {
  const images: GeneratedImageRef[] = [];
  for (const m of transcript) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (part.type !== "tool-result" || part.toolName !== "generateImage") {
        continue;
      }
      const out = part.output;
      const value: unknown = out.type === "json" ? out.value : undefined;
      if (
        value &&
        typeof value === "object" &&
        (value as { ok?: unknown }).ok === true &&
        typeof (value as { url?: unknown }).url === "string"
      ) {
        const v = value as { url: string; width?: unknown; height?: unknown };
        images.push({
          url: v.url,
          width: typeof v.width === "number" ? v.width : 0,
          height: typeof v.height === "number" ? v.height : 0,
        });
      }
    }
  }
  return images;
}

// Every pending call answered exactly once and nothing else, or the loop
// would stop again immediately with the same calls outstanding.
export function toolResultsMessage(
  pending: PendingToolCall[],
  results: ClientToolResult[],
): { ok: true; message: ModelMessage } | { ok: false; error: string } {
  const byId = new Map(pending.map((c) => [c.toolCallId, c]));
  const seen = new Set<string>();
  for (const r of results) {
    const call = byId.get(r.toolCallId);
    if (!call) {
      return {
        ok: false,
        error: `Unexpected tool result for call ${r.toolCallId}.`,
      };
    }
    if (call.toolName !== r.toolName) {
      return {
        ok: false,
        error: `Tool result for call ${r.toolCallId} names ${r.toolName}, expected ${call.toolName}.`,
      };
    }
    if (seen.has(r.toolCallId)) {
      return {
        ok: false,
        error: `Duplicate tool result for call ${r.toolCallId}.`,
      };
    }
    seen.add(r.toolCallId);
  }
  const missing = pending.filter((c) => !seen.has(c.toolCallId));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing tool results for: ${missing.map((c) => c.toolName).join(", ")}.`,
    };
  }
  return {
    ok: true,
    message: {
      role: "tool",
      content: results.map((r) => ({
        type: "tool-result" as const,
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        output: { type: "json" as const, value: toJsonValue(r.result) },
      })),
    },
  };
}

// Tool outputs must be JSON; the client's result already crossed the wire
// as JSON, so this only normalizes `undefined`.
function toJsonValue(v: unknown): ReturnType<typeof JSON.parse> {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}
