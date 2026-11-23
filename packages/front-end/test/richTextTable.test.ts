import { describe, expect, it } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  createEditor,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalEditor,
  type ParagraphNode,
} from "lexical";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { CodeNode } from "@lexical/code";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableSelectionFrom,
  $insertTableRowAtNode,
  $isTableCellNode,
  $isTableNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  HEADING,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  TRANSFORMERS,
} from "@lexical/markdown";
import { AUTO_LINK_TRANSFORMER } from "@/ui/RichTextEditorAutoLink";
import {
  createTableTransformer,
  $alignColumn,
  $clearColumn,
  $clearRow,
  $moveColumn,
  $moveRow,
  outsideTableCells,
  registerTableKeys,
  registerTableRules,
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

  it("normalizes a compact table, keeping alignment and the text around it", () => {
    const markdown = [
      "## Results",
      "",
      "|Metric|Variant|Lift|Note|",
      "|:--|:-:|--:|--|",
      "|Conversion|B|+12%|ok|",
      "",
      "- Ship it",
    ].join("\n");
    expect(roundTrip(markdown)).toBe(
      [
        "## Results",
        "",
        "| Metric | Variant | Lift | Note |",
        "| :--- | :---: | ---: | --- |",
        "| Conversion | B | +12% | ok |",
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

  it("keeps a backslash typed before a pipe in a cell", () => {
    const markdown = "| a |\n| --- |\n| x\\\\\\|y |";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps escaped pipes inside a cell", () => {
    expect(roundTrip("| a |\n|---|\n| x \\| y |")).toBe(
      "| a |\n| --- |\n| x \\| y |",
    );
  });

  it("loads a table without outer pipes, ending at a blank line", () => {
    expect(roundTrip("a | b\n--- | :-:\n1 | 2\n\nafter")).toBe(
      "| a | b |\n| --- | :---: |\n| 1 | 2 |\n\nafter",
    );
  });

  it("ends a table at a heading or list item, even one with a pipe", () => {
    expect(roundTrip("| a |\n| --- |\n| x |\n## Control | Variant")).toBe(
      "| a |\n| --- |\n| x |\n\n## Control | Variant",
    );
    expect(roundTrip("| a |\n| --- |\n| x |\n- one | two")).toBe(
      "| a |\n| --- |\n| x |\n\n- one | two",
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

describe("table rules", () => {
  function editorWithRules(markdown: string) {
    const editor = createTestEditor();
    registerTableRules(editor);
    registerTableKeys(editor);
    editor.update(() => $convertFromMarkdownString(markdown, transformers), {
      discrete: true,
    });
    return editor;
  }

  function $table() {
    const table = $getRoot().getFirstChild();
    if (!$isTableNode(table)) throw new Error("no table");
    return table;
  }

  function $cell(row: number) {
    const cell = $table().getChildAtIndex(row);
    const first = $isElementNode(cell) ? cell.getFirstChild() : null;
    if (!$isTableCellNode(first)) throw new Error("no cell");
    return first;
  }

  const save = (editor: LexicalEditor) =>
    editor.getEditorState().read(() => $convertToMarkdownString(transformers));

  const bodyCellTypes = (editor: LexicalEditor) =>
    editor.getEditorState().read(() =>
      $cell(1)
        .getChildren()
        .map((n) => n.getType()),
    );

  it("flattens a list put in a cell into the words it saves as", () => {
    const editor = editorWithRules("| a |\n| --- |\n| x |");
    editor.update(
      () => {
        const list = $createListNode("bullet").append(
          $createListItemNode().append($createTextNode("one")),
          $createListItemNode().append($createTextNode("two")),
        );
        $cell(1).getFirstChildOrThrow().replace(list);
      },
      { discrete: true },
    );
    expect(bodyCellTypes(editor)).toEqual(["paragraph", "paragraph"]);
    expect(save(editor)).toBe("| a |\n| --- |\n| one two |");
  });

  it("flattens a heading put in a cell, keeping its text", () => {
    const editor = editorWithRules("| a |\n| --- |\n| x |");
    editor.update(
      () => {
        $cell(1)
          .getFirstChildOrThrow()
          .replace($createHeadingNode("h2").append($createTextNode("Big")));
      },
      { discrete: true },
    );
    expect(bodyCellTypes(editor)).toEqual(["paragraph"]);
    expect(save(editor)).toBe("| a |\n| --- |\n| Big |");
  });

  it("clears a row's or a column's cells, keeping the table and alignment", () => {
    const editor = editorWithRules(
      "| a | b |\n| ---: | --- |\n| **1** | 2 |\n| 3 | 4 |",
    );
    editor.update(() => $clearRow($cell(1)), { discrete: true });
    expect(save(editor)).toBe("| a | b |\n| ---: | --- |\n|  |  |\n| 3 | 4 |");
    editor.update(() => $clearColumn($cell(2)), { discrete: true });
    expect(save(editor)).toBe("|  | b |\n| ---: | --- |\n|  |  |\n|  | 4 |");
  });

  it("moves rows, and the first row stays the header", () => {
    const editor = editorWithRules(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |",
    );
    editor.update(() => $moveRow($cell(1), 1), { discrete: true });
    expect(save(editor)).toBe("| a | b |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |");
    editor.update(() => $moveRow($cell(0), 1), { discrete: true });
    expect(save(editor)).toBe("| 3 | 4 |\n| --- | --- |\n| a | b |\n| 1 | 2 |");
    editor.update(() => $moveRow($cell(0), -1), { discrete: true });
    expect(save(editor)).toBe("| 3 | 4 |\n| --- | --- |\n| a | b |\n| 1 | 2 |");
  });

  it("moves a column with its alignment", () => {
    const editor = editorWithRules("| a | b |\n| ---: | --- |\n| 1 | 2 |");
    editor.update(() => $moveColumn($cell(0), 1), { discrete: true });
    expect(save(editor)).toBe("| b | a |\n| --- | ---: |\n| 2 | 1 |");
  });

  it("drops fixed widths a pasted HTML table brings", () => {
    const editor = editorWithRules("| a |\n| --- |\n| x |");
    editor.update(
      () => {
        $table().setColWidths([300]);
        $cell(1).setWidth(300);
      },
      { discrete: true },
    );
    const widths = editor
      .getEditorState()
      .read(() => [$table().getColWidths(), $cell(1).getWidth()]);
    expect(widths).toEqual([undefined, undefined]);
  });

  it("keeps a column's alignment when a row goes above the header", () => {
    const editor = editorWithRules("| a |\n| ---: |\n| x |");
    editor.update(() => $insertTableRowAtNode($cell(0), false), {
      discrete: true,
    });
    expect(save(editor)).toBe("|  |\n| ---: |\n| a |\n| x |");
  });

  it("keeps the first row as the header when a row goes above it", () => {
    const editor = editorWithRules("| a |\n| --- |\n| x |");
    editor.update(
      () => {
        $table()
          .getFirstChildOrThrow()
          .insertBefore(
            $createTableRowNode().append(
              $createTableCellNode().append(
                $createParagraphNode().append($createTextNode("new")),
              ),
            ),
          );
      },
      { discrete: true },
    );
    const headers = editor
      .getEditorState()
      .read(() => [0, 1, 2].map((row) => $cell(row).getHeaderStyles()));
    expect(headers).toEqual([
      TableCellHeaderStates.ROW,
      TableCellHeaderStates.NO_STATUS,
      TableCellHeaderStates.NO_STATUS,
    ]);
  });

  it("aligns a whole column, and a new row takes its column's alignment", () => {
    const editor = editorWithRules("| a |\n| --- |\n| x |");
    editor.update(() => $alignColumn($cell(1), "right"), { discrete: true });
    editor.update(
      () => {
        $table().append(
          $createTableRowNode().append(
            $createTableCellNode().append(
              $createParagraphNode().append($createTextNode("y")),
            ),
          ),
        );
      },
      { discrete: true },
    );
    const aligns = editor
      .getEditorState()
      .read(() => [0, 1, 2].map((row) => $cell(row).getFormatType()));
    expect(aligns).toEqual(["right", "right", "right"]);
    expect(save(editor)).toBe("| a |\n| ---: |\n| x |\n| y |");
  });
  describe("Backspace and Delete", () => {
    const TABLE_AND_LINE = "| a | b |\n| --- | --- |\n|  | x |\n\nafter";

    // Presses the key with the caret placed by `place`, then reports where
    // it went: a cell's text, "table" for the whole table, or the line's text.
    function press(
      editor: LexicalEditor,
      key: "Backspace" | "Delete",
      place: () => void,
      repeat = false,
    ) {
      editor.update(
        () => {
          place();
          editor.dispatchCommand(
            key === "Backspace" ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND,
            new KeyboardEvent("keydown", { key, repeat }),
          );
        },
        { discrete: true },
      );
      return editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return "table";
        const node = selection.anchor.getNode();
        const cell = node.getParents().find($isTableCellNode);
        return cell ? `cell ${cell.getTextContent()}` : node.getTextContent();
      });
    }

    it("doesn't carry a held key out of a cell or into the table", () => {
      const editor = editorWithRules(TABLE_AND_LINE);
      expect(
        press(editor, "Backspace", () => $cell(1).selectStart(), true),
      ).toBe("cell ");
      expect(
        press(
          editor,
          "Backspace",
          () => $getRoot().getLastChildOrThrow().selectStart(),
          true,
        ),
      ).toBe("after");
    });

    it("leaves a quote's Backspace to the quote, beside a table", () => {
      const editor = editorWithRules(TABLE_AND_LINE);
      expect(
        press(editor, "Backspace", () => {
          const quote = $createQuoteNode().append($createTextNode("q"));
          $getRoot().getLastChildOrThrow().replace(quote);
          quote.selectStart();
        }),
      ).not.toBe("table");
    });

    it("steps from a cleared cell to the end of the one before", () => {
      const editor = editorWithRules(TABLE_AND_LINE);
      expect(press(editor, "Backspace", () => $cell(1).selectStart())).toBe(
        "cell b",
      );
    });

    it("steps forward from a cleared cell with Delete", () => {
      const editor = editorWithRules(TABLE_AND_LINE);
      expect(press(editor, "Delete", () => $cell(1).selectStart())).toBe(
        "cell x",
      );
    });

    it("selects the whole table from the line after it", () => {
      const editor = editorWithRules(TABLE_AND_LINE);
      expect(
        press(editor, "Backspace", () => {
          $getRoot().getLastChildOrThrow().selectStart();
        }),
      ).toBe("table");
      expect(save(editor)).toBe(TABLE_AND_LINE);
    });

    describe("with cells selected", () => {
      const GRID = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";

      function $select(from: [number, number], to: [number, number]) {
        const at = ([row, column]: [number, number]) => {
          const r = $table().getChildAtIndex(row);
          const cell = $isElementNode(r) ? r.getChildAtIndex(column) : null;
          if (!$isTableCellNode(cell)) throw new Error("no cell");
          return cell;
        };
        $setSelection($createTableSelectionFrom($table(), at(from), at(to)));
      }

      it("deletes a whole row", () => {
        const editor = editorWithRules(GRID);
        press(editor, "Backspace", () => $select([2, 0], [2, 1]));
        expect(save(editor)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
      });

      it("doesn't delete on a held key", () => {
        const editor = editorWithRules(GRID);
        press(editor, "Backspace", () => $select([2, 0], [2, 1]), true);
        expect(save(editor)).toBe(GRID);
      });

      it("deletes a whole column", () => {
        const editor = editorWithRules(GRID);
        press(editor, "Delete", () => $select([0, 1], [2, 1]));
        expect(save(editor)).toBe("| a |\n| --- |\n| 1 |\n| 3 |");
      });

      it("leaves the rows and columns of a partial selection", () => {
        const editor = editorWithRules(GRID);
        press(editor, "Backspace", () => $select([1, 0], [2, 0]));
        expect(save(editor)).toBe(GRID);
      });
    });

    it("selects a table that opens the text, from the caret above it", () => {
      const editor = editorWithRules(TABLE_AND_LINE);
      expect(press(editor, "Delete", () => $getRoot().select(0, 0))).toBe(
        "table",
      );
      expect(press(editor, "Backspace", () => $getRoot().select(1, 1))).toBe(
        "table",
      );
    });

    it("removes an empty line on the way into the table", () => {
      const editor = editorWithRules("| a |\n| --- |\n| x |\n\nafter");
      const lines = () =>
        editor.getEditorState().read(() =>
          $getRoot()
            .getChildren()
            .map((n) => n.getTextContent()),
        );
      expect(
        press(editor, "Backspace", () => {
          const empty = $createParagraphNode();
          $table().insertAfter(empty);
          empty.select();
        }),
      ).toBe("table");
      expect(lines()).toEqual(["a\n\nx", "after"]);
    });
  });
});

describe("outsideTableCells", () => {
  it("leaves a typed block shortcut as text in a cell only", () => {
    const [heading] = outsideTableCells([HEADING]);
    if (heading.type !== "element") throw new Error("not an element");
    const editor = createTestEditor();
    const applied: unknown[] = [];
    editor.update(
      () => {
        const inCell = $createParagraphNode();
        const outside = $createParagraphNode();
        $getRoot().append(
          $createTableNodeWith(inCell),
          outside.append($createTextNode("x")),
        );
        applied.push(
          heading.replace(inCell, [], ["# ", "#"], false),
          heading.replace(outside, [], ["# ", "#"], false),
        );
      },
      { discrete: true },
    );
    expect(applied[0]).toBe(false);
    expect(applied[1]).not.toBe(false);
  });
});

function $createTableNodeWith(paragraph: ParagraphNode) {
  return $createTableNode().append(
    $createTableRowNode().append($createTableCellNode().append(paragraph)),
  );
}
