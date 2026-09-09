/**
 * Privacy vocabulary shared by every plugin that captures page content
 * (session replay, auto-events clickstream). Each label works as a class or
 * a data attribute:
 *   gb-block  — content is hidden: replay draws an opaque box, clickstream
 *               records the click with no element details
 *   gb-mask   — text is redacted: replay masks it, clickstream drops
 *               element_text and data-gb-* attributes
 *   gb-ignore — nothing is captured: replay skips input events, clickstream
 *               skips clicks and form submits
 *   gb-allow  — escapes masking for the element and its descendants
 *
 * Settings passed to one plugin are shared with the others: whatever a
 * plugin omits falls back to what any other plugin provided, then to the
 * defaults. Plugins that both specify a key keep their own value.
 */
import { mergeSettings } from "./settings";

export const GB_BLOCK_CLASS = "gb-block";
export const GB_MASK_CLASS = "gb-mask";
export const GB_IGNORE_CLASS = "gb-ignore";
export const GB_ALLOW_CLASS = "gb-allow";
export const GB_BLOCK_ATTR = "data-gb-block";
export const GB_MASK_ATTR = "data-gb-mask";
export const GB_IGNORE_ATTR = "data-gb-ignore";
export const GB_ALLOW_ATTR = "data-gb-allow";

export const DEFAULT_BLOCK_SELECTOR = `[${GB_BLOCK_ATTR}], .${GB_BLOCK_CLASS}`;
export const DEFAULT_MASK_SELECTOR = `[${GB_MASK_ATTR}], .${GB_MASK_CLASS}`;
export const DEFAULT_IGNORE_SELECTOR = `[${GB_IGNORE_ATTR}], .${GB_IGNORE_CLASS}`;
export const DEFAULT_ALLOW_SELECTOR = `[${GB_ALLOW_ATTR}], .${GB_ALLOW_CLASS}`;

export type UrlScrubSettings = {
  // Query params safe to keep; everything else is stripped (default: all)
  allowQueryParams?: string[];
  // App-specific path-segment patterns to redact, on top of the built-in
  // numeric/UUID/long-hex heuristics
  redactPathPatterns?: RegExp[];
  // Keep `#fragment`. Default false: fragments carry OAuth tokens.
  keepFragment?: boolean;
  // Also scrub src/poster/background URLs. Default false: signed image URLs
  // stop loading in replay once their query is stripped.
  scrubResourceUrls?: boolean;
};

export type PrivacySettings = {
  // Customer selectors, composed with the shipped gb-* labels
  blockSelector?: string;
  maskTextSelector?: string;
  ignoreSelector?: string;
  allowSelector?: string;
  // Mask every input value (default true)
  maskAllInputs?: boolean;
  url?: UrlScrubSettings;
};

// Customer selectors add to the shipped defaults, never replace them
export function composeSelectors(
  defaultSelector: string,
  ...customerSelectors: Array<string | undefined>
): string {
  return [defaultSelector, ...customerSelectors].filter(Boolean).join(", ");
}

// Pool of everything any plugin was configured with
let shared: PrivacySettings = {};

export function sharePrivacySettings(settings: PrivacySettings | undefined) {
  if (settings) shared = mergeSettings(shared, settings);
}

// defaults < settings other plugins provided < this plugin's own
export function resolvePrivacySettings<T extends PrivacySettings>(
  defaults: T,
  own: T | undefined,
): T {
  return mergeSettings(defaults, shared, own);
}

export function _resetPrivacyForTests() {
  shared = {};
}

// Only segments that are unambiguously opaque ids; slugs stay intact
const ID_PATTERNS: RegExp[] = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // 16+ hex chars, so short words like "cafe" survive
  /^[0-9a-f]{16,}$/i,
];

const ID_REPLACEMENT = "[id]";

// Deny-by-default: strips the query, replaces id-like path segments with
// [id], drops the fragment. Relative URLs resolve against the document;
// unparseable ones become "[invalid-url]"
export function scrubUrl(url: string, settings: UrlScrubSettings = {}): string {
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

  const allPatterns = [...ID_PATTERNS, ...(settings.redactPathPatterns ?? [])];
  parsed.pathname = parsed.pathname
    .split("/")
    .map((segment) =>
      segment && allPatterns.some((pattern) => segment.search(pattern) !== -1)
        ? ID_REPLACEMENT
        : segment,
    )
    .join("/");

  const allowed = new Set(settings.allowQueryParams ?? []);
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

  if (!settings.keepFragment) {
    parsed.hash = "";
  }

  return parsed.toString();
}
