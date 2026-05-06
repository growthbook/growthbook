/**
 * URL scrubber for session-replay payloads.
 *
 * Per spec §7.4, URLs leak more PII than any other field — query params
 * carry session tokens / email addresses / signed redirect targets, path
 * segments embed user IDs, and fragments often hold OAuth bearer tokens
 * during redirect flows. The scrubber runs every URL through a deny-by-
 * default transformation BEFORE events leave the browser, so what lands
 * on our infrastructure has been pre-flattened.
 *
 * Default behavior:
 *   - Strip ALL query parameters unless the customer has allowlisted them
 *   - Replace ID-like path segments (numeric, UUID, long hex) with [id]
 *   - Drop the URL fragment entirely
 *
 * Customers can:
 *   - Allowlist specific query param names that are safe (e.g. ["page", "tab"])
 *   - Add path patterns to redact in addition to the built-in ID heuristics
 *   - Opt back into preserving fragments if they're needed for SPA routing
 */

export type SessionReplayUrlScrubberConfig = {
  /**
   * Query param names whose values are safe to keep in the replay. Any
   * param NOT on this list is stripped (key + value both gone). Default
   * is empty — strip everything.
   */
  allowQueryParams?: string[];

  /**
   * Additional regex patterns to redact from path segments. Built-in
   * heuristics already catch numeric IDs, UUIDs, and long hex strings;
   * use this for app-specific patterns (e.g. order codes that look like
   * `ORD-12AB34CD`).
   */
  redactPathPatterns?: RegExp[];

  /**
   * Preserve the URL fragment (`#section`). Default false because
   * fragments commonly carry OAuth bearer tokens during redirect flows
   * (`#access_token=...`).
   */
  keepFragment?: boolean;
};

// Built-in ID heuristics. Conservative — slugs like "my-blog-post" stay
// intact; only segments that look unambiguously like opaque identifiers
// get redacted.
const ID_PATTERNS: RegExp[] = [
  // Pure numeric — covers `/users/12345`, `/orders/987`
  /^\d+$/,
  // UUID v1–v5 (8-4-4-4-12 hex with dashes, case-insensitive)
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // Long pure-hex — `/sessions/abc123def456...`. 16+ chars to avoid
  // false-positives on short slugs like `cafe` or `bead`.
  /^[0-9a-f]{16,}$/i,
];

const ID_REPLACEMENT = "[id]";

/**
 * Scrub a single URL string. Best-effort: if parsing fails (malformed
 * URL, e.g. relative or `javascript:` schemes that the spec explicitly
 * forbids), returns "[invalid-url]" rather than the original — better to
 * lose a debugging breadcrumb than leak something we couldn't parse.
 */
export function scrubUrl(
  url: string,
  config: SessionReplayUrlScrubberConfig = {},
): string {
  if (!url) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "[invalid-url]";
  }

  // --- Path: replace ID-like segments ---
  const allPatterns = [...ID_PATTERNS, ...(config.redactPathPatterns ?? [])];
  const scrubbedSegments = parsed.pathname.split("/").map((segment) => {
    if (!segment) return segment; // leading "" and consecutive "//"
    return allPatterns.some((pattern) => pattern.test(segment))
      ? ID_REPLACEMENT
      : segment;
  });
  parsed.pathname = scrubbedSegments.join("/");

  // --- Query params: deny-by-default with allowlist ---
  const allowed = new Set(config.allowQueryParams ?? []);
  if (allowed.size === 0) {
    parsed.search = "";
  } else {
    const next = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      if (allowed.has(key)) next.append(key, value);
    });
    const search = next.toString();
    parsed.search = search ? `?${search}` : "";
  }

  // --- Fragment: drop unless explicitly preserved ---
  if (!config.keepFragment) {
    parsed.hash = "";
  }

  return parsed.toString();
}

/**
 * Scrub URL fields embedded inside an rrweb event before it's persisted
 * or transmitted. Today this only touches Meta events (type 4 — the
 * recorder's URL snapshot at session start), since that's the explicit
 * URL field rrweb emits. Future work: walk DOM mutations to scrub
 * `<a href>` / `<form action>` / `<iframe src>` attributes captured in
 * FullSnapshot or IncrementalSnapshot mutation events.
 *
 * Returns a NEW event object when modification is needed, or the
 * original event by reference when no scrubbing applies. Avoids
 * unnecessary object allocation for the common case (every type-3
 * incremental snapshot, which is most of the volume).
 */
export function scrubEventUrls<T extends { type: number; data?: unknown }>(
  event: T,
  config: SessionReplayUrlScrubberConfig = {},
): T {
  // EventType.Meta = 4 (rrweb @rrweb/types). The Meta event is the only
  // one that exposes a URL field we can scrub without parsing serialized
  // DOM. Other URL surfaces (anchor tags, form actions) live inside
  // FullSnapshot / mutation payloads — out of scope for MVP per §7.4.
  if (event.type !== 4) return event;

  const data = event.data as { href?: string } | undefined;
  if (!data || typeof data.href !== "string") return event;

  const scrubbedHref = scrubUrl(data.href, config);
  if (scrubbedHref === data.href) return event;

  return { ...event, data: { ...data, href: scrubbedHref } };
}
