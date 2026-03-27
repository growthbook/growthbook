const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;

/**
 * Returns true if a URL is safe to render as an href.
 * Allows relative URLs and URLs with safe protocols (http, https, irc, mailto, xmpp).
 * Blocks javascript:, data:, vbscript:, and other dangerous protocols.
 */
export function isSafeUrl(url: string): boolean {
  const colon = url.indexOf(":");
  const questionMark = url.indexOf("?");
  const numberSign = url.indexOf("#");
  const slash = url.indexOf("/");

  return (
    // No protocol — it's relative
    colon < 0 ||
    // Colon is after ?, #, or / — not a protocol
    (slash > -1 && colon > slash) ||
    (questionMark > -1 && colon > questionMark) ||
    (numberSign > -1 && colon > numberSign) ||
    // It is a protocol, and it's in the allowlist
    SAFE_PROTOCOL.test(url.slice(0, colon))
  );
}

/**
 * Returns the URL unchanged if safe, or empty string if dangerous.
 */
export function sanitizeUrl(url: string): string {
  return isSafeUrl(url) ? url : "";
}
