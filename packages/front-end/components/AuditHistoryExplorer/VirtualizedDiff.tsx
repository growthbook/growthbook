import {
  CSSProperties,
  memo,
  RefObject,
  useContext,
  useMemo,
  useState,
} from "react";
import { diffLines, diffWordsWithSpace } from "diff";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RenderInFullContext } from "@/components/SyntaxHighlighting/VirtualizedCode";
import Link from "@/ui/Link";

type Line = { number: number; text: string };
export type DiffRow =
  | { type: "same"; left: Line; right: Line }
  | { type: "changed"; left: Line | null; right: Line | null }
  | { type: "fold"; id: number; rows: DiffRow[] };

// Unchanged lines kept around each change; longer unchanged runs fold
const CONTEXT_LINES = 3;
// Past this, building the diff gives up rather than freezing the page
const DIFF_TIMEOUT_MS = 500;
// 11px at line-height 1.6; wrapped lines are measured as they render
const ESTIMATED_ROW_HEIGHT = 18;

const splitLines = (value: string) => {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

function foldUnchanged(rows: DiffRow[]): DiffRow[] {
  const folded: DiffRow[] = [];
  let foldId = 0;
  for (let start = 0; start < rows.length; ) {
    if (rows[start].type !== "same") {
      folded.push(rows[start++]);
      continue;
    }
    let end = start;
    while (end < rows.length && rows[end].type === "same") end++;
    const keepBefore = start === 0 ? 0 : CONTEXT_LINES;
    const keepAfter = end === rows.length ? 0 : CONTEXT_LINES;
    if (end - start > keepBefore + keepAfter + 1) {
      folded.push(...rows.slice(start, start + keepBefore));
      folded.push({
        type: "fold",
        id: foldId++,
        rows: rows.slice(start + keepBefore, end - keepAfter),
      });
      folded.push(...rows.slice(end - keepAfter, end));
    } else {
      folded.push(...rows.slice(start, end));
    }
    start = end;
  }
  return folded;
}

/**
 * Side-by-side rows for a line diff, with removed and added lines paired up
 * and long unchanged runs folded. Null when the diff takes too long.
 */
export function buildDiffRows(
  oldValue: string,
  newValue: string,
): DiffRow[] | null {
  const parts = diffLines(oldValue, newValue, { timeout: DIFF_TIMEOUT_MS });
  if (!parts) return null;
  const rows: DiffRow[] = [];
  let left = 1;
  let right = 1;
  for (let i = 0; i < parts.length; i++) {
    const lines = splitLines(parts[i].value);
    if (!parts[i].added && !parts[i].removed) {
      lines.forEach((text) =>
        rows.push({
          type: "same",
          left: { number: left++, text },
          right: { number: right++, text },
        }),
      );
    } else if (parts[i].removed) {
      const added = parts[i + 1]?.added ? splitLines(parts[++i].value) : [];
      for (let k = 0; k < Math.max(lines.length, added.length); k++) {
        rows.push({
          type: "changed",
          left: k < lines.length ? { number: left++, text: lines[k] } : null,
          right: k < added.length ? { number: right++, text: added[k] } : null,
        });
      }
    } else {
      lines.forEach((text) =>
        rows.push({
          type: "changed",
          left: null,
          right: { number: right++, text },
        }),
      );
    }
  }
  return foldUnchanged(rows);
}

const rowStyle = (numberWidth: string): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `${numberWidth} minmax(0, 1fr) ${numberWidth} minmax(0, 1fr)`,
  fontFamily: "var(--code-font-family, monospace)",
  fontSize: "11px",
  lineHeight: 1.6,
});

const cellStyle: CSSProperties = {
  padding: "1px 4px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  color: "var(--text-color-main)",
};

function LineCells({
  line,
  side,
  changed,
  other,
}: {
  line: Line | null;
  side: "removed" | "added";
  changed: boolean;
  other: Line | null;
}) {
  // Word highlights only for rows on screen, and only where both sides exist
  const words = useMemo(
    () =>
      changed && line && other
        ? side === "removed"
          ? diffWordsWithSpace(line.text, other.text).filter((w) => !w.added)
          : diffWordsWithSpace(other.text, line.text).filter((w) => !w.removed)
        : null,
    [changed, line, other, side],
  );
  const background = !line
    ? "var(--surface-background-color)"
    : changed
      ? `var(--diff-${side}-background)`
      : "var(--surface-background-color)";
  const highlight = `var(--diff-${side}-background-highlight)`;
  return (
    <>
      <div
        style={{
          ...cellStyle,
          textAlign: "right",
          opacity: 0.7,
          background: line && changed ? highlight : background,
        }}
      >
        {line?.number}
      </div>
      <div style={{ ...cellStyle, background }}>
        {line && changed ? (side === "removed" ? "- " : "+ ") : "  "}
        {words
          ? words.map((w, i) =>
              w.added || w.removed ? (
                <span key={i} style={{ background: highlight }}>
                  {w.value}
                </span>
              ) : (
                w.value
              ),
            )
          : line?.text}
      </div>
    </>
  );
}

function Row({
  row,
  numberWidth,
  onExpand,
}: {
  row: DiffRow;
  numberWidth: string;
  onExpand: (id: number) => void;
}) {
  if (row.type === "fold") {
    return (
      <div
        style={{
          ...cellStyle,
          background: "var(--surface-background-color)",
          fontSize: "11px",
          textAlign: "center",
        }}
      >
        <Link onClick={() => onExpand(row.id)}>
          Expand {row.rows.length.toLocaleString()} unchanged lines
        </Link>
      </div>
    );
  }
  const changed = row.type === "changed";
  return (
    <div style={rowStyle(numberWidth)}>
      <LineCells
        line={row.left}
        other={row.right}
        side="removed"
        changed={changed}
      />
      <LineCells
        line={row.right}
        other={row.left}
        side="added"
        changed={changed}
      />
    </div>
  );
}

/**
 * A side-by-side diff that renders only the rows scrolled into view, for
 * values long enough that rendering every row of the diff makes the page lag.
 * `scrollRef` must be the element that scrolls (a bounded height with overflow
 * auto), as with VirtualizedCode.
 */
const VirtualizedDiff = memo(function VirtualizedDiff({
  oldValue,
  newValue,
  scrollRef,
}: {
  oldValue: string;
  newValue: string;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const renderInFull = useContext(RenderInFullContext);
  const built = useMemo(
    () => ({ rows: buildDiffRows(oldValue, newValue) }),
    [oldValue, newValue],
  );
  // Expanded folds belong to the diff they were expanded in
  const [expanded, setExpanded] = useState<{
    built: typeof built;
    ids: Set<number>;
  }>({ built, ids: new Set() });
  const expandedIds = useMemo(
    () => (expanded.built === built ? expanded.ids : new Set<number>()),
    [expanded, built],
  );
  const rows = useMemo(
    () =>
      (built.rows ?? []).flatMap((row) =>
        row.type === "fold" && expandedIds.has(row.id) ? row.rows : [row],
      ),
    [built, expandedIds],
  );
  const onExpand = (id: number) =>
    setExpanded({ built, ids: new Set([...expandedIds, id]) });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 20,
    enabled: !renderInFull,
  });

  if (!built.rows) {
    return <em>This change is too large to compare line by line.</em>;
  }

  const lastNumber = Math.max(
    splitLines(oldValue).length,
    splitLines(newValue).length,
  );
  const numberWidth = `calc(${String(lastNumber).length}ch + 8px)`;

  if (renderInFull) {
    return (
      <div>
        {rows.map((row, i) => (
          <Row
            key={i}
            row={row}
            numberWidth={numberWidth}
            onExpand={onExpand}
          />
        ))}
      </div>
    );
  }

  // Rows stay in normal flow between spacers, as in VirtualizedCode
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  return (
    <div style={{ paddingTop, paddingBottom }}>
      {items.map((item) => (
        <div
          key={item.index}
          data-index={item.index}
          ref={virtualizer.measureElement}
        >
          <Row
            row={rows[item.index]}
            numberWidth={numberWidth}
            onExpand={onExpand}
          />
        </div>
      ))}
    </div>
  );
});

export default VirtualizedDiff;
