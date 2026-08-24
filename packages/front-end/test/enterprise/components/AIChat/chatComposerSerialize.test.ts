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
  METRIC_MENTION_NAME,
  filterMentionItems,
  offeredMentionIds,
  type MentionItem,
} from "@/enterprise/components/AIChat/Composer/extensions/metricMention";
import {
  SkillCommand,
  filterSkillItems,
  skillDisplayName,
  type SkillItem,
} from "@/enterprise/components/AIChat/Composer/extensions/skillCommand";
import { mentionTypeLabel } from "@/enterprise/components/AIChat/Composer/useMentionItems";

const EXTENSIONS = [
  Document,
  Paragraph,
  TextNode,
  HardBreak,
  MetricMention,
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

    it("marks mentions the @ menu no longer offers with data-stale", () => {
      const element = document.createElement("div");
      const editor = new Editor({
        element,
        extensions: EXTENSIONS,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                mentionNode("met_1", "Revenue", "metric"),
                { type: "text", text: " vs " },
                mentionNode("met_2", "Signups", "metric"),
              ],
            },
          ],
        },
      });

      const sync = (items: MentionItem[], ready: boolean) => {
        editor.storage[METRIC_MENTION_NAME].items = items;
        editor.storage[METRIC_MENTION_NAME].ready = ready;
        editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
        return Array.from(element.querySelectorAll("[data-stale]")).map((el) =>
          el.getAttribute("data-id"),
        );
      };

      const revenue: MentionItem = {
        id: "met_1",
        label: "Revenue",
        metricType: "metric",
        typeLabel: "Revenue",
      };

      expect(sync([], false)).toEqual([]);
      expect(sync([revenue], true)).toEqual(["met_2"]);
      expect(
        element.querySelector("[data-stale]")?.getAttribute("aria-label"),
      ).toBe("@Signups, not available in the selected Data Source");
      expect(sync([], true)).toEqual(["met_1", "met_2"]);

      editor.destroy();
    });
  });

  describe("filterMentionItems", () => {
    const items: MentionItem[] = [
      { id: "1", label: "Revenue", metricType: "metric", typeLabel: "Revenue" },
      {
        id: "2",
        label: "Total Revenue",
        metricType: "metric",
        typeLabel: "Count",
      },
      {
        id: "3",
        label: "Signups",
        metricType: "factMetric",
        typeLabel: "Proportion",
      },
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

    describe("offeredMentionIds", () => {
      it("collects the ids currently on offer", () => {
        expect(offeredMentionIds(items)).toEqual(new Set(["1", "2", "3"]));
      });
    });
  });

  describe("slash commands", () => {
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

  describe("skillDisplayName", () => {
    it("opens up hyphens and capitalizes only the first word", () => {
      expect(skillDisplayName("flag-default-value")).toBe("Flag default value");
      expect(skillDisplayName("dashboard-create")).toBe("Dashboard create");
    });

    it("leaves a single-word id alone apart from the initial capital", () => {
      expect(skillDisplayName("dashboards")).toBe("Dashboards");
    });

    it("tolerates stray and repeated hyphens", () => {
      expect(skillDisplayName("-flag--create-")).toBe("Flag create");
    });

    it("returns an empty string for an empty id", () => {
      expect(skillDisplayName("")).toBe("");
    });

    it("keeps the pinned spelling of a proper noun", () => {
      expect(skillDisplayName("growthbook-docs")).toBe("GrowthBook docs");
    });
  });

  describe("filterSkillItems", () => {
    const items: SkillItem[] = [
      {
        id: "feature-flags",
        label: "feature-flags",
        title: "Feature flags",
        description: "Read and modify flags",
        group: "feature-flags",
      },
      {
        id: "flag-targeting",
        label: "flag-targeting",
        title: "Flag targeting",
        description: "Targeting rules",
        group: "feature-flags",
      },
      {
        id: "experiments",
        label: "experiments",
        title: "Experiments",
        description: "Targeting an audience",
        group: "experiments",
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

    it("keeps the server's order when browsing, so a group stays together", () => {
      expect(filterSkillItems(items, "").map((i) => i.id)).toEqual([
        "feature-flags",
        "flag-targeting",
        "experiments",
      ]);
    });

    it("truncates from the end when the limit bites", () => {
      expect(filterSkillItems(items, "", 2).map((i) => i.id)).toEqual([
        "feature-flags",
        "flag-targeting",
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
    ["@ what about revenue", "what about revenue"],
    ["what about revenue @", "what about revenue"],
    ["@", ""],
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

describe("mentionTypeLabel", () => {
  it.each([
    ["proportion", "Proportion"],
    ["mean", "Mean"],
    ["ratio", "Ratio"],
    ["retention", "Retention"],
    ["quantile", "Quantile"],
    ["dailyParticipation", "Daily Participation"],
  ])("labels the fact metric type %j as %j", (raw, expected) => {
    expect(mentionTypeLabel("factMetric", raw)).toBe(expected);
  });

  it.each([
    ["binomial", "Binomial"],
    ["count", "Count"],
    ["revenue", "Revenue"],
  ])("labels the legacy metric type %j as %j", (raw, expected) => {
    expect(mentionTypeLabel("metric", raw)).toBe(expected);
  });

  it("labels a metric group by its kind, since it has no statistical type", () => {
    expect(mentionTypeLabel("metricGroup")).toBe("Metric Group");
  });

  it("labels a dashboard, which has no statistical type at all", () => {
    expect(mentionTypeLabel("dashboard")).toBe("Dashboard");
  });

  it("names the kind rather than leaking a raw enum it doesn't know", () => {
    expect(mentionTypeLabel("factMetric", "somethingNew")).toBe("Fact Metric");
    expect(mentionTypeLabel("metric", undefined)).toBe("Metric");
  });
});
