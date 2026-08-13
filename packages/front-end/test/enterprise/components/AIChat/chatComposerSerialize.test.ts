import { Editor, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import TextNode from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import {
  collectMentions,
  editorToText,
  textToContent,
} from "@/enterprise/components/AIChat/Composer/serialize";
import {
  MetricMention,
  filterMentionItems,
  type MentionItem,
} from "@/enterprise/components/AIChat/Composer/extensions/metricMention";

const EXTENSIONS = [Document, Paragraph, TextNode, HardBreak, MetricMention];

function makeEditor(content: string) {
  return new Editor({
    extensions: EXTENSIONS,
    content: textToContent(content),
  });
}

function mentionNode(
  id: string,
  label: string,
  metricType: string,
): JSONContent {
  return { type: "metricMention", attrs: { id, label, metricType } };
}

/** A paragraph of mixed text and mention nodes. */
function makeMentionEditor(content: JSONContent[]) {
  return new Editor({
    extensions: EXTENSIONS,
    content: { type: "doc", content: [{ type: "paragraph", content }] },
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

  describe("mentions", () => {
    it("serializes a mention into the text as @Label", () => {
      const editor = makeMentionEditor([
        { type: "text", text: "how is " },
        mentionNode("met_1", "Revenue", "metric"),
        { type: "text", text: " doing?" },
      ]);
      expect(editorToText(editor)).toBe("how is @Revenue doing?");
      editor.destroy();
    });

    it("collects mentions in document order with their ids and types", () => {
      const editor = makeMentionEditor([
        mentionNode("met_1", "Revenue", "metric"),
        { type: "text", text: " vs " },
        mentionNode("fact__2", "Signups", "factMetric"),
      ]);
      expect(collectMentions(editor.state.doc)).toEqual([
        { id: "met_1", name: "Revenue", type: "metric" },
        { id: "fact__2", name: "Signups", type: "factMetric" },
      ]);
      editor.destroy();
    });

    it("de-duplicates by id, since mentioning twice is one reference", () => {
      const editor = makeMentionEditor([
        mentionNode("met_1", "Revenue", "metric"),
        { type: "text", text: " and " },
        mentionNode("met_1", "Revenue", "metric"),
      ]);
      expect(collectMentions(editor.state.doc)).toHaveLength(1);
      editor.destroy();
    });

    it("returns nothing for a document with no mentions", () => {
      const editor = makeEditor("just text");
      expect(collectMentions(editor.state.doc)).toEqual([]);
      editor.destroy();
    });
  });

  describe("filterMentionItems", () => {
    const items: MentionItem[] = [
      { id: "1", label: "Revenue", metricType: "metric" },
      { id: "2", label: "Total Revenue", metricType: "metric" },
      { id: "3", label: "Signups", metricType: "factMetric" },
    ];

    it("ranks prefix matches above substring matches", () => {
      expect(filterMentionItems(items, "revenue").map((i) => i.id)).toEqual([
        "1",
        "2",
      ]);
    });

    it("is case-insensitive and ignores surrounding whitespace", () => {
      expect(
        filterMentionItems(items, "  SIGN ".trim()).map((i) => i.id),
      ).toEqual(["3"]);
    });

    it("returns everything up to the limit for an empty query", () => {
      expect(filterMentionItems(items, "")).toHaveLength(3);
      expect(filterMentionItems(items, "", 2)).toHaveLength(2);
    });

    it("returns nothing when no label matches", () => {
      expect(filterMentionItems(items, "zzz")).toEqual([]);
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
