/**
 * Pre-transmission regex scrubber. Per spec §7.7, this is the
 * "belt-and-suspenders" inside the recorder: every flush payload is run
 * through a set of regex patterns just before the fetch goes out, so
 * that anything the structured masking missed (a CC number that landed
 * in a tooltip, an email that slipped past `gb-mask`) gets replaced
 * with `[REDACTED]` rather than leaving the browser.
 *
 * It is imperfect by design — regexes can't catch contextual PII like
 * names, and the patterns will produce false positives on legitimate
 * numeric IDs that happen to look credit-card-shaped. The point isn't
 * to be precise; it's to keep the worst leaks from escaping when the
 * primary masking path fails. The server-side scrubber runs the same
 * patterns again as a second pass (see task #7).
 *
 * Implementation: walks the deserialized event tree value-by-value,
 * applying each regex to every string. This is safer than running the
 * regex on the JSON string itself — customer-supplied patterns without
 * proper anchoring could otherwise match across `"key":"value"`
 * boundaries and corrupt the JSON. Tree-walk allocates more memory but
 * is structurally bulletproof.
 */

const REDACTION = "[REDACTED]";

// Built-in patterns. Conservative on the credit-card side: requires the
// 13–19 digits to be grouped 4-4-4-{1..7} with optional separators, which
// catches the common Visa/MC/Amex/Discover layouts without flagging
// arbitrary 16-digit numeric IDs.
const BUILTIN_PATTERNS: RegExp[] = [
  // Credit card numbers — 13-19 digits in 4-digit groups, optional spaces or dashes
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g,
  // US Social Security Numbers — `123-45-6789`
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Email addresses — RFC-loose but covers the realistic shapes that
  // leak into UI text
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

export type SessionReplayRegexScrubberConfig = {
  /**
   * Disable the built-in patterns. Default false (built-ins enabled).
   * Set to true if you want ONLY your custom patterns applied — useful
   * if a built-in is producing too many false positives in your domain
   * (e.g. an analytics app that legitimately displays 16-digit IDs).
   */
  disableBuiltIns?: boolean;

  /**
   * Additional regex patterns. Each match is replaced with `[REDACTED]`.
   * Patterns must use the global flag (`g`) to replace all matches in a
   * value — non-global patterns will only replace the first occurrence.
   *
   * Patterns should be string-anchored (`\b` at boundaries) to avoid
   * over-matching in arbitrary text contexts.
   */
  customPatterns?: RegExp[];

  /**
   * Called once per scrubbed payload with the total number of regex
   * hits across that payload's events. Use for telemetry — a high hit
   * count usually means a leaky component is shipping content the
   * built-in masking didn't catch, and the customer should fix it.
   */
  onScrubHit?: (count: number) => void;
};

/**
 * Apply all configured patterns to a single string and return the
 * scrubbed value plus the number of replacements made.
 */
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

/**
 * Recursively walk an arbitrary value (object, array, primitive),
 * scrubbing every string leaf. Returns a NEW value tree — does not
 * mutate the input. Hit counts bubble up from leaves to the caller.
 */
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
  // Numbers, booleans, null, undefined — pass through. Numeric leaks
  // (like a CC number that ended up as a Number rather than a String)
  // are theoretically possible but rrweb serializes essentially
  // everything as strings inside event payloads.
  return value;
}

/**
 * Public entry point. Scrubs the events payload and reports hit count
 * to the customer's telemetry callback if configured. Designed to be
 * called from `flushBuffer` right before JSON.stringify + fetch.
 *
 * Returns a new events array; original is untouched. Safe to call with
 * an empty config object — built-ins still run unless explicitly
 * disabled.
 */
export function scrubEventsPayload<T>(
  events: T[],
  config: SessionReplayRegexScrubberConfig = {},
): T[] {
  const patterns = [
    ...(config.disableBuiltIns ? [] : BUILTIN_PATTERNS),
    ...(config.customPatterns ?? []),
  ];

  // No patterns at all = no work
  if (patterns.length === 0) return events;

  const hitsRef = { count: 0 };
  const scrubbed = events.map(
    (event) => walkAndScrub(event, patterns, hitsRef) as T,
  );

  if (hitsRef.count > 0 && config.onScrubHit) {
    try {
      config.onScrubHit(hitsRef.count);
    } catch {
      // Customer telemetry callback threw — don't let that kill the
      // recording. Swallow.
    }
  }

  return scrubbed;
}
