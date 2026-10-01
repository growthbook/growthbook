export type MarkdownLinkSegment = string | { label: string; href: string };

// Finds `[label](destination)`; the destination may contain one level of `(…)`.
const MARKDOWN_LINK = /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;

// Same-instance paths, or full http(s) URLs with a host.
export function isAllowedHref(href: string): boolean {
  if (href.startsWith("/")) {
    // Browsers treat `//host` and `/\host` as another site.
    return !href.startsWith("//") && !href.startsWith("/\\");
  }
  try {
    const url = new URL(href);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && url.host !== ""
    );
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
