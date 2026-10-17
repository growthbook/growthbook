const URL_BREAKS = "/?&=#-_.";

function pathAfterHost(url: URL): string {
  return url.pathname + url.search + url.hash;
}

/**
 * How a redirect's destination reads beside its origin on the same host: the
 * path from the last segment the two share, then what differs in whole words.
 * Null for another host or an unparseable URL, which show in full.
 */
export function redirectDestinationParts(
  from: string,
  to: string,
): { elided: boolean; kept: string; changed: string } | null {
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
  let changed = 0;
  while (changed < fromPath.length && fromPath[changed] === toPath[changed]) {
    changed++;
  }
  while (
    changed > 0 &&
    !URL_BREAKS.includes(toPath[changed - 1]) &&
    !URL_BREAKS.includes(toPath[changed] ?? "/")
  ) {
    changed--;
  }
  // Up a level, as to the homepage: nothing is added, so the path says it.
  if (changed >= toPath.length) {
    return { elided: false, kept: "", changed: toPath };
  }
  const cut = Math.max(toPath.lastIndexOf("/", changed - 1), 0);
  return {
    elided: cut > 0,
    kept: toPath.slice(cut, changed),
    changed: toPath.slice(changed),
  };
}
