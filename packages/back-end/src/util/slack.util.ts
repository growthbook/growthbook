// Neutralize Slack mrkdwn control sequences in user-supplied text: stops
// `<!channel>` mentions and the labelled `<url|text>` form.
//
// Deliberately does NOT stop a bare URL linkifying, or `*bold*`/backticks —
// people paste real URLs into feedback, and a code fence would break that. What
// limits a hostile link is volume, and the survey endpoint is rate limited.
// Order matters: `&` is escaped first so it doesn't double-escape the `&` in
// the `&lt;`/`&gt;` entities produced by the later replaces.
export function escapeSlackMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Slack rejects a section block whose text exceeds its character limit, and
// mrkdwn escaping (`&` -> `&amp;`) can multiply length, so clamp before sending.
// Drop any trailing partial entity so the cut never leaves broken markup.
export function truncateSlackText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).replace(/&[a-z]*$/i, "") + "…";
}

// Converts the AI agent's standard Markdown into Slack mrkdwn for chat replies:
// links become <url|label>, bold becomes *single-asterisk*, headings become a
// bold line, and relative app links (e.g. /experiment/abc) are made absolute so
// they are clickable from Slack. Not a full Markdown parser. Notification cards
// use markdownToSlackMrkdwn in services/notificationCards/markdown.ts, which
// handles inline italic and code but not links or headings.
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
    text += escapeSlackMrkdwn(markdown.slice(end, index));
    const [full, label, href] = match;
    try {
      if (/[<>|\s]/.test(href)) throw new Error("Invalid link");
      const url = new URL(href.startsWith("/") ? `${origin}${href}` : href);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("Invalid link protocol");
      text += `<${escapeSlackMrkdwn(url.href)}|${escapeSlackMrkdwn(label).replace(/\|/g, "｜")}>`;
    } catch {
      text += escapeSlackMrkdwn(full);
    }
    end = index + full.length;
  }
  text += escapeSlackMrkdwn(markdown.slice(end));

  // Bold: **text** or __text__ → *text* (Slack bold is a single asterisk).
  text = text.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  text = text.replace(/__([^_]+)__/g, "*$1*");

  // Markdown headings have no Slack equivalent — render them as a bold line.
  text = text.replace(/^#{1,6}\s+(.*)$/gm, "*$1*");

  return text.trim();
}
