/**
 * gb_last_active: a readable, non-sensitive hint shared across *.growthbook.io
 * so the marketing site and docs can tailor CTAs for people who use the app.
 *
 * States:
 * - missing: this browser has never signed in to GrowthBook Cloud (or it has
 *   been more than TTL_DAYS since it last did)
 * - ISO timestamp: when this browser last opened the app while signed in
 *
 * It is not cleared on logout, since "has signed in before" is the signal.
 * It carries no identity and is trivially spoofable, so it must only ever be
 * used for UI hints, never for access decisions. Auth cookies are unaffected.
 */

const COOKIE = "gb_last_active";
const COOKIE_DOMAIN = "growthbook.io";
const TTL_DAYS = 365;

export function isGrowthBookHost(hostname: string): boolean {
  return hostname === COOKIE_DOMAIN || hostname.endsWith(`.${COOKIE_DOMAIN}`);
}

export function recordLastActive(): void {
  if (typeof window === "undefined") return;
  // Self-hosted installs live on their own domains, where a
  // Domain=.growthbook.io cookie would be rejected anyway.
  if (!isGrowthBookHost(window.location.hostname)) return;

  document.cookie = [
    `${COOKIE}=${encodeURIComponent(new Date().toISOString())}`,
    `Domain=.${COOKIE_DOMAIN}`,
    "Path=/",
    `Max-Age=${TTL_DAYS * 86400}`,
    "SameSite=Lax",
    "Secure",
  ].join("; ");
}
