import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { ModelMessage } from "ai";
import { z } from "zod";

// The stateless tool loop hands the model's transcript to the extension and
// gets it back on the next request, so no instance has to remember anything.
// The envelope is HMAC-signed over the transcript, the step count, when it
// was issued, who it belongs to, and the request that started the loop: the
// extension can answer tool calls (that is the point) but can't forge
// assistant turns or server-tool results, reset the budget, change the
// request mid-loop, or replay a stale envelope.

// A loop's rounds are seconds apart; this only bounds replay.
export const ENVELOPE_TTL_MS = 15 * 60 * 1000;

export interface EnvelopeScope {
  orgId: string;
  userId: string;
  visualChangesetId: string;
  variationId: string;
  // requestHash() of the body the loop started with.
  requestHash: string;
}

export interface ToolLoopEnvelope {
  transcript: ModelMessage[];
  stepsUsed: number;
  issuedAt: number;
  sig: string;
}

// The envelope as the extension echoes it back in `resume`.
export const toolLoopEnvelopeSchema = z.object({
  transcript: z
    .array(
      z
        .object({
          role: z.enum(["assistant", "tool"]),
          content: z.unknown(),
        })
        .passthrough(),
    )
    .max(60),
  stepsUsed: z.number().int().min(0).max(200),
  issuedAt: z.number().int(),
  sig: z.string().min(1).max(200),
});

// JSON with object keys sorted, so the signature doesn't depend on key order
// surviving the trip through the extension and the body schema.
const sortedJson = (v: unknown): string =>
  JSON.stringify(v, (key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );

// Every round re-sends the original request; its hash is part of the scope.
export const requestHash = (body: unknown): string =>
  createHash("sha256").update(sortedJson(body)).digest("hex");

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

const canonical = (
  scope: EnvelopeScope,
  transcript: unknown,
  stepsUsed: number,
  issuedAt: number,
): string => sortedJson({ scope, transcript, stepsUsed, issuedAt });

const digest = (secret: string, payload: string): string =>
  createHmac("sha256", secret).update(payload).digest("hex");

export function signEnvelope(
  secret: string,
  scope: EnvelopeScope,
  transcript: ModelMessage[],
  stepsUsed: number,
  issuedAt = Date.now(),
): ToolLoopEnvelope {
  return {
    transcript,
    stepsUsed,
    issuedAt,
    sig: digest(secret, canonical(scope, transcript, stepsUsed, issuedAt)),
  };
}

export function verifyEnvelope(
  secret: string,
  scope: EnvelopeScope,
  envelope: {
    transcript: unknown;
    stepsUsed: number;
    issuedAt: number;
    sig: string;
  },
  now = Date.now(),
): boolean {
  if (now - envelope.issuedAt > ENVELOPE_TTL_MS) return false;
  const expected = Buffer.from(
    digest(
      secret,
      canonical(
        scope,
        envelope.transcript,
        envelope.stepsUsed,
        envelope.issuedAt,
      ),
    ),
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

// Each answered tool call with its input and JSON output, so a resume can
// learn what earlier rounds' tools found.
export function answeredToolCalls(
  transcript: ModelMessage[],
): Array<{ toolName: string; input: unknown; output: unknown }> {
  const inputs = new Map<string, unknown>();
  const answered: Array<{ toolName: string; input: unknown; output: unknown }> =
    [];
  for (const m of transcript) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "tool-call") inputs.set(part.toolCallId, part.input);
      }
    } else if (m.role === "tool") {
      for (const part of m.content) {
        if (part.type !== "tool-result") continue;
        answered.push({
          toolName: part.toolName,
          input: inputs.get(part.toolCallId),
          output: part.output.type === "json" ? part.output.value : undefined,
        });
      }
    }
  }
  return answered;
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
