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
