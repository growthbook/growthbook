// Neutralize Slack mrkdwn control sequences in user-supplied text. Escaping
// these three chars stops `<!channel>`/`<!here>` mentions and the labelled
// `<url|text>` form, so a comment can't ping the channel or hide a link behind
// friendly text.
//
// It does NOT stop a bare URL rendering as a link, and it leaves `*bold*`,
// `_italic_` and backticks to Slack. That is deliberate: people paste real URLs
// into feedback to show what they mean, and wrapping the comment in a code fence
// to kill linkification would break that. What keeps a hostile link from being
// worth planting is volume, so the survey endpoint is rate limited.
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
