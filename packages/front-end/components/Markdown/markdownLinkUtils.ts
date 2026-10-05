export type MarkdownLinkSegment = string | { label: string; href: string };

// Finds `[label](destination)`; the destination may contain one level of `(…)`.
const MARKDOWN_LINK = /\[([^[\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;

export function isAllowedHref(href: string): boolean {
  // `//host` and `/\host` look relative, but browsers send them to another site.
  if (href.startsWith("/")) {
    return !href.startsWith("//") && !href.startsWith("/\\");
  }
  // Without `//`, a browser on an https page treats `https:example.com` as a path.
  if (!href.startsWith("https://") && !href.startsWith("http://")) return false;
  try {
    new URL(href);
    return true;
  } catch {
    return false;
  }
}

// Splits text into plain strings and links; a disallowed link stays as its original text.
export function splitMarkdownLinks(text: string): MarkdownLinkSegment[] {
  const segments: MarkdownLinkSegment[] = [];
  let end = 0;
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const [raw, label, href] = match;
    if (!isAllowedHref(href)) continue;
    segments.push(text.slice(end, match.index), { label, href });
    end = match.index + raw.length;
  }
  segments.push(text.slice(end));
  return segments.filter((segment) => segment !== "");
}
