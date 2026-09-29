import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const GHOST_TEXT_NAME = "ghostText";
/** Global class on the widget, since it's built outside React. */
export const GHOST_TEXT_CLASS = "composer-ghost";

/** Position at the end of the last block — where a continuation would land. */
export function docEnd(doc: { content: { size: number } }): number {
  return doc.content.size - 1;
}

/**
 * Inline grey continuation after the cursor, with a Tab keycap right after
 * its last character. A widget decoration, so it flows with the text but is
 * never part of the document. Only shown while the caret sits at the very end.
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
            if (
              !storage.text ||
              !selection.empty ||
              selection.to !== docEnd(doc)
            ) {
              return null;
            }
            return DecorationSet.create(doc, [
              Decoration.widget(
                docEnd(doc),
                () => {
                  const el = document.createElement("span");
                  el.className = GHOST_TEXT_CLASS;
                  el.setAttribute("aria-hidden", "true");
                  el.textContent = storage.text;
                  const kbd = document.createElement("kbd");
                  // Radix Kbd size 1, by class: the app's keycap, built outside React.
                  kbd.className = "rt-Kbd rt-r-size-1";
                  kbd.textContent = "Tab";
                  el.appendChild(kbd);
                  return el;
                },
                { side: 1, ignoreSelection: true },
              ),
            ]);
          },
        },
      }),
    ];
  },
});
