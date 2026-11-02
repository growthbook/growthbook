// Only a same-origin relative path is trusted as a redirect target.
export function isSameOriginRelativePath(path: string): boolean {
  if (!path.startsWith("/") || typeof window === "undefined") return false;
  try {
    // URL parsing strips tabs/newlines and folds "\" to "/", so compare origins
    const origin = window.location.origin;
    return new URL(path, origin).origin === origin;
  } catch {
    return false;
  }
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
