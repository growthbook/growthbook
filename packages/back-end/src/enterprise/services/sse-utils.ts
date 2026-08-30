import type { Response } from "express";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import type { AgentEmit } from "back-end/src/enterprise/services/stream-processor";

type FlushableResponse = Response & { flush?: () => void };

export function setSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  (res as FlushableResponse).flushHeaders?.();
}

export function createEmit(
  res: Response,
  buffer: ConversationBuffer,
): AgentEmit {
  const flushableRes = res as FlushableResponse;
  return (event, data): void => {
    try {
      flushableRes.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      flushableRes.flush?.();
    } catch {
      // Client disconnected — safe to ignore write failures
    }
    buffer.touchStreamedAt();
  };
}

/**
 * Serialize tool arguments / results for SSE JSON payloads.
 * Extremely large values are truncated with metadata so the UI can warn;
 * the limit is high so typical exploration / tool outputs are sent in full.
 */
export const MAX_SSE_TOOL_JSON_LENGTH = 2 * 1024 * 1024;

export function serializeUnknownForSSE(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    const s = JSON.stringify(value);
    if (s.length <= MAX_SSE_TOOL_JSON_LENGTH) {
      return JSON.parse(s) as unknown;
    }
    return {
      _truncated: true,
      preview: s.slice(0, MAX_SSE_TOOL_JSON_LENGTH),
      totalLength: s.length,
    };
  } catch {
    const str = String(value);
    if (str.length <= MAX_SSE_TOOL_JSON_LENGTH) {
      return { _nonJson: true, preview: str };
    }
    return {
      _nonJson: true,
      _truncated: true,
      preview: str.slice(0, MAX_SSE_TOOL_JSON_LENGTH),
      totalLength: str.length,
    };
  }
}
