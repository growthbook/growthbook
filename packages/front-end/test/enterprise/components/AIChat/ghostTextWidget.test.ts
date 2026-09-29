import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import TextNode from "@tiptap/extension-text";
import {
  GhostText,
  GHOST_TEXT_NAME,
} from "@/enterprise/components/AIChat/Composer/extensions/ghostText";

describe("GhostText widget", () => {
  it("renders the continuation and keycap after the last character", () => {
    const el = document.createElement("div");
    const editor = new Editor({
      element: el,
      extensions: [Document, Paragraph, TextNode, GhostText],
      content: "<p>show me the</p>",
    });
    editor.commands.focus("end");
    editor.storage[GHOST_TEXT_NAME].text = " latest experiments.";
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
    const ghost = editor.view.dom.querySelector(".composer-ghost");
    expect(ghost?.textContent).toBe(" latest experiments.Tab");
    expect(editor.view.dom.textContent).toBe(
      "show me the latest experiments.Tab",
    );
    editor.destroy();
  });
});
