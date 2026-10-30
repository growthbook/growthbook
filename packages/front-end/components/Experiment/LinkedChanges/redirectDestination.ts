export function withoutProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

function pathAfterHost(url: URL): string {
  return url.pathname + url.search + url.hash;
}

/**
 * How a redirect's destination reads beside its origin on the same host: the
 * path from the last segment the two share. Null for another host or an
 * unparseable URL, which show in full.
 */
export function redirectDestinationParts(
  from: string,
  to: string,
): { elided: boolean; path: string } | null {
  let fromPath: string;
  let toPath: string;
  try {
    const fromUrl = new URL(from);
    const toUrl = new URL(to);
    if (fromUrl.host !== toUrl.host) return null;
    fromPath = pathAfterHost(fromUrl);
    toPath = pathAfterHost(toUrl);
  } catch {
    return null;
  }
  let shared = 0;
  while (shared < fromPath.length && fromPath[shared] === toPath[shared]) {
    shared++;
  }
  // Up a level, as to the homepage: nothing is added, so the path says it.
  if (shared >= toPath.length) return { elided: false, path: toPath };
  const cut = Math.max(toPath.lastIndexOf("/", shared - 1), 0);
  return { elided: cut > 0, path: toPath.slice(cut) };
}
