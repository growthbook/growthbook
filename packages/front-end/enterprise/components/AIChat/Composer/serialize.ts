import {
  getText,
  getTextSerializersFromSchema,
  type Editor,
  type JSONContent,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { AIChatMention, AIChatMentionType } from "shared/ai-chat";
import { METRIC_MENTION_NAME } from "./extensions/metricMention";
import { SKILL_COMMAND_NAME } from "./extensions/skillCommand";

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

/**
 * Mention and command nodes serialize through their extension's `renderText`,
 * so they land in the string as "@Name" / "/skill" — readable in the chat
 * bubble and in history.
 *
 * Works from the document rather than the editor so a ProseMirror key handler
 * can call it with its own `view.state.doc`.
 */
export function docToText(doc: ProseMirrorNode): string {
  return getText(doc, {
    blockSeparator: "\n",
    textSerializers: getTextSerializersFromSchema(doc.type.schema),
  });
}

export function editorToText(editor: Editor): string {
  return docToText(editor.state.doc);
}

/**
 * Drop an abandoned trigger — one the user typed to open a menu, then dismissed
 * with a space or Enter without picking anything. A real mention or command is
 * a node by then, not loose text, so only stray characters are in scope.
 *
 * The two triggers get different rules because they collide with prose
 * differently:
 *
 * - "@" goes wherever it stands alone. A bare "@" as content is vanishingly
 *   rare, and "me@example.com" is untouched since the "@" isn't standalone.
 * - "/" goes only at the very start or end of the message — the positions a
 *   command is actually abandoned in. Mid-message it is left alone, because
 *   "what is A / B testing" is ordinary prose that stripping would corrupt.
 */
export function stripDanglingTriggers(text: string): string {
  return (
    text
      .replace(
        /(^|[ \t])@([ \t]|$)/g,
        (_match, before: string, after: string) => before || after,
      )
      // Leading "/", plus the whitespace it left behind.
      .replace(/^\/(?=[ \t]|$)[ \t]*/, "")
      // Trailing "/", plus the whitespace before it.
      .replace(/[ \t]+\/$/, "")
  );
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

/**
 * The skill invoked by a `/` command, or null.
 *
 * Only the first is honoured — a turn loads one skill, and silently picking the
 * first is more predictable than picking the last if a user inserts two.
 */
export function collectSkill(doc: ProseMirrorNode): string | null {
  let skill: string | null = null;

  doc.descendants((node) => {
    if (skill !== null) return false;
    if (node.type.name !== SKILL_COMMAND_NAME) return;
    const { id } = node.attrs;
    if (typeof id === "string" && id) skill = id;
    return;
  });

  return skill;
}
