/**
 * Whether markdown uses anything beyond plain paragraphs: emphasis, headings,
 * lists, quotes, code, links or images. Characters the editor escaped (`\*`)
 * are text, not formatting.
 */
export function hasMarkdownFormatting(markdown: string): boolean {
  if (!markdown.trim()) return false;
  return FORMATTING.some((pattern) => pattern.test(markdown));
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
