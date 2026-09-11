// The AI agent emits standard Markdown, but Slack uses its own "mrkdwn" dialect
// (links are <url|label>, bold is *single-asterisk*, no headings). This is a
// lightweight, good-enough conversion for chat replies — not a full Markdown
// parser. Relative app links (e.g. /experiment/abc) are made absolute so they
// are clickable from Slack.

export function escapeSlackText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function toSlackMrkdwn(
  markdown: string,
  { appOrigin }: { appOrigin: string },
): string {
  const origin = appOrigin.replace(/\/$/, "");
  // Escape raw Slack controls before adding our own validated link syntax.
  let text = "";
  let end = 0;
  const links = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(links)) {
    const index = match.index ?? 0;
    text += escapeSlackText(markdown.slice(end, index));
    const [full, label, href] = match;
    try {
      if (/[<>|\s]/.test(href)) throw new Error("Invalid link");
      const url = new URL(href.startsWith("/") ? `${origin}${href}` : href);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("Invalid link protocol");
      text += `<${escapeSlackText(url.href)}|${escapeSlackText(label).replace(/\|/g, "｜")}>`;
    } catch {
      text += escapeSlackText(full);
    }
    end = index + full.length;
  }
  text += escapeSlackText(markdown.slice(end));

  // Bold: **text** or __text__ → *text* (Slack bold is a single asterisk).
  text = text.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  text = text.replace(/__([^_]+)__/g, "*$1*");

  // Markdown headings have no Slack equivalent — render them as a bold line.
  text = text.replace(/^#{1,6}\s+(.*)$/gm, "*$1*");

  return text.trim();
}
