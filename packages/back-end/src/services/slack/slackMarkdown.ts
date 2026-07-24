// The AI agent emits standard Markdown, but Slack uses its own "mrkdwn" dialect
// (links are <url|label>, bold is *single-asterisk*, no headings). This is a
// lightweight, good-enough conversion for chat replies — not a full Markdown
// parser. Relative app links (e.g. /experiment/abc) are made absolute so they
// are clickable from Slack.

export function toSlackMrkdwn(
  markdown: string,
  { appOrigin }: { appOrigin: string },
): string {
  const origin = appOrigin.replace(/\/$/, "");
  let text = markdown;

  // [label](url) → <url|label>, absolutizing same-origin relative paths.
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, url: string) => {
      const abs = url.startsWith("/") ? `${origin}${url}` : url;
      return `<${abs}|${label}>`;
    },
  );

  // Bold: **text** or __text__ → *text* (Slack bold is a single asterisk).
  text = text.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  text = text.replace(/__([^_]+)__/g, "*$1*");

  // Markdown headings have no Slack equivalent — render them as a bold line.
  text = text.replace(/^#{1,6}\s+(.*)$/gm, "*$1*");

  return text.trim();
}
