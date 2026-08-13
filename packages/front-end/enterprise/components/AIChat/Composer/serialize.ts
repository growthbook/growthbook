import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { AIChatMention, AIChatMentionType } from "shared/ai-chat";
import { METRIC_MENTION_NAME } from "./extensions/metricMention";

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
  // Mention nodes serialize through the extension's `renderText`, so they land
  // in the string as "@Name" — readable in the chat bubble and in history.
  return editor.getText({ blockSeparator: "\n" });
}

/**
 * The mentions currently in the document, in document order and de-duplicated
 * by id — mentioning the same metric twice is one reference, not two.
 *
 * Sent alongside the text so the agent can resolve each "@Name" to an exact id
 * instead of searching for it.
 *
 * Takes the document rather than the editor so a ProseMirror key handler can
 * call it with its own `view.state.doc`.
 */
export function collectMentions(doc: ProseMirrorNode): AIChatMention[] {
  const seen = new Set<string>();
  const mentions: AIChatMention[] = [];

  doc.descendants((node) => {
    if (node.type.name !== METRIC_MENTION_NAME) return;
    const { id, label, metricType } = node.attrs;
    if (typeof id !== "string" || !id || seen.has(id)) return;
    if (typeof label !== "string" || !label) return;
    seen.add(id);
    mentions.push({
      id,
      name: label,
      type: metricType as AIChatMentionType,
    });
  });

  return mentions;
}
