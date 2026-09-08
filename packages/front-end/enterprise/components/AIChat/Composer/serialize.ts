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

/** One paragraph per line. Blank lines stay empty — ProseMirror rejects empty text nodes. */
export function textToContent(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

/** Mention/command nodes render as "@Name" / "/skill". */
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
 * Drop an "@" or "/" typed to open a menu, then dismissed without picking.
 * Standalone "@" is stripped; "@word" is kept (that's also how real mentions
 * serialize). "/" only at the start or end, so "A / B" stays.
 */
export function stripDanglingTriggers(text: string): string {
  return text
    .replace(
      /(^|[ \t])@([ \t]|$)/g,
      (_match, before: string, after: string) => before || after,
    )
    .replace(/^\/(?=[ \t]|$)[ \t]*/, "")
    .replace(/[ \t]+\/$/, "");
}

/** Mentions in document order, de-duplicated by id. */
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

/** Slash-command skills in document order, de-duplicated. */
export function collectSkills(doc: ProseMirrorNode): string[] {
  const seen = new Set<string>();

  doc.descendants((node) => {
    if (node.type.name !== SKILL_COMMAND_NAME) return;
    const { id } = node.attrs;
    if (typeof id === "string" && id) seen.add(id);
  });

  return Array.from(seen);
}
