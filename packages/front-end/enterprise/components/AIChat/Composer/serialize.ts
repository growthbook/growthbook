import type { Editor, JSONContent } from "@tiptap/core";

/**
 * Conversion between the composer's editor document and the plain string the
 * chat hook / API contract works in.
 *
 * - One paragraph per line. Shift+Enter inserts a `hardBreak`, whose
 *   `renderText` is "\n", so both shapes serialize back identically.
 * - ProseMirror rejects empty text nodes, so a blank line becomes a paragraph
 *   with no content rather than one holding "".
 */

export function textToContent(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function editorToText(editor: Editor): string {
  return editor.getText({ blockSeparator: "\n" });
}
