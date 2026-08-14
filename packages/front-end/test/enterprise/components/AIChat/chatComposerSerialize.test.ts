import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import TextNode from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import {
  editorToText,
  textToContent,
} from "@/enterprise/components/AIChat/Composer/serialize";

function makeEditor(content: string) {
  return new Editor({
    extensions: [Document, Paragraph, TextNode, HardBreak],
    content: textToContent(content),
  });
}

describe("chat composer serialization", () => {
  describe("textToContent", () => {
    it("maps each line to a paragraph", () => {
      expect(textToContent("a\nb")).toEqual({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
          { type: "paragraph", content: [{ type: "text", text: "b" }] },
        ],
      });
    });

    it("leaves blank lines contentless, since ProseMirror rejects empty text nodes", () => {
      expect(textToContent("")).toEqual({
        type: "doc",
        content: [{ type: "paragraph" }],
      });
      expect(textToContent("a\n\nb").content?.[1]).toEqual({
        type: "paragraph",
      });
    });
  });

  describe("round trip", () => {
    it.each([
      ["", ""],
      ["hello", "hello"],
      ["two\nlines", "two\nlines"],
      ["blank\n\nline", "blank\n\nline"],
      ["trailing\n", "trailing\n"],
      ["  leading and trailing  ", "  leading and trailing  "],
      ["emoji 🎯 and @ and /", "emoji 🎯 and @ and /"],
    ])("preserves %j", (input, expected) => {
      const editor = makeEditor(input);
      expect(editorToText(editor)).toBe(expected);
      editor.destroy();
    });
  });

  describe("hard breaks", () => {
    it("serializes a hard break as a newline, matching a multi-paragraph doc", () => {
      const editor = new Editor({
        extensions: [Document, Paragraph, TextNode, HardBreak],
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "a" },
                { type: "hardBreak" },
                { type: "text", text: "b" },
              ],
            },
          ],
        },
      });
      expect(editorToText(editor)).toBe("a\nb");
      editor.destroy();
    });
  });
});
