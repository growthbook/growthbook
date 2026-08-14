import { Editor, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import TextNode from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import {
  collectMentions,
  collectSkills,
  editorToText,
  stripDanglingTriggers,
  textToContent,
} from "@/enterprise/components/AIChat/Composer/serialize";
import {
  MetricMention,
  filterMentionItems,
  type MentionItem,
} from "@/enterprise/components/AIChat/Composer/extensions/metricMention";
import {
  SkillCommand,
  filterSkillItems,
  type SkillItem,
} from "@/enterprise/components/AIChat/Composer/extensions/skillCommand";

const EXTENSIONS = [
  Document,
  Paragraph,
  TextNode,
  HardBreak,
  MetricMention,
  // Configured with its trigger char as the composer does: the node resolves
  // its prefix from the extension's suggestion list, so an unconfigured
  // instance would serialize commands with the default "@".
  SkillCommand.configure({ suggestion: { char: "/" } }),
];

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

  describe("slash commands", () => {
    // Mirrors what the composer's `command` inserts, including the trigger
    // char the node serializes with.
    const skillNode = (id: string): JSONContent => ({
      type: "skillCommand",
      attrs: { id, label: id, mentionSuggestionChar: "/" },
    });

    it("serializes a command into the text as /name", () => {
      const editor = makeMentionEditor([
        skillNode("flag-create"),
        { type: "text", text: " a dark mode flag" },
      ]);
      expect(editorToText(editor)).toBe("/flag-create a dark mode flag");
      editor.destroy();
    });

    it("collects the invoked skill", () => {
      const editor = makeMentionEditor([skillNode("flag-create")]);
      expect(collectSkills(editor.state.doc)).toEqual(["flag-create"]);
      editor.destroy();
    });

    it("collects several chained commands in document order", () => {
      const editor = makeMentionEditor([
        skillNode("flag-create"),
        { type: "text", text: " then " },
        skillNode("flag-targeting"),
      ]);
      expect(collectSkills(editor.state.doc)).toEqual([
        "flag-create",
        "flag-targeting",
      ]);
      editor.destroy();
    });

    it("de-duplicates a command repeated in one message", () => {
      const editor = makeMentionEditor([
        skillNode("flag-create"),
        { type: "text", text: " and again " },
        skillNode("flag-create"),
      ]);
      expect(collectSkills(editor.state.doc)).toEqual(["flag-create"]);
      editor.destroy();
    });

    it("returns nothing when there is no command", () => {
      const editor = makeEditor("just text");
      expect(collectSkills(editor.state.doc)).toEqual([]);
      editor.destroy();
    });

    it("does not confuse a mention for a command", () => {
      const editor = makeMentionEditor([
        mentionNode("met_1", "Revenue", "metric"),
      ]);
      expect(collectSkills(editor.state.doc)).toEqual([]);
      editor.destroy();
    });

    it("does not confuse a command for a mention", () => {
      const editor = makeMentionEditor([skillNode("flag-create")]);
      expect(collectMentions(editor.state.doc)).toEqual([]);
      editor.destroy();
    });
  });

  describe("filterSkillItems", () => {
    const items: SkillItem[] = [
      {
        id: "feature-flags",
        label: "feature-flags",
        description: "Read and modify flags",
        kind: "domain",
      },
      {
        id: "flag-targeting",
        label: "flag-targeting",
        description: "Targeting rules",
        kind: "leaf",
        group: "feature-flags",
      },
      {
        id: "experiments",
        label: "experiments",
        description: "Targeting an audience",
        kind: "domain",
      },
    ];

    it("ranks name matches above description matches", () => {
      expect(filterSkillItems(items, "targeting").map((i) => i.id)).toEqual([
        "flag-targeting",
        "experiments",
      ]);
    });

    it("matches on description when the name does not", () => {
      expect(filterSkillItems(items, "modify").map((i) => i.id)).toEqual([
        "feature-flags",
      ]);
    });

    it("returns everything up to the limit for an empty query", () => {
      expect(filterSkillItems(items, "")).toHaveLength(3);
      expect(filterSkillItems(items, "", 2)).toHaveLength(2);
    });

    it("lists domains before leaves when browsing, so entry points stay visible", () => {
      expect(filterSkillItems(items, "").map((i) => i.id)).toEqual([
        "feature-flags",
        "experiments",
        "flag-targeting",
      ]);
    });

    it("keeps every domain visible even when the limit would cut leaves off", () => {
      expect(filterSkillItems(items, "", 2).map((i) => i.id)).toEqual([
        "feature-flags",
        "experiments",
      ]);
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

describe("stripDanglingTriggers", () => {
  it.each([
    // An "@" abandoned by pressing space, then typing on.
    ["@ what about revenue", "what about revenue"],
    // Abandoned at the end and sent with Enter.
    ["what about revenue @", "what about revenue"],
    ["@", ""],
    // "@" is stripped mid-message too — a bare one is never content.
    ["a @ b", "a b"],
  ])("strips a standalone @ in %j", (input, expected) => {
    expect(stripDanglingTriggers(input).trim()).toBe(expected);
  });

  it.each([
    ["/ what are my flags", "what are my flags"],
    ["what are my flags /", "what are my flags"],
    ["/", ""],
  ])("strips an abandoned / in %j", (input, expected) => {
    expect(stripDanglingTriggers(input).trim()).toBe(expected);
  });

  it.each([
    ["email me@example.com", "email me@example.com"],
    ["the @Revenue metric", "the @Revenue metric"],
    ["handle @someone", "handle @someone"],
    ["/feature-flags what do I have?", "/feature-flags what do I have?"],
    // Mid-message "/" is prose, not an abandoned trigger.
    ["what is A / B testing", "what is A / B testing"],
    ["ship it and / or revert", "ship it and / or revert"],
  ])("leaves %j alone", (input, expected) => {
    expect(stripDanglingTriggers(input)).toBe(expected);
  });

  it("handles both triggers abandoned in one message", () => {
    expect(stripDanglingTriggers("/ trend of @ revenue").trim()).toBe(
      "trend of revenue",
    );
  });
});
