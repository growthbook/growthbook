// Helpers for the `/organization/definitions` ETag. The ETag combines the
// org's monotonic definitions version (bumped on every relevant write, see
// `touchDefinitionsVersion`) with a hash of the requesting user's resolved
// permissions, since the response is permission-filtered per user.

export function buildDefinitionsEtag(
  version: number,
  permissionsFingerprint: string,
): string {
  return `"v${version}-${permissionsFingerprint}"`;
}

// Returns true if the client's If-None-Match header matches our ETag. Handles
// the comma-separated list and weak (`W/`) forms clients or proxies may send;
// our own ETags are always strong, so a weak validator matches its strong
// counterpart here.
export function ifNoneMatchMatches(
  ifNoneMatch: string | string[] | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const header = Array.isArray(ifNoneMatch)
    ? ifNoneMatch.join(",")
    : ifNoneMatch;

  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === etag);
}
