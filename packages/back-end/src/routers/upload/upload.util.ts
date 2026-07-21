import { posix } from "path";

// Normalize a user-supplied upload path and confirm it stays within the org's
// own folder. Collapsing ".." before the check is what blocks cross-tenant
// traversal like "org_A/../org_B/..." from slipping past a first-segment check.
// Returns the normalized path, or null if it escapes the org's folder.
export function getOrgScopedPath(
  rawPath: string,
  orgId: string,
): string | null {
  const normalized = posix.normalize(rawPath.replace(/^\/+/, ""));
  if (normalized !== orgId && !normalized.startsWith(`${orgId}/`)) {
    return null;
  }
  return normalized;
}
