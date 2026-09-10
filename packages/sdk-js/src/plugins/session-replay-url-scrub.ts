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
 * Scrub a single URL string. Relative URLs (e.g. `/path?q=1`, `../foo`)
 * are resolved against the current document so they can be properly scrubbed
 * rather than discarded. Truly unparseable values (e.g. `javascript:`) return
 * "[invalid-url]".
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
    // Relative URLs are the common case in DOM attributes (href, src, action).
    // Resolve against the current document so we can scrub them properly.
    try {
      const base =
        typeof window !== "undefined" ? window.location.href : undefined;
      if (!base) return "[invalid-url]";
      parsed = new URL(url, base);
    } catch {
      return "[invalid-url]";
    }
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
 * Set of DOM attribute names that carry URLs and must be scrubbed
 * wherever they appear — inside FullSnapshot tree nodes, inside
 * IncrementalSnapshot attribute mutations, anywhere rrweb captures
 * element attributes. Lowercased keys; matched case-insensitively.
 */
const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "data-href",
  "data-url",
  "poster",
  "background",
  "cite",
  "longdesc",
]);

/**
 * Scrub URL-shaped attribute values in an object whose keys are
 * attribute names (rrweb's serialized `attributes` shape).
 *
 * Returns a NEW object with only the modified keys replaced, or the
 * original by reference if nothing matched — keeps the hot-path
 * allocations down for the common case of an event with no URL attrs.
 */
function scrubUrlAttrs<T extends Record<string, unknown>>(
  attrs: T,
  config: SessionReplayUrlScrubberConfig,
): T {
  let out: Record<string, unknown> | null = null;
  for (const key in attrs) {
    if (!URL_ATTRS.has(key.toLowerCase())) continue;
    const value = attrs[key];
    if (typeof value !== "string" || !value) continue;
    const scrubbed = scrubUrl(value, config);
    if (scrubbed === value) continue;
    out = out ?? { ...attrs };
    out[key] = scrubbed;
  }
  return (out as T) ?? attrs;
}

/**
 * Recursively walk the serialized DOM tree inside a FullSnapshot and
 * scrub URL attributes on every element. rrweb's serialized format
 * stores attributes on element nodes as `{ attributes: { href: "..." } }`;
 * we look for those, scrub URL-typed entries, and rebuild the tree only
 * along the path that changed (structural sharing for everything else).
 */
function scrubTreeUrls(
  node: unknown,
  config: SessionReplayUrlScrubberConfig,
): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as {
    type?: number;
    attributes?: Record<string, unknown>;
    childNodes?: unknown[];
  };

  // Recurse into children first so any rebuilt subtree is in hand
  // before we decide whether THIS node changed.
  let newChildNodes: unknown[] | undefined;
  if (Array.isArray(n.childNodes) && n.childNodes.length > 0) {
    let childChanged = false;
    const next: unknown[] = new Array(n.childNodes.length);
    for (let i = 0; i < n.childNodes.length; i++) {
      const original = n.childNodes[i];
      const replaced = scrubTreeUrls(original, config);
      if (replaced !== original) childChanged = true;
      next[i] = replaced;
    }
    if (childChanged) newChildNodes = next;
  }

  // Attribute scrubbing applies only to Element nodes (rrweb-snapshot
  // NodeType.Element === 2), but checking `typeof attributes === object`
  // is sufficient and avoids a version-specific enum dependency.
  let newAttributes: Record<string, unknown> | undefined;
  if (n.attributes && typeof n.attributes === "object") {
    const scrubbed = scrubUrlAttrs(n.attributes, config);
    if (scrubbed !== n.attributes) newAttributes = scrubbed;
  }

  if (!newAttributes && !newChildNodes) return node;
  return {
    ...n,
    ...(newAttributes ? { attributes: newAttributes } : {}),
    ...(newChildNodes ? { childNodes: newChildNodes } : {}),
  };
}

/**
 * Scrub URL fields embedded inside an rrweb event before it's persisted
 * or transmitted. Handles three event surfaces per spec §7.4:
 *
 *   - type 4 (Meta): `data.href` (the recorder's URL snapshot)
 *   - type 2 (FullSnapshot): URL attributes anywhere in the serialized
 *     DOM tree
 *   - type 3 source 0 (Mutation): URL attributes in `data.attributes`
 *     attribute-change mutations
 *
 * Returns a NEW event object when modification is needed, or the
 * original by reference when no scrubbing applies. Structural sharing
 * inside FullSnapshot keeps allocations bounded.
 */
export function scrubEventUrls<T extends { type: number; data?: unknown }>(
  event: T,
  config: SessionReplayUrlScrubberConfig = {},
): T {
  // type 4 (Meta) — the recorder's session-start URL
  if (event.type === 4) {
    const data = event.data as { href?: string } | undefined;
    if (!data || typeof data.href !== "string") return event;
    const scrubbedHref = scrubUrl(data.href, config);
    if (scrubbedHref === data.href) return event;
    return { ...event, data: { ...data, href: scrubbedHref } };
  }

  // type 2 (FullSnapshot) — serialized DOM tree
  if (event.type === 2) {
    const data = event.data as { node?: unknown } | undefined;
    if (!data || !data.node) return event;
    const scrubbedNode = scrubTreeUrls(data.node, config);
    if (scrubbedNode === data.node) return event;
    return { ...event, data: { ...data, node: scrubbedNode } };
  }

  // type 3 (IncrementalSnapshot) — only the Mutation source (0) carries
  // attribute changes. rrweb's mutation payload is
  //   { source: 0, attributes: [ { id, attributes: {...} }, ... ], ... }
  if (event.type === 3) {
    const data = event.data as
      | {
          source?: number;
          attributes?: Array<{ attributes?: Record<string, unknown> }>;
        }
      | undefined;
    if (!data || data.source !== 0 || !Array.isArray(data.attributes)) {
      return event;
    }
    let mutationsChanged = false;
    const newMutations = data.attributes.map((m) => {
      if (!m || typeof m !== "object" || !m.attributes) return m;
      const scrubbed = scrubUrlAttrs(m.attributes, config);
      if (scrubbed === m.attributes) return m;
      mutationsChanged = true;
      return { ...m, attributes: scrubbed };
    });
    if (!mutationsChanged) return event;
    return { ...event, data: { ...data, attributes: newMutations } };
  }

  return event;
}
