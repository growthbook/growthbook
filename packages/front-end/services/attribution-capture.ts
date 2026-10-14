/**
 * Client-side fallback capture for the gb_attr cookie. Mirrors the script
 * embedded in Webflow on www.growthbook.io so that users who land directly
 * on app.growthbook.io with UTMs (e.g. paid ads pointing at signup) still
 * have their attribution captured.
 *
 * The cookie is set on Domain=.growthbook.io so it's shared across all
 * subdomains. The Webflow snippet uses identical logic — first-touch is
 * preserved against direct visits, last-touch wins on new UTM visits.
 * One exception: our own docs links (utm_source=docs) never replace a cookie
 * that already holds a campaign or ad click ID.
 */

const COOKIE = "gb_attr";
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
// Internal links from our docs carry this source so docs-driven sign-ups can
// be measured, but they shouldn't erase an earlier paid touch.
const INTERNAL_SOURCE = "docs";
const PAID_KEYS = [
  "utm_campaign",
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

function hasPaidTouch(cookie: string | null): boolean {
  if (!cookie) return false;
  try {
    const parsed: unknown = JSON.parse(cookie);
    if (typeof parsed !== "object" || parsed === null) return false;
    const fields = new Map(Object.entries(parsed));
    return PAID_KEYS.some((k) => !!fields.get(k));
  } catch {
    return false;
  }
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

export function captureAttribution(): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const touch: Record<string, string> = {};
  let hasNewTouch = false;

  for (const k of ATTRIB_KEYS) {
    const v = params.get(k);
    if (v) {
      touch[k] = v;
      hasNewTouch = true;
    }
  }

  const existing = getCookie(COOKIE);

  if (touch.utm_source === INTERNAL_SOURCE && hasPaidTouch(existing)) return;

  if (hasNewTouch) {
    touch.referrer = document.referrer || "";
    touch.landing_page = sanitizedLandingPage();
    touch.touch_at = new Date().toISOString();
    setCookie(COOKIE, JSON.stringify(touch));
  } else if (!existing) {
    setCookie(
      COOKIE,
      JSON.stringify({
        referrer: document.referrer || "",
        landing_page: sanitizedLandingPage(),
        touch_at: new Date().toISOString(),
      }),
    );
  }
}
