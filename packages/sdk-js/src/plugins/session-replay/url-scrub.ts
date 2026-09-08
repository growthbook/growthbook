// Applies the shared URL scrubber to every URL-bearing surface of an rrweb
// event before it lands in the buffer
import { scrubUrl, type UrlScrubSettings } from "../utils/privacy";

// Attributes that navigate. Resource attributes are opt-in because signed
// image URLs stop loading in replay once their query is stripped.
const NAVIGATION_URL_ATTRS = new Set([
  "href",
  "action",
  "formaction",
  "data-href",
  "data-url",
  "cite",
  "longdesc",
]);
const RESOURCE_URL_ATTRS = new Set(["src", "poster", "background"]);

// Returns the same object when nothing changed so the hot path allocates
// nothing
function scrubUrlAttrs<T extends Record<string, unknown>>(
  attrs: T,
  settings: UrlScrubSettings,
): T {
  let out: Record<string, unknown> | null = null;
  for (const key in attrs) {
    const name = key.toLowerCase();
    if (
      !NAVIGATION_URL_ATTRS.has(name) &&
      !(settings.scrubResourceUrls && RESOURCE_URL_ATTRS.has(name))
    )
      continue;
    const value = attrs[key];
    if (typeof value !== "string" || !value) continue;
    const scrubbed = scrubUrl(value, settings);
    if (scrubbed === value) continue;
    out = out ?? { ...attrs };
    out[key] = scrubbed;
  }
  return (out as T) ?? attrs;
}

// Rebuilds the serialized DOM tree only along paths that changed
function scrubTreeUrls(node: unknown, settings: UrlScrubSettings): unknown {
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
      const replaced = scrubTreeUrls(original, settings);
      if (replaced !== original) childChanged = true;
      next[i] = replaced;
    }
    if (childChanged) newChildNodes = next;
  }

  let newAttributes: Record<string, unknown> | undefined;
  if (n.attributes && typeof n.attributes === "object") {
    const scrubbed = scrubUrlAttrs(n.attributes, settings);
    if (scrubbed !== n.attributes) newAttributes = scrubbed;
  }

  if (!newAttributes && !newChildNodes) return node;
  return {
    ...n,
    ...(newAttributes ? { attributes: newAttributes } : {}),
    ...(newChildNodes ? { childNodes: newChildNodes } : {}),
  };
}

// Meta href (type 4), FullSnapshot tree attributes (type 2), and Mutation
// attribute changes (type 3, source 0). Returns the original event when
// nothing changed.
export function scrubEventUrls<T extends { type: number; data?: unknown }>(
  event: T,
  settings: UrlScrubSettings = {},
): T {
  if (event.type === 4) {
    const data = event.data as { href?: string } | undefined;
    if (!data || typeof data.href !== "string") return event;
    const scrubbedHref = scrubUrl(data.href, settings);
    if (scrubbedHref === data.href) return event;
    return { ...event, data: { ...data, href: scrubbedHref } };
  }

  if (event.type === 2) {
    const data = event.data as { node?: unknown } | undefined;
    if (!data || !data.node) return event;
    const scrubbedNode = scrubTreeUrls(data.node, settings);
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
      const scrubbed = scrubUrlAttrs(m.attributes, settings);
      if (scrubbed === m.attributes) return m;
      mutationsChanged = true;
      return { ...m, attributes: scrubbed };
    });
    if (!mutationsChanged) return event;
    return { ...event, data: { ...data, attributes: newMutations } };
  }

  return event;
}
