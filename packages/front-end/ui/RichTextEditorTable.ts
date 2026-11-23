import { CodeNode } from "@lexical/code";
import { $isListNode, ListNode } from "@lexical/list";
import {
  $convertToMarkdownString,
  $generateNodesFromMarkdownString,
  type ElementTransformer,
  type MultilineElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableSelectionFrom,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $findTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
  $moveTableColumn,
  $moveTableRow,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type ElementFormatType,
  type ElementNode,
  type LexicalEditor,
  type PointType,
} from "lexical";

// The parser the read-only view renders with, so both read a table alike.
const gfm = unified().use(remarkParse).use(remarkGfm);

type GfmRoot = ReturnType<typeof gfm.parse>;
type GfmTable = Extract<GfmRoot["children"][number], { type: "table" }>;
type GfmCell = GfmTable["children"][number]["children"][number];

// A table row has a pipe that isn't escaped: the lines worth parsing.
const MAYBE_ROW = /(?<!\\)\|/;

// The table `markdown` opens with, if it opens with one.
function leadingTable(markdown: string): GfmTable | null {
  const first = gfm.parse(markdown).children[0];
  return first?.type === "table" && first.position?.start.line === 1
    ? first
    : null;
}

function containsTable(nodes: ReadonlyArray<{ type: string }>): boolean {
  return nodes.some(
    (node) =>
      node.type === "table" ||
      ("children" in node &&
        Array.isArray(node.children) &&
        containsTable(node.children)),
  );
}

export function hasMarkdownTable(markdown: string): boolean {
  return (
    MAYBE_ROW.test(markdown) && containsTable(gfm.parse(markdown).children)
  );
}

// A cell's markdown as written, escapes and all.
function cellSource(markdown: string, cell: GfmCell): string {
  const first = cell.children[0]?.position?.start.offset;
  const last = cell.children[cell.children.length - 1]?.position?.end.offset;
  return first === undefined || last === undefined
    ? ""
    : markdown.slice(first, last);
}

export type ColumnAlign = "" | "left" | "center" | "right";

function dividerFromAlign(align: ElementFormatType): string {
  if (align === "center") return ":---:";
  if (align === "right") return "---:";
  return align === "left" ? ":---" : "---";
}

function $createCell(
  markdown: string,
  header: boolean,
  align: ColumnAlign,
  inline: Transformer[],
) {
  const cell = $createTableCellNode(
    header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS,
  ).setFormat(align);
  const nodes = $generateNodesFromMarkdownString(
    markdown.replace(/\\\|/g, "|"),
    inline,
  );
  cell.append(...(nodes.length ? nodes : [$createParagraphNode()]));
  return cell;
}

// One line of markdown per cell, since a table row can't span lines. Lexical
// escapes backslashes but never pipes, so every pipe here is a literal one.
function $cellToMarkdown(cell: TableCellNode, inline: Transformer[]): string {
  return $convertToMarkdownString(inline, cell)
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
}

/**
 * GitHub-flavored markdown tables. Cells hold inline markdown only (`inline`
 * are the transformers for it), as in GFM. The first row is always written
 * as the header, which GFM requires, and sets each column's alignment.
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
        .map((row) => row.getChildren().filter($isTableCellNode));
      if (!rows.length) return null;
      const width = Math.max(1, ...rows.map((cells) => cells.length));
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
      const [header, ...body] = rows.map((cells) =>
        cells.map((cell) => $cellToMarkdown(cell, inline)),
      );
      const divider = Array.from({ length: width }, (_, i) =>
        dividerFromAlign(rows[0][i]?.getFormatType() ?? ""),
      );
      return [line(header), line(divider), ...body.map(line)].join("\n");
    },
    regExpStart: MAYBE_ROW,
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
      // A table ends at a blank line, if not sooner.
      let end = startLineIndex;
      while (end < lines.length && lines[end].trim()) end++;
      const markdown = lines.slice(startLineIndex, end).join("\n");
      const parsed = leadingTable(markdown);
      if (!parsed) return null;

      const width = parsed.children[0]?.children.length ?? 0;
      const table = $createTableNode();
      parsed.children.forEach((row, r) => {
        const rowNode = $createTableRowNode();
        // As in GFM: short rows are padded, extra cells dropped.
        for (let i = 0; i < width; i++) {
          const cell = row.children[i];
          rowNode.append(
            $createCell(
              cell ? cellSource(markdown, cell) : "",
              r === 0,
              parsed.align?.[i] ?? "",
              inline,
            ),
          );
        }
        table.append(rowNode);
      });
      rootNode.append(table);
      return [true, startLineIndex + (parsed.position?.end.line ?? 1) - 1];
    },
    // Only ever imported; typing pipes doesn't build a table.
    replace: () => false,
    type: "multiline-element",
  };
}

// Typed block shortcuts (`# `, `- `, `> `, ```) stay text inside a cell.
export function outsideTableCells(transformers: Transformer[]): Transformer[] {
  return transformers.map((t) => {
    if (t.type === "element") {
      const replace: ElementTransformer["replace"] = (parent, ...rest) =>
        $isTableCellNode(parent.getParent())
          ? false
          : t.replace(parent, ...rest);
      return { ...t, replace };
    }
    if (t.type === "multiline-element") {
      const replace: MultilineElementTransformer["replace"] = (
        parent,
        ...rest
      ) =>
        $isTableCellNode(parent.getParent())
          ? false
          : t.replace(parent, ...rest);
      return { ...t, replace };
    }
    return t;
  });
}

function $columnCells(cell: TableCellNode): TableCellNode[] {
  const column = cell.getIndexWithinParent();
  return ($findTableNode(cell)?.getChildren() ?? [])
    .map((row) => ($isTableRowNode(row) ? row.getChildAtIndex(column) : null))
    .filter($isTableCellNode);
}

function $rowCells(cell: TableCellNode): TableCellNode[] {
  return cell.getParent()?.getChildren().filter($isTableCellNode) ?? [];
}

// Empty, keeping the cell and its alignment.
function $clearCell(cell: TableCellNode) {
  cell.clear().append($createParagraphNode());
}

export function $alignColumn(cell: TableCellNode, align: ColumnAlign) {
  $columnCells(cell).forEach((other) => other.setFormat(align));
}

export function $clearRow(cell: TableCellNode) {
  $rowCells(cell).forEach($clearCell);
}

export function $clearColumn(cell: TableCellNode) {
  $columnCells(cell).forEach($clearCell);
}

/** Moves `cell`'s row up (-1) or down (1); past an edge, it stays. */
export function $moveRow(cell: TableCellNode, by: -1 | 1) {
  const table = $findTableNode(cell);
  const from = cell.getParent()?.getIndexWithinParent();
  if (table && from !== undefined) $moveTableRow(table, from, from + by);
}

/** Moves `cell`'s column left (-1) or right (1); past an edge, it stays. */
export function $moveColumn(cell: TableCellNode, by: -1 | 1) {
  const table = $findTableNode(cell);
  const from = cell.getIndexWithinParent();
  if (table) $moveTableColumn(table, from, from + by);
}

// The first row is the header and sets each column's alignment, as it saves.
// A new header row, still unaligned, takes the alignment from the row below.
function $matchHeaderRow(row: TableRowNode) {
  const isHeader = row.getIndexWithinParent() === 0;
  const state = isHeader
    ? TableCellHeaderStates.ROW
    : TableCellHeaderStates.NO_STATUS;
  const source = isHeader
    ? row.getNextSibling()
    : row.getParent()?.getFirstChild();
  row.getChildren().forEach((cell, i) => {
    if (!$isTableCellNode(cell)) return;
    if (cell.getHeaderStyles() !== state) cell.setHeaderStyles(state);
    const other = $isTableRowNode(source) ? source.getChildAtIndex(i) : null;
    if (!$isTableCellNode(other)) return;
    const align = other.getFormatType();
    const current = cell.getFormatType();
    if ((!isHeader || current === "") && current !== align) {
      cell.setFormat(align);
    }
  });
}

// A block that lands in a cell (pasted, say) becomes the paragraphs it saves
// as, since a cell holds inline markdown only.
function $inlineInCell(node: ElementNode) {
  if (!$isTableCellNode(node.getParent())) return;
  const blocks = $isListNode(node)
    ? node.getChildren().filter($isElementNode)
    : [node];
  for (const block of blocks) {
    const paragraph = $createParagraphNode();
    node.insertBefore(paragraph);
    for (const child of block.getChildren()) {
      if ($isElementNode(child) && !child.isInline()) node.insertBefore(child);
      else paragraph.append(child);
    }
  }
  node.remove();
}

/** Keeps tables to what GFM can hold, so the editor shows what will save. */
export function registerTableRules(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerNodeTransform(TableNode, (table) => {
      // Widths from pasted HTML don't save, and would overflow a narrow field.
      if (table.getColWidths()) table.setColWidths(undefined);
      table.getChildren().filter($isTableRowNode).forEach($matchHeaderRow);
    }),
    editor.registerNodeTransform(TableRowNode, $matchHeaderRow),
    editor.registerNodeTransform(TableCellNode, (cell) => {
      if (cell.getWidth() !== undefined) cell.setWidth(undefined);
    }),
    ...[HeadingNode, QuoteNode, ListNode, CodeNode].map((klass) =>
      editor.registerNodeTransform(klass, $inlineInCell),
    ),
  );
}

// The cell before or after `cell`, reading across rows.
function $adjacentCell(
  cell: TableCellNode,
  backward: boolean,
): TableCellNode | null {
  const sibling = backward ? cell.getPreviousSibling() : cell.getNextSibling();
  if ($isTableCellNode(sibling)) return sibling;
  const row = cell.getParent();
  const nextRow = backward ? row?.getPreviousSibling() : row?.getNextSibling();
  if (!$isTableRowNode(nextRow)) return null;
  const edge = backward ? nextRow.getLastChild() : nextRow.getFirstChild();
  return $isTableCellNode(edge) ? edge : null;
}

function $atBlockEdge(point: PointType, block: ElementNode, start: boolean) {
  const node = point.getNode();
  if (point.type === "element") {
    return (
      node.is(block) && point.offset === (start ? 0 : block.getChildrenSize())
    );
  }
  const edge = start ? block.getFirstDescendant() : block.getLastDescendant();
  return (
    node.is(edge) && point.offset === (start ? 0 : node.getTextContentSize())
  );
}

// The table the caret is against, from the edge of a paragraph beside it or
// from between blocks (where Lexical leaves it at a table's edge).
function $tableBeside(
  point: PointType,
  backward: boolean,
): { table: TableNode; block: ElementNode | null } | null {
  const node = point.getNode();
  if ($isRootNode(node)) {
    const index = backward ? point.offset - 1 : point.offset;
    const table = index >= 0 ? node.getChildAtIndex(index) : null;
    return $isTableNode(table) ? { table, block: null } : null;
  }
  const block = node.getTopLevelElement();
  if (!$isParagraphNode(block) || !$atBlockEdge(point, block, backward)) {
    return null;
  }
  const table = backward ? block.getPreviousSibling() : block.getNextSibling();
  return $isTableNode(table) ? { table, block } : null;
}

function $onDeleteKey(event: KeyboardEvent | null, backward: boolean) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const node = selection.anchor.getNode();

  // In a cleared cell, the caret steps back (or on) to the next cell over.
  const cell = $findMatchingParent(node, $isTableCellNode);
  if (cell) {
    const only = cell.getFirstChild();
    const cleared =
      cell.getChildrenSize() === 1 && $isParagraphNode(only) && only.isEmpty();
    const next = cleared ? $adjacentCell(cell, backward) : null;
    if (!next) return false;
    event?.preventDefault();
    // A held key stops here; it takes a fresh press to step over.
    if (event?.repeat) return true;
    if (backward) next.selectEnd();
    else next.selectStart();
    return true;
  }

  // Into a table from beside it, the first press selects the whole table and
  // the next deletes it. An empty line pressed from goes first.
  const beside = $tableBeside(selection.anchor, backward);
  if (!beside) return false;
  const { table, block } = beside;
  const firstRow = table.getFirstChild();
  const lastRow = table.getLastChild();
  const first = $isTableRowNode(firstRow) ? firstRow.getFirstChild() : null;
  const last = $isTableRowNode(lastRow) ? lastRow.getLastChild() : null;
  if (!$isTableCellNode(first) || !$isTableCellNode(last)) return false;
  event?.preventDefault();
  if (event?.repeat) return true;
  if (block?.isEmpty()) block.remove();
  $setSelection($createTableSelectionFrom(table, first, last));
  return true;
}

// Whole rows or columns selected are deleted. Lexical empties anything less,
// and removes a whole table.
function $onDeleteCells(event: KeyboardEvent | null) {
  const selection = $getSelection();
  if (!$isTableSelection(selection)) return false;
  // A held key doesn't carry on into selected cells, or a selected table.
  if (event?.repeat) {
    event.preventDefault();
    return true;
  }
  const table = $findTableNode(selection.anchor.getNode());
  const header = table?.getFirstChild();
  if (!table || !$isTableRowNode(header)) return false;
  const { fromX, fromY, toX, toY } = selection.getShape();
  const allColumns = fromX === 0 && toX === header.getChildrenSize() - 1;
  const allRows = fromY === 0 && toY === table.getChildrenSize() - 1;
  if (allColumns === allRows) return false;
  event?.preventDefault();
  if (allColumns) $deleteTableRowAtSelection();
  else $deleteTableColumnAtSelection();
  return true;
}

/** Backspace and Delete at a table's edges, inside and out, and on cells. */
export function registerTableKeys(editor: LexicalEditor): () => void {
  return mergeRegister(
    ...[KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND].map((command) =>
      editor.registerCommand(
        command,
        $onDeleteCells,
        COMMAND_PRIORITY_CRITICAL,
      ),
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => $onDeleteKey(event, true),
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => $onDeleteKey(event, false),
      COMMAND_PRIORITY_HIGH,
    ),
  );
}
