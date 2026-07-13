// Helpers for the `/organization/definitions` ETag. The ETag combines the
// org's monotonic definitions version (bumped on every relevant write, see
// `touchDefinitionsVersion`) with the org id and a hash of the requesting
// user's resolved permissions, since the response is permission-filtered per
// user. The org id must be in the ETag: the URL is the same for every org
// (selected via the X-Organization header), so the browser cache can present
// org A's validator on an org B request — versions collide trivially (every
// org starts at 0) and permission fingerprints are identical across orgs for
// the same role, so without the org id that false-matches into a cross-org 304.

// Under file config, metrics/dimensions/datasources/segments come from
// config.yml and bypass the Mongo writes that bump the version, so the parsed
// file's hash joins the ETag to invalidate on file changes.
export function buildDefinitionsEtag(
  version: number,
  organization: string,
  permissionsFingerprint: string,
  configFileHash?: string | null,
): string {
  const configPart = configFileHash ? `-${configFileHash}` : "";
  return `"v${version}-${organization}-${permissionsFingerprint}${configPart}"`;
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
