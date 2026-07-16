import md5 from "md5";

// Helpers for the `/organization/definitions` ETag. The ETag combines the org's
// global definitions version (bumped by writes that affect every reader — see
// `touchDefinitionsVersion`) with the org id, a hash of the requesting user's
// resolved permissions (the response is permission-filtered per user), and a
// hash of the versions of just the projects that user can read. The org id must
// be in the ETag: the URL is the same for every org (selected via the
// X-Organization header), so the browser cache can present org A's validator on
// an org B request — versions collide trivially (every org starts at 0) and
// permission fingerprints are identical across orgs for the same role, so
// without the org id that false-matches into a cross-org 304.
//
// `readableProjects` is the set of projects the user can read (`readData`):
// `null` means "all projects" (a global reader), so every project's version
// joins the ETag; a list means only those projects' versions do, so a write in
// a project the user can't read no longer invalidates their cache.
//
// Under file config, metrics/dimensions/datasources/segments come from
// config.yml and bypass the Mongo writes that bump the version, so the parsed
// file's hash joins the ETag to invalidate on file changes.
export function buildDefinitionsEtag({
  version,
  projectVersions,
  organization,
  permissionsFingerprint,
  readableProjects,
  configFileHash,
}: {
  version: number;
  projectVersions?: Record<string, number>;
  organization: string;
  permissionsFingerprint: string;
  // Project ids the user can read; null = all projects (global reader).
  readableProjects?: string[] | null;
  configFileHash?: string | null;
}): string {
  const versions = projectVersions ?? {};
  const relevant = (
    readableProjects == null
      ? Object.entries(versions)
      : readableProjects
          .map((p) => [p, versions[p]] as const)
          .filter(([, v]) => v !== undefined)
  ).sort(([a], [b]) => (a < b ? -1 : 1));
  // Hash rather than inline: a global reader's list is unbounded, and the hash
  // changes iff a readable project's version does.
  const projectPart = relevant.length
    ? `-p${md5(relevant.map(([p, v]) => `${p}:${v}`).join(","))}`
    : "";
  const configPart = configFileHash ? `-${configFileHash}` : "";
  return `"v${version}-${organization}-${permissionsFingerprint}${projectPart}${configPart}"`;
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
