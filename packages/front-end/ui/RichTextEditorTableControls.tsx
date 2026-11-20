import { ReactNode, useEffect, useRef, useState } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import clsx from "clsx";
import {
  PiArrowDown,
  PiArrowLeft,
  PiArrowRight,
  PiArrowUp,
  PiCaretDown,
  PiCaretLeft,
  PiCaretRight,
  PiCaretUp,
  PiEraser,
  PiPlusBold,
  PiTextAlignCenterBold,
  PiTextAlignLeftBold,
  PiTextAlignRightBold,
  PiTrash,
} from "react-icons/pi";
import type { IconType } from "react-icons";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $findTableNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableRowNode,
  type TableCellNode,
} from "@lexical/table";
import { $getNearestNodeFromDOMNode } from "lexical";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Tooltip from "@/ui/Tooltip";
import {
  $alignColumn,
  $clearColumn,
  $clearRow,
  $moveColumn,
  $moveRow,
} from "./RichTextEditorTable";
import styles from "./RichTextEditor.module.scss";

type Align = "left" | "center" | "right";

const ALIGNMENTS: {
  align: Align;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}[] = [
  { align: "left", label: "Align left", Icon: PiTextAlignLeftBold },
  { align: "center", label: "Align center", Icon: PiTextAlignCenterBold },
  { align: "right", label: "Align right", Icon: PiTextAlignRightBold },
];

// The toolbar's buttons, one per alignment. Holds its own choice while the
// menu is open, since the grips (and what they read) stay frozen until then.
function ColumnAlignControl({
  initial,
  onChange,
}: {
  initial: Align;
  onChange: (align: Align) => void;
}) {
  const [current, setCurrent] = useState(initial);
  return (
    <Flex gap="1" px="2" py="1" role="group" aria-label="Align column">
      {ALIGNMENTS.map(({ align, label, Icon }) => {
        const on = current === align;
        return (
          <IconButton
            key={align}
            type="button"
            size="1"
            variant={on ? "soft" : "ghost"}
            color={on ? undefined : "gray"}
            aria-label={label}
            aria-pressed={on}
            className={styles.toolbarButton}
            onClick={() => {
              setCurrent(align);
              onChange(align);
            }}
          >
            <Icon size={18} />
          </IconButton>
        );
      })}
    </Flex>
  );
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Grips {
  cell: HTMLTableCellElement;
  row: Rect;
  // Null while the column is scrolled out of view.
  column: Rect | null;
  // Only from the last row or column (or the gutter past it), and for a
  // column, only with room beside the table.
  addRow: Rect | null;
  addColumn: Rect | null;
}

// A control keeps its last place while it fades out.
type Placed = { at: Rect; on: boolean } | null;

interface Controls {
  cell: HTMLTableCellElement | null;
  row: Placed;
  column: Placed;
  addRow: Placed;
  addColumn: Placed;
}

const NO_CONTROLS: Controls = {
  cell: null,
  row: null,
  column: null,
  addRow: null,
  addColumn: null,
};

function place(prev: Placed, at: Rect | null): Placed {
  if (at) return { at, on: true };
  return prev && { at: prev.at, on: false };
}

// How far a grip reaches out from the table: the gutter it thickens across.
const GRIP_REACH = 12;

// The add-row and add-column lines past the table's bottom and right edges,
// and their gap to it.
const ADD_REACH = 14;
const ADD_GAP = 1;

// How far out from a table's edges the pointer still finds its rows and
// columns, so its controls show before the pointer crosses into it.
const GRIP_BUFFER = 16;

// The cell nearest the pointer when it's in the empty gutter around a table.
function cellBeside(
  root: HTMLElement,
  x: number,
  y: number,
): HTMLTableCellElement | null {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    const box = table.getBoundingClientRect();
    const view = (table.parentElement ?? table).getBoundingClientRect();
    const left = Math.max(box.left, view.left);
    const right = Math.min(box.right, view.right);
    if (
      x < left - GRIP_BUFFER ||
      x >= right + GRIP_BUFFER ||
      y < box.top - GRIP_BUFFER ||
      y >= box.bottom + GRIP_BUFFER
    ) {
      continue;
    }
    const clamp = (n: number, min: number, max: number) =>
      Math.min(Math.max(n, min), max);
    const cell = document
      .elementFromPoint(
        clamp(x, left + 1, right - 1),
        clamp(y, box.top + 1, box.bottom - 1),
      )
      ?.closest("td, th");
    return cell instanceof HTMLTableCellElement ? cell : null;
  }
  return null;
}

// Grips for a cell's row and column, outside its table's left and top edges.
function placeGrips(
  cell: HTMLTableCellElement,
  area: HTMLElement,
): Grips | null {
  const table = cell.closest("table");
  const row = cell.parentElement;
  if (!cell.isConnected || !table || !row) return null;
  const box = area.getBoundingClientRect();
  // The wrapper a wide table scrolls in.
  const view = (table.parentElement ?? table).getBoundingClientRect();
  const tableBox = table.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  const cellBox = cell.getBoundingClientRect();
  const columnLeft = Math.max(cellBox.left, view.left);
  const columnRight = Math.min(cellBox.right, view.right);
  const tableLeft = Math.max(tableBox.left, view.left);
  const tableRight = Math.min(tableBox.right, view.right);
  const lastRow = row === table.rows[table.rows.length - 1];
  const lastColumn = cell === row.lastElementChild;
  return {
    cell,
    addRow: lastRow
      ? {
          left: tableLeft - box.left,
          top: tableBox.bottom + ADD_GAP - box.top,
          width: tableRight - tableLeft,
          height: ADD_REACH,
        }
      : null,
    addColumn:
      lastColumn && tableBox.right + ADD_GAP + ADD_REACH <= view.right
        ? {
            left: tableBox.right + ADD_GAP - box.left,
            top: tableBox.top - box.top,
            width: ADD_REACH,
            height: tableBox.height,
          }
        : null,
    row: {
      left: tableLeft - GRIP_REACH - box.left,
      top: rowBox.top - box.top,
      width: GRIP_REACH,
      height: rowBox.height,
    },
    column:
      columnRight > columnLeft
        ? {
            left: columnLeft - box.left,
            top: tableBox.top - GRIP_REACH - box.top,
            width: columnRight - columnLeft,
            height: GRIP_REACH,
          }
        : null,
  };
}

function Grip({
  label,
  vertical,
  placed,
  onOpenChange,
  children,
}: {
  label: string;
  vertical: boolean;
  placed: NonNullable<Placed>;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const [editor] = useLexicalComposerContext();
  return (
    <DropdownMenu
      variant="soft"
      onOpenChange={onOpenChange}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        editor.focus();
      }}
      trigger={
        <button
          type="button"
          aria-label={label}
          data-table-grip
          className={clsx(
            styles.tableGrip,
            vertical ? styles.rowGrip : styles.columnGrip,
          )}
          style={placed.at}
          data-hidden={placed.on ? undefined : ""}
          aria-hidden={!placed.on}
          tabIndex={placed.on ? undefined : -1}
        />
      }
    >
      {children}
    </DropdownMenu>
  );
}

// An arrow toward where the new row or column goes, with a plus at its corner.
function InsertIcon({ Arrow }: { Arrow: IconType }) {
  return (
    <span className={styles.insertIcon} aria-hidden>
      <Arrow />
      <PiPlusBold className={styles.insertIconPlus} />
    </span>
  );
}

// A line past the table's last row or column, with a plus, that adds one.
function AddLine({
  label,
  vertical,
  placed,
  onAdd,
}: {
  label: string;
  vertical: boolean;
  placed: NonNullable<Placed>;
  onAdd: () => void;
}) {
  return (
    // Beside the line, off the table.
    <Tooltip content={label} side={vertical ? "right" : "bottom"}>
      <button
        type="button"
        aria-label={label}
        data-table-grip
        className={clsx(
          styles.tableAdd,
          vertical ? styles.tableAddColumn : styles.tableAddRow,
        )}
        style={placed.at}
        data-hidden={placed.on ? undefined : ""}
        aria-hidden={!placed.on}
        tabIndex={placed.on ? undefined : -1}
        // Keeps the caret in the text, to land in the new cells.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAdd}
      >
        <PiPlusBold size={8} />
      </button>
    </Tooltip>
  );
}

/** Grips on a hovered table's borders, for the row and column under the pointer. */
export default function RichTextEditorTableControls() {
  const [editor] = useLexicalComposerContext();
  const overlay = useRef<HTMLDivElement>(null);
  const hovered = useRef<HTMLTableCellElement | null>(null);
  const menuOpen = useRef(false);
  const [controls, setControls] = useState(NO_CONTROLS);

  useEffect(() => {
    const area = overlay.current;
    const parent = area?.parentElement;
    if (!area || !parent) return;
    // Held in place while a grip's menu is open.
    const measure = () => {
      if (menuOpen.current) return;
      const cell = hovered.current;
      const next = cell ? placeGrips(cell, area) : null;
      setControls((prev) =>
        !next && !prev.cell
          ? prev
          : {
              cell: next?.cell ?? null,
              row: place(prev.row, next?.row ?? null),
              column: place(prev.column, next?.column ?? null),
              addRow: place(prev.addRow, next?.addRow ?? null),
              addColumn: place(prev.addColumn, next?.addColumn ?? null),
            },
      );
    };
    const onMove = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("[data-table-grip]")) return;
      const root = editor.getRootElement();
      const cell = target?.closest("td, th");
      // Over a cell, or over empty space (padding, a table's own margin)
      // rather than another block's text.
      const next =
        cell instanceof HTMLTableCellElement && root?.contains(cell)
          ? cell
          : root &&
              (target === root ||
                target?.classList.contains(styles.tableWrapper))
            ? cellBeside(root, e.clientX, e.clientY)
            : null;
      if (next === hovered.current) return;
      hovered.current = next;
      measure();
    };
    const onLeave = () => {
      hovered.current = null;
      measure();
    };
    parent.addEventListener("mousemove", onMove);
    parent.addEventListener("mouseleave", onLeave);
    document.addEventListener("scroll", measure, true);
    const unregister = editor.registerUpdateListener(measure);
    return () => {
      parent.removeEventListener("mousemove", onMove);
      parent.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("scroll", measure, true);
      unregister();
    };
  }, [editor]);

  const run = (action: (cell: TableCellNode) => void) =>
    editor.update(() => {
      const cell = controls.cell && $getNearestNodeFromDOMNode(controls.cell);
      if (!$isTableCellNode(cell)) return;
      cell.selectStart();
      action(cell);
    });

  const hoveredCell = controls.cell;
  const columnAlign: Align = hoveredCell
    ? editor.read(() => {
        const cell = $getNearestNodeFromDOMNode(hoveredCell);
        const align = $isTableCellNode(cell) ? cell.getFormatType() : "";
        return align === "center" || align === "right" ? align : "left";
      })
    : "left";

  // A row under the last, or a column after the last, with the caret in its
  // first new cell.
  const addRow = () =>
    run((cell) => {
      const last = $findTableNode(cell)?.getLastChild();
      const first = $isTableRowNode(last) ? last.getFirstChild() : null;
      if (!$isTableCellNode(first)) return;
      first.selectStart();
      const added = $insertTableRowAtSelection(true)?.getFirstChild();
      if ($isTableCellNode(added)) added.selectStart();
    });

  const addColumn = () =>
    run((cell) => {
      const header = $findTableNode(cell)?.getFirstChild();
      const last = $isTableRowNode(header) ? header.getLastChild() : null;
      if (!$isTableCellNode(last)) return;
      last.selectStart();
      $insertTableColumnAtSelection(true);
      const added = last.getNextSibling();
      if ($isTableCellNode(added)) added.selectStart();
    });

  const onOpenChange = (open: boolean) => {
    menuOpen.current = open;
  };

  // Where the hovered cell sits, so a move past an edge is disabled.
  const rowEl = controls.cell?.parentElement;
  const tableEl = controls.cell?.closest("table");
  const at =
    controls.cell && rowEl instanceof HTMLTableRowElement && tableEl
      ? {
          firstRow: rowEl.rowIndex === 0,
          lastRow: rowEl.rowIndex === tableEl.rows.length - 1,
          firstColumn: controls.cell.cellIndex === 0,
          lastColumn: controls.cell.cellIndex === rowEl.cells.length - 1,
        }
      : null;

  return (
    <div ref={overlay} className={styles.tableControls}>
      {controls.addRow ? (
        <AddLine
          label="Add a row"
          vertical={false}
          placed={controls.addRow}
          onAdd={addRow}
        />
      ) : null}
      {controls.addColumn ? (
        <AddLine
          label="Add a column"
          vertical
          placed={controls.addColumn}
          onAdd={addColumn}
        />
      ) : null}
      {controls.row ? (
        <Grip
          label="Row options"
          vertical
          placed={controls.row}
          onOpenChange={onOpenChange}
        >
          <DropdownMenuItem
            onClick={() => run(() => $insertTableRowAtSelection(false))}
          >
            <InsertIcon Arrow={PiArrowUp} /> Insert row above
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run(() => $insertTableRowAtSelection(true))}
          >
            <InsertIcon Arrow={PiArrowDown} /> Insert row below
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={at?.firstRow ?? true}
            onClick={() => run((cell) => $moveRow(cell, -1))}
          >
            <PiCaretUp /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={at?.lastRow ?? true}
            onClick={() => run((cell) => $moveRow(cell, 1))}
          >
            <PiCaretDown /> Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              run((cell) => {
                $clearRow(cell);
                cell.selectStart();
              })
            }
          >
            <PiEraser /> Clear contents
          </DropdownMenuItem>
          <DropdownMenuItem
            color="red"
            onClick={() => run($deleteTableRowAtSelection)}
          >
            <PiTrash /> Delete row
          </DropdownMenuItem>
        </Grip>
      ) : null}
      {controls.column ? (
        <Grip
          label="Column options"
          vertical={false}
          placed={controls.column}
          onOpenChange={onOpenChange}
        >
          {/* Left is markdown's default, so it clears the column's alignment. */}
          <ColumnAlignControl
            initial={columnAlign}
            onChange={(align) =>
              run((cell) => $alignColumn(cell, align === "left" ? "" : align))
            }
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => run(() => $insertTableColumnAtSelection(false))}
          >
            <InsertIcon Arrow={PiArrowLeft} /> Insert column left
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run(() => $insertTableColumnAtSelection(true))}
          >
            <InsertIcon Arrow={PiArrowRight} /> Insert column right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={at?.firstColumn ?? true}
            onClick={() => run((cell) => $moveColumn(cell, -1))}
          >
            <PiCaretLeft /> Move left
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={at?.lastColumn ?? true}
            onClick={() => run((cell) => $moveColumn(cell, 1))}
          >
            <PiCaretRight /> Move right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              run((cell) => {
                $clearColumn(cell);
                cell.selectStart();
              })
            }
          >
            <PiEraser /> Clear contents
          </DropdownMenuItem>
          <DropdownMenuItem
            color="red"
            onClick={() => run($deleteTableColumnAtSelection)}
          >
            <PiTrash /> Delete column
          </DropdownMenuItem>
        </Grip>
      ) : null}
    </div>
  );
}
