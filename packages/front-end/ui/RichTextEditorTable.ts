import {
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  isTableRowDivider,
  type MultilineElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { $createParagraphNode } from "lexical";

// A line that starts and ends with a pipe: `| a | b |`.
const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/;

// The cells of a `| a | b |` row, split on pipes that aren't escaped.
export function splitTableRow(line: string): string[] {
  const inner = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function $createCell(markdown: string, header: boolean, inline: Transformer[]) {
  const cell = $createTableCellNode(
    header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
  );
  const nodes = $generateNodesFromMarkdownString(
    markdown.replace(/\\\|/g, "|"),
    inline,
  );
  cell.append(...(nodes.length ? nodes : [$createParagraphNode()]));
  return cell;
}

// One line of markdown per cell, since a table row can't span lines.
function $cellToMarkdown(cell: TableCellNode, inline: Transformer[]): string {
  return $convertToMarkdownString(inline, cell)
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/(?<!\\)\|/g, "\\|");
}

/**
 * GitHub-flavored markdown tables. Cells hold inline markdown only (`inline`
 * are the transformers for it), as in GFM. The first row is always written
 * as the header, which GFM requires; column alignment isn't kept.
 */
export function createTableTransformer(
  inline: Transformer[],
): MultilineElementTransformer {
  return {
    dependencies: [TableNode, TableRowNode, TableCellNode],
    export: (node) => {
      if (!$isTableNode(node)) return null;
      const rows = node
        .getChildren()
        .filter($isTableRowNode)
        .map((row) =>
          row
            .getChildren()
            .filter($isTableCellNode)
            .map((cell) => $cellToMarkdown(cell, inline)),
        );
      if (!rows.length) return null;
      const width = Math.max(1, ...rows.map((cells) => cells.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
      return [
        line(rows[0]),
        line(Array(width).fill("---")),
        ...rows.slice(1).map(line),
      ].join("\n");
    },
    regExpStart: TABLE_ROW,
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
      // A header row, then a delimiter row with as many cells.
      const header = splitTableRow(lines[startLineIndex]);
      const divider = lines[startLineIndex + 1]?.trim() ?? "";
      if (
        !isTableRowDivider(divider) ||
        splitTableRow(divider).length !== header.length
      ) {
        return null;
      }

      const table = $createTableNode();
      const appendRow = (cells: string[], isHeader: boolean) => {
        const row = $createTableRowNode();
        // As in GFM: short rows are padded, extra cells dropped.
        for (let i = 0; i < header.length; i++) {
          row.append($createCell(cells[i] ?? "", isHeader, inline));
        }
        table.append(row);
      };
      appendRow(header, true);

      let last = startLineIndex + 1;
      while (last + 1 < lines.length && TABLE_ROW.test(lines[last + 1])) {
        last++;
        appendRow(splitTableRow(lines[last]), false);
      }
      rootNode.append(table);
      return [true, last];
    },
    // Only ever imported; typing pipes doesn't build a table.
    replace: () => false,
    type: "multiline-element",
  };
}
