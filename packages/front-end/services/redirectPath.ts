// Only a same-origin relative path is trusted as a redirect target.
// Rejects protocol-relative (//host) and backslash (/\host) escapes.
export function isSameOriginRelativePath(path: string): boolean {
  return /^\/(?![/\\])/.test(path);
}

// Maps a Vercel experimentation_item_id ("features:<id>" or "experiment:<id>")
// to an in-app path, or undefined if it isn't a recognized deep link.
export function getVercelDeepLinkPath(
  experimentationItemId: string | undefined,
): string | undefined {
  const match = experimentationItemId?.match(/^(features|experiment):(.*)$/s);
  if (!match) return undefined;
  const path = `/${match[1]}/${match[2]}`;
  return isSameOriginRelativePath(path) ? path : undefined;
}
