function isRootRelativePath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function resolveAgentInternalHref(
  href: string,
  currentOrigin?: string | null,
): string | null {
  if (isRootRelativePath(href)) return href;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (url.origin === currentOrigin) {
    return `${url.pathname}${url.search}${url.hash}`;
  }

  if (url.hostname !== "app.growthbook.io") {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
