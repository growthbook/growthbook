import { describe, expect, it } from "vitest";
import { $createParagraphNode, $getRoot, createEditor } from "lexical";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  TRANSFORMERS,
} from "@lexical/markdown";
import { AUTO_LINK_TRANSFORMER } from "@/ui/RichTextEditorAutoLink";
import {
  createTableTransformer,
  splitTableRow,
} from "@/ui/RichTextEditorTable";

const transformers = [
  createTableTransformer([
    AUTO_LINK_TRANSFORMER,
    ...TEXT_FORMAT_TRANSFORMERS,
    ...TEXT_MATCH_TRANSFORMERS,
  ]),
  AUTO_LINK_TRANSFORMER,
  ...TRANSFORMERS,
];

function createTestEditor() {
  return createEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
      TableNode,
      TableRowNode,
      TableCellNode,
    ],
    onError: (e) => {
      throw e;
    },
  });
}

function roundTrip(markdown: string): string {
  const editor = createTestEditor();
  editor.update(() => $convertFromMarkdownString(markdown, transformers), {
    discrete: true,
  });
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(transformers));
}

const TABLE = [
  "| Metric | Control | Variant | Lift |",
  "| --- | --- | --- | --- |",
  "| Conversion | 4.1% | 4.6% | **+12%** |",
  "| [Revenue](https://example.com) | $10 | $11 | +10% |",
].join("\n");

describe("rich text tables", () => {
  it("keeps a table, and the inline formatting in its cells", () => {
    expect(roundTrip(TABLE)).toBe(TABLE);
  });

  it("loads a table as table nodes", () => {
    const editor = createTestEditor();
    editor.update(() => $convertFromMarkdownString(TABLE, transformers), {
      discrete: true,
    });
    const types = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((n) => n.getType()),
    );
    expect(types).toEqual(["table"]);
  });

  it("normalizes a compact table with alignment and keeps text around it", () => {
    const markdown = [
      "## Results",
      "",
      "|Metric|Lift|",
      "|:--|--:|",
      "|Conversion|+12%|",
      "",
      "- Ship it",
    ].join("\n");
    expect(roundTrip(markdown)).toBe(
      [
        "## Results",
        "",
        "| Metric | Lift |",
        "| --- | --- |",
        "| Conversion | +12% |",
        "",
        "- Ship it",
      ].join("\n"),
    );
  });

  it("pads short rows and drops extra cells, as GFM does", () => {
    expect(roundTrip("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |")).toBe(
      "| a | b |\n| --- | --- |\n| 1 |  |\n| 1 | 2 |",
    );
  });

  it("keeps escaped pipes inside a cell", () => {
    expect(roundTrip("| a |\n|---|\n| x \\| y |")).toBe(
      "| a |\n| --- |\n| x \\| y |",
    );
  });

  it("leaves pipes without a delimiter row as text", () => {
    expect(roundTrip("| not | a table |")).toBe("| not | a table |");
  });

  it("inserts pasted markdown as a table rather than lines of text", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph
          .select()
          .insertNodes(
            $generateNodesFromMarkdownString(
              `### Summary\n\n${TABLE}`,
              transformers,
            ),
          );
      },
      { discrete: true },
    );
    expect(
      editor
        .getEditorState()
        .read(() => $convertToMarkdownString(transformers)),
    ).toBe(`### Summary\n\n${TABLE}`);
  });
});

describe("splitTableRow", () => {
  it("splits on unescaped pipes and trims each cell", () => {
    expect(splitTableRow("| a |  b | c \\| d |")).toEqual([
      "a",
      "b",
      "c \\| d",
    ]);
  });
});
