/**
 * Server-side companion to packages/sdk-js/src/plugins/session-replay-regex-scrub.ts.
 *
 * Per spec §7.8, the ingest endpoint runs the same regex scrubber the
 * SDK ran client-side, as a second pass / safety net. Two reasons it
 * has to live on the back-end too:
 *
 *   1. Client-side scrubbing can be bypassed by an attacker who
 *      tampers with the SDK before it loads. The server is the last
 *      line of defense.
 *   2. The server can run customer-specific patterns the SDK doesn't
 *      know about (e.g., per-org admin-configured patterns kept in
 *      Mongo and applied at ingest).
 *
 * The patterns and behavior are intentionally duplicated from the SDK
 * file rather than imported across packages — the SDK is browser-
 * targeted, has a zero-dependency policy, and its plugins bundle pulls
 * rrweb in transitively when imported. Cleaner to keep this small,
 * pure module on the server side. If/when shared moves get a
 * scrub-utilities module, this can be replaced by a re-export.
 *
 * IMPORTANT: keep the BUILTIN_PATTERNS array in sync with the SDK
 * file. The patterns appear in both — see the matching constant
 * defined in packages/sdk-js/src/plugins/session-replay-regex-scrub.ts.
 */

const REDACTION = "[REDACTED]";

// Built-in patterns. Must match the SDK file.
const BUILTIN_PATTERNS: RegExp[] = [
  // Credit card numbers — 13-19 digits in 4-digit groups, optional spaces or dashes
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g,
  // US Social Security Numbers — 123-45-6789
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Email addresses — RFC-loose but covers realistic shapes
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

export type ServerSideScrubConfig = {
  /**
   * Disable built-in patterns. Default false.
   */
  disableBuiltIns?: boolean;
  /**
   * Per-organization custom patterns, sourced from org settings or
   * configured via admin UI in a future iteration.
   */
  customPatterns?: RegExp[];
};

export type ScrubResult<T> = {
  /** Scrubbed events tree. */
  events: T[];
  /** Total number of regex hits across all events. */
  hits: number;
};

function scrubString(
  value: string,
  patterns: RegExp[],
): { result: string; hits: number } {
  let result = value;
  let hits = 0;
  for (const pattern of patterns) {
    result = result.replace(pattern, () => {
      hits += 1;
      return REDACTION;
    });
  }
  return { result, hits };
}

function walkAndScrub(
  value: unknown,
  patterns: RegExp[],
  hitsRef: { count: number },
): unknown {
  if (typeof value === "string") {
    const { result, hits } = scrubString(value, patterns);
    hitsRef.count += hits;
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((item) => walkAndScrub(item, patterns, hitsRef));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = walkAndScrub(nested, patterns, hitsRef);
    }
    return out;
  }
  return value;
}

/**
 * Scrub an events array on the server. Returns the scrubbed events plus
 * a count of regex hits — callers should log non-zero hits to a per-org
 * audit channel so customers can see when the safety net catches
 * something.
 */
export function serverSideScrubEvents<T>(
  events: T[],
  config: ServerSideScrubConfig = {},
): ScrubResult<T> {
  const patterns = [
    ...(config.disableBuiltIns ? [] : BUILTIN_PATTERNS),
    ...(config.customPatterns ?? []),
  ];
  if (patterns.length === 0) return { events, hits: 0 };

  const hitsRef = { count: 0 };
  const scrubbed = events.map(
    (event) => walkAndScrub(event, patterns, hitsRef) as T,
  );
  return { events: scrubbed, hits: hitsRef.count };
}
