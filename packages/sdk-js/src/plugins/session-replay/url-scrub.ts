/**
 * Deny-by-default URL scrubber for session-replay payloads, applied before
 * events leave the browser. URLs are the leakiest field: query params carry
 * tokens/emails, path segments embed user ids, fragments hold OAuth tokens.
 *
 * Defaults: strip all query params, replace ID-like path segments
 * (numeric/UUID/long hex) with [id], drop the fragment. The config can
 * allowlist query params, add path patterns, or preserve fragments.
 */

export type SessionReplayUrlScrubberConfig = {
  // Query params safe to keep; everything else is stripped (default: all)
  allowQueryParams?: string[];
  // App-specific path-segment patterns to redact, on top of the built-in
  // numeric/UUID/long-hex heuristics
  redactPathPatterns?: RegExp[];
  // Keep `#fragment`. Default false — fragments carry OAuth tokens during
  // redirect flows.
  keepFragment?: boolean;
};

// Only segments that are unambiguously opaque ids; slugs stay intact
const ID_PATTERNS: RegExp[] = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // 16+ hex chars, so short words like "cafe" survive
  /^[0-9a-f]{16,}$/i,
];

const ID_REPLACEMENT = "[id]";

// Relative URLs resolve against the document; unparseable ones (e.g.
// `javascript:`) become "[invalid-url]"
export function scrubUrl(
  url: string,
  config: SessionReplayUrlScrubberConfig = {},
): string {
  if (!url) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    try {
      const base =
        typeof window !== "undefined" ? window.location.href : undefined;
      if (!base) return "[invalid-url]";
      parsed = new URL(url, base);
    } catch {
      return "[invalid-url]";
    }
  }

  const allPatterns = [...ID_PATTERNS, ...(config.redactPathPatterns ?? [])];
  const scrubbedSegments = parsed.pathname.split("/").map((segment) => {
    if (!segment) return segment;
    return allPatterns.some((pattern) => pattern.test(segment))
      ? ID_REPLACEMENT
      : segment;
  });
  parsed.pathname = scrubbedSegments.join("/");

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

  if (!config.keepFragment) {
    parsed.hash = "";
  }

  return parsed.toString();
}

// Attribute names that carry URLs, wherever rrweb captures them
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

// Returns the same object when nothing changed — most events have no URL
// attributes, so the hot path allocates nothing
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

// Rebuilds the serialized DOM tree only along paths that changed
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

// Scrubs every URL-bearing surface of an rrweb event: Meta href (type 4),
// FullSnapshot tree attributes (type 2), and Mutation attribute changes
// (type 3, source 0). Returns the original event when nothing changed.
export function scrubEventUrls<T extends { type: number; data?: unknown }>(
  event: T,
  config: SessionReplayUrlScrubberConfig = {},
): T {
  if (event.type === 4) {
    const data = event.data as { href?: string } | undefined;
    if (!data || typeof data.href !== "string") return event;
    const scrubbedHref = scrubUrl(data.href, config);
    if (scrubbedHref === data.href) return event;
    return { ...event, data: { ...data, href: scrubbedHref } };
  }

  if (event.type === 2) {
    const data = event.data as { node?: unknown } | undefined;
    if (!data || !data.node) return event;
    const scrubbedNode = scrubTreeUrls(data.node, config);
    if (scrubbedNode === data.node) return event;
    return { ...event, data: { ...data, node: scrubbedNode } };
  }

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
