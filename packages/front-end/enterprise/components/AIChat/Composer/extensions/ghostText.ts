import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const GHOST_TEXT_NAME = "ghostText";

/** Position at the end of the last block — where a continuation would land. */
export function docEnd(doc: { content: { size: number } }): number {
  return doc.content.size - 1;
}

/**
 * Inline grey continuation after the cursor, drawn like the placeholder: a
 * `data-ghost` attribute on the last paragraph that CSS renders via `::after`.
 * Only shown while the caret sits at the very end of the message.
 */
export const GhostText = Extension.create<
  Record<string, never>,
  { text: string }
>({
  name: GHOST_TEXT_NAME,

  addStorage() {
    return { text: "" };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key: new PluginKey(GHOST_TEXT_NAME),
        props: {
          decorations: ({ doc, selection }) => {
            const last = doc.lastChild;
            if (
              !storage.text ||
              !last ||
              !selection.empty ||
              selection.to !== docEnd(doc)
            ) {
              return null;
            }
            return DecorationSet.create(doc, [
              Decoration.node(
                doc.content.size - last.nodeSize,
                doc.content.size,
                { "data-ghost": storage.text },
              ),
            ]);
          },
        },
      }),
    ];
  },
});
