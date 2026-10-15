/**
 * Client-side fallback capture for the gb_attr cookie. Mirrors the script
 * embedded in Webflow on www.growthbook.io so that users who land directly
 * on app.growthbook.io with UTMs (e.g. paid ads pointing at signup) still
 * have their attribution captured.
 *
 * The cookie is set on Domain=.growthbook.io so it's shared across all
 * subdomains. Its top-level fields hold the last touch: a new UTM visit
 * replaces them, while a direct visit leaves them alone. `first_touch` holds
 * the first touch and is never overwritten, so both reach the license
 * server at sign-up. The Webflow snippet must follow the same logic.
 */

const COOKIE = "gb_attr";
const FIRST_TOUCH_KEY = "first_touch";
const TTL_DAYS = 30;
const ATTRIB_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "li_fat_id",
  "fbclid",
  "msclkid",
] as const;

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, value: string): void {
  document.cookie = [
    `${name}=${encodeURIComponent(value)}`,
    "Domain=.growthbook.io",
    "Path=/",
    `Max-Age=${TTL_DAYS * 86400}`,
    "SameSite=Lax",
    "Secure",
  ].join("; ");
}

/**
 * Drop the query string and hash entirely. UTMs and click IDs are already
 * stored as first-class fields on the cookie, so duplicating them here adds
 * no signal — and dropping everything is the safest default against future
 * sensitive params (tokens, reset codes, hashed emails, etc.) showing up.
 */
function sanitizedLandingPage(): string {
  return window.location.origin + window.location.pathname;
}

type Touch = Record<string, string>;

function entriesOf(value: unknown): [string, unknown][] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return Object.entries(value);
}

function stringFields(entries: [string, unknown][]): Touch {
  const fields: Touch = {};
  for (const [k, v] of entries) {
    if (typeof v === "string") fields[k] = v;
  }
  return fields;
}

/**
 * Split an existing cookie into its last touch (the top-level fields) and its
 * first touch. Cookies written before first_touch existed have only a last
 * touch, which is also the earliest touch we know about.
 */
function readCookie(): { last: Touch; first: Touch } | null {
  const raw = getCookie(COOKIE);
  if (!raw) return null;
  let entries: [string, unknown][] | null;
  try {
    entries = entriesOf(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!entries) return null;
  const last = stringFields(entries);
  const firstEntries = entriesOf(new Map(entries).get(FIRST_TOUCH_KEY));
  return { last, first: firstEntries ? stringFields(firstEntries) : last };
}

export function captureAttribution(): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const touch: Touch = {};
  let hasNewTouch = false;

  for (const k of ATTRIB_KEYS) {
    const v = params.get(k);
    if (v) {
      touch[k] = v;
      hasNewTouch = true;
    }
  }

  const existing = readCookie();

  // A direct visit never changes an existing cookie
  if (existing && !hasNewTouch) return;

  touch.referrer = document.referrer || "";
  touch.landing_page = sanitizedLandingPage();
  touch.touch_at = new Date().toISOString();

  setCookie(
    COOKIE,
    JSON.stringify({ ...touch, [FIRST_TOUCH_KEY]: existing?.first ?? touch }),
  );
}
