import { UnrecoverableApiError } from "back-end/src/util/errors";

// Resolve a user-supplied path/segment against a fixed base URL and ensure it
// stays on the expected host and within the base path. Using the URL
// constructor neutralizes authority injection (e.g. a leading "@" or "//") that
// string concatenation would allow, preventing SSRF to arbitrary hosts.
export function resolveProxyUrl(
  pathOrSegment: string,
  baseUrl: string,
): string {
  const base = new URL(baseUrl);

  // Strip leading slashes so the input always resolves relative to the base
  // path. Without this, "/foo" would resolve from the host root and drop the
  // base path entirely (e.g. ".../console/v1/" + "/foo" -> "/foo").
  const relative = pathOrSegment.replace(/^\/+/, "");

  let resolved: URL;
  try {
    resolved = new URL(relative, baseUrl);
  } catch {
    throw new UnrecoverableApiError("Invalid request URL.");
  }
  // Reject anything that changes the host (authority injection) or escapes the
  // base path via "../" traversal.
  if (
    resolved.origin !== base.origin ||
    !resolved.pathname.startsWith(base.pathname)
  ) {
    throw new UnrecoverableApiError("Invalid request URL.");
  }
  return resolved.toString();
}
