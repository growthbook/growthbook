// Neutralize Slack mrkdwn control sequences in user-supplied text. Escaping
// these three chars stops `<!channel>`/`<!here>` mentions and link markup from
// being interpreted, so a comment can't ping the channel or inject links.
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
