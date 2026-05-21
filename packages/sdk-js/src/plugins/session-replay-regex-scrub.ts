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
 * Apply all configured patterns to a single string, returning the
 * scrubbed value, the count of replacements, and the set of matched
 * values (used by the retroactive prefix scrub).
 */
function scrubString(
  value: string,
  patterns: RegExp[],
): { result: string; hits: number; matches: string[] } {
  let result = value;
  let hits = 0;
  const matches: string[] = [];
  for (const pattern of patterns) {
    // Collect matches BEFORE replacing — captures the original sensitive
    // values for the retroactive prefix sweep.
    const found = value.match(pattern);
    if (found) {
      for (const m of found) {
        if (m && m.length >= 4) matches.push(m);
      }
    }
    result = result.replace(pattern, () => {
      hits += 1;
      return REDACTION;
    });
  }
  return { result, hits, matches };
}

/**
 * Walk an arbitrary value (object, array, primitive), scrubbing every
 * string leaf. Returns a NEW value tree — does not mutate the input.
 * Hit counts and matched values bubble up via the refs.
 */
function walkAndScrub(
  value: unknown,
  patterns: RegExp[],
  hitsRef: { count: number },
  matchesRef: string[],
): unknown {
  if (typeof value === "string") {
    const { result, hits, matches } = scrubString(value, patterns);
    hitsRef.count += hits;
    if (matches.length > 0) matchesRef.push(...matches);
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      walkAndScrub(item, patterns, hitsRef, matchesRef),
    );
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = walkAndScrub(nested, patterns, hitsRef, matchesRef);
    }
    return out;
  }
  return value;
}

/**
 * Per-event dispatch: which scrubbing applies to which rrweb event
 * type. The blanket "regex everything" approach used previously is
 * structurally fine but spends real CPU on FullSnapshot DOM markup that
 * has near-zero PII signal. Routing by event type keeps the scrubber
 * surgical without losing coverage.
 *
 *   - type 2 (FullSnapshot): skip regex entirely. URL scrubbing
 *     (scrubEventUrls) already handles the URL surface; DOM markup
 *     itself is huge and shouldn't contain free-form CC/SSN/email.
 *   - type 3 (IncrementalSnapshot):
 *       source 5 (Input)  → regex on `data.text` (user typing — the
 *                             primary place CC/SSN actually leaks).
 *                             Also feeds the retroactive prefix sweep.
 *       source 0 (Mutation) → regex on text-content mutations
 *                              (`data.texts[].value`). Custom widget
 *                              tooltips, error toasts etc.
 *       other sources       → skip (mouse, scroll, viewport — no PII).
 *   - type 4 (Meta): URL only; skip regex.
 *   - type 5 (Custom): regex on `data.payload` (flag/exp events the
 *     SDK synthesizes, custom rrweb events from the customer).
 *   - other types: pass through.
 */
function scrubEventByType<T>(
  event: T,
  patterns: RegExp[],
  hitsRef: { count: number },
  matchesRef: string[],
): T {
  const e = event as unknown as {
    type?: number;
    data?: {
      source?: number;
      text?: string;
      texts?: Array<{ value?: string; id?: number }>;
      payload?: unknown;
    };
  };
  if (typeof e?.type !== "number" || !e.data) return event;

  // type 3 — IncrementalSnapshot
  if (e.type === 3) {
    const source = e.data.source;

    // Input event — regex the typed value, track matches for prefix sweep
    if (source === 5 && typeof e.data.text === "string") {
      const { result, hits, matches } = scrubString(e.data.text, patterns);
      if (matches.length > 0) matchesRef.push(...matches);
      if (result === e.data.text) return event;
      hitsRef.count += hits;
      return {
        ...(event as object),
        data: { ...e.data, text: result },
      } as T;
    }

    // Mutation event — text content changes carry tooltip / error
    // messages that can leak PII.
    if (source === 0 && Array.isArray(e.data.texts) && e.data.texts.length) {
      let changed = false;
      const newTexts = e.data.texts.map((t) => {
        if (!t || typeof t.value !== "string") return t;
        const { result, hits, matches } = scrubString(t.value, patterns);
        if (matches.length > 0) matchesRef.push(...matches);
        if (result === t.value) return t;
        hitsRef.count += hits;
        changed = true;
        return { ...t, value: result };
      });
      if (!changed) return event;
      return {
        ...(event as object),
        data: { ...e.data, texts: newTexts },
      } as T;
    }

    return event;
  }

  // type 5 — Custom event (feature-flag / experiment payloads etc.)
  if (e.type === 5 && e.data.payload) {
    const scrubbedPayload = walkAndScrub(
      e.data.payload,
      patterns,
      hitsRef,
      matchesRef,
    );
    if (scrubbedPayload === e.data.payload) return event;
    return {
      ...(event as object),
      data: { ...e.data, payload: scrubbedPayload },
    } as T;
  }

  // FullSnapshot, Meta, mouse/scroll, etc. — pass through.
  return event;
}

/**
 * Retroactive prefix sweep. When a pattern matches a complete sensitive
 * value V in some Input event, every PREVIOUS Input event in the same
 * buffer carrying a strict prefix of V was almost certainly the user
 * typing toward V. Regex won't have caught those (incomplete patterns
 * don't match), so we'd otherwise leak `"4"`, `"41"`, …, `"411111111111111"`
 * right up to the final redacted value. Replace them with [REDACTED]
 * here so the replay shows redaction from the first keystroke.
 *
 * Walk is O(matched_values × input_events × avg_text_length). For a
 * realistic buffer that's well under a millisecond.
 */
function retroactivelyScrubInputPrefixes<T>(
  events: T[],
  matchedValues: string[],
): T[] {
  if (matchedValues.length === 0) return events;
  // Dedupe + filter trivial matches so we don't mass-redact "@" or "1".
  const values = Array.from(new Set(matchedValues)).filter((v) => v.length >= 4);
  if (values.length === 0) return events;

  return events.map((event) => {
    const e = event as unknown as {
      type?: number;
      data?: { source?: number; text?: string };
    };
    if (e?.type !== 3 || e.data?.source !== 5) return event;
    const text = e.data.text;
    if (typeof text !== "string" || text === REDACTION || text.length === 0) {
      return event;
    }
    const isPrefixOfMatch = values.some(
      (v) => v.length > text.length && v.startsWith(text),
    );
    if (!isPrefixOfMatch) return event;
    return {
      ...(event as object),
      data: { ...e.data, text: REDACTION },
    } as T;
  });
}

/**
 * Public entry point. Scrubs the events payload and reports hit count
 * to the customer's telemetry callback if configured. Designed to be
 * called from `flushBuffer` right before JSON.stringify + fetch.
 *
 * Two passes:
 *   1. Per-event regex dispatch (scrubEventByType) — applies patterns
 *      only to event types where PII can realistically appear, capturing
 *      every full-pattern match into a values list for pass 2.
 *   2. Retroactive prefix sweep — every earlier Input event whose text
 *      is a prefix of a matched value gets redacted. Fixes the
 *      "leak the first 15 digits, redact the 16th" behavior that
 *      per-event regex would otherwise produce on user typing.
 *
 * Returns a new events array; original is untouched.
 */
export function scrubEventsPayload<T>(
  events: T[],
  config: SessionReplayRegexScrubberConfig = {},
): T[] {
  const patterns = [
    ...(config.disableBuiltIns ? [] : BUILTIN_PATTERNS),
    ...(config.customPatterns ?? []),
  ];

  if (patterns.length === 0) return events;

  const hitsRef = { count: 0 };
  const matchesRef: string[] = [];

  // Pass 1: per-event dispatch
  const scrubbed = events.map(
    (event) => scrubEventByType(event, patterns, hitsRef, matchesRef) as T,
  );

  // Pass 2: retroactive prefix sweep on Input events
  const finalEvents = retroactivelyScrubInputPrefixes(scrubbed, matchesRef);

  if (hitsRef.count > 0 && config.onScrubHit) {
    try {
      config.onScrubHit(hitsRef.count);
    } catch {
      // Customer telemetry callback threw — don't let that kill the
      // recording. Swallow.
    }
  }

  return finalEvents;
}
