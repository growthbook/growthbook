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
