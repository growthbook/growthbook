import { hasMarkdownTable } from "./RichTextEditorTable";

// Whether markdown uses anything beyond plain paragraphs. Escaped characters
// (`\*`) are text, not formatting.
export function hasMarkdownFormatting(markdown: string): boolean {
  if (!markdown.trim()) return false;
  return (
    FORMATTING.some((pattern) => pattern.test(markdown)) ||
    hasMarkdownTable(markdown)
  );
}

const FORMATTING: RegExp[] = [
  // Blocks, at the start of a line.
  /^#{1,6}\s/m,
  /^>\s?/m,
  /^\s*(?:[-*+]|\d+\.)\s/m,
  /^```/m,
  // Inline, unless escaped.
  /(?<!\\)!?\[[^\]\n]*\]\([^)\n]+\)/,
  /(?<!\\)`[^`\n]+`/,
  /(?<!\\)(\*\*|__)(?=\S)[\s\S]*?\S\1/,
  /(?<![\\*\w])\*(?=[^\s*])[^*\n]*?[^\s\\*]\*(?!\*)/,
  /(?<![\\\w])_(?=[^\s_])[^_\n]*?[^\s\\_]_(?!\w)/,
  /(?<!\\)~~(?=\S)[\s\S]*?\S~~/,
];

// Whether clipboard HTML has formatting of its own, not a styled copy of plain
// text (as a terminal gives). Code counts, so it isn't read as markdown.
export function htmlHasFormatting(html: string): boolean {
  return /<(?:table|ul|ol|h[1-6]|blockquote|a|strong|b|em|i|img|pre|code)[\s>]/i.test(
    html,
  );
}
