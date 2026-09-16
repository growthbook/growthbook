// Inline markdown shared by the image cards and the plain-text channels.
//
// Card prose (conclusions, labeled fields) is markdown so producers can style
// a variation name in italics. User-authored text that lands inside it -
// variation names, metric names, stop reasons - is escaped so a `*` or `_` in
// a name stays literal on the card and survives the trip back to plain text.

export type MdRun = {
  text: string;
  bold?: boolean;
  code?: boolean;
  italic?: boolean;
};

// Characters a backslash may escape. Bullets/headings only matter at the
// start of a line, so `escapeInlineMarkdown` escapes `#`, `+` and `-` there.
const ESCAPABLE = "\\*_`[#+-";
const SENTINEL_BASE = 0xe000;
const SENTINEL_RANGE = new RegExp(
  `[\\u{${SENTINEL_BASE.toString(16)}}-\\u{${(
    SENTINEL_BASE +
    ESCAPABLE.length -
    1
  ).toString(16)}}]`,
  "gu",
);

// Swap `\x` escapes for private-use sentinels so the mark regexes skip them.
const protectEscapes = (s: string): string =>
  s.replace(/\\([\\*_`[#+-])/g, (_, c: string) =>
    String.fromCharCode(SENTINEL_BASE + ESCAPABLE.indexOf(c)),
  );

const restoreEscapes = (s: string): string =>
  s.replace(
    SENTINEL_RANGE,
    (ch) => ESCAPABLE[ch.codePointAt(0)! - SENTINEL_BASE] ?? ch,
  );

// Make user text safe to embed in card markdown.
export function escapeInlineMarkdown(text: string): string {
  return text.replace(/[\\*_`[]/g, "\\$&").replace(/^([#+-])/, "\\$1");
}

// Parse bold (**x** / __x__), `code`, italic (*x* / _x_) and [label](url)
// into styled runs. The italic branch is boundary-guarded so it doesn't fire
// inside snake_case identifiers. Not a full parser - just the marks that show
// up in short experiment write-ups.
export function parseInlineMarkdown(input: string): MdRun[] {
  // Links first: keep the label, drop the URL (not clickable in an image).
  const s = protectEscapes(input).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const runs: MdRun[] = [];
  const re =
    /(\*\*|__)(.+?)\1|`([^`]+)`|(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\4(?![\w*])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) runs.push({ text: m[3], code: true });
    else if (m[5] !== undefined) runs.push({ text: m[5], italic: true });
    last = re.lastIndex;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs
    .map((r) => ({ ...r, text: restoreEscapes(r.text) }))
    .filter((r) => r.text.length > 0);
}

// Drop the marks for plain-text channels; escaped characters come back literal.
export function markdownToPlainText(markdown: string): string {
  return parseInlineMarkdown(markdown)
    .map((r) => r.text)
    .join("");
}
