import {
  CSSProperties,
  memo,
  ReactNode,
  RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { diffLines, diffWordsWithSpace } from "diff";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  RenderInFullContext,
  useRenderAfterParentRefs,
} from "@/components/SyntaxHighlighting/VirtualizedCode";
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
// Copy as waits longer, then copies both values whole instead
const COPY_DIFF_TIMEOUT_MS = 2000;
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
 * and long unchanged runs folded. Null when the diff takes longer than
 * `timeoutMs`; a null limit never gives up.
 */
export function buildDiffRows(
  oldValue: string,
  newValue: string,
  timeoutMs: number | null = DIFF_TIMEOUT_MS,
): DiffRow[] | null {
  const parts =
    timeoutMs === null
      ? diffLines(oldValue, newValue)
      : diffLines(oldValue, newValue, { timeout: timeoutMs });
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

type Side = "L" | "R";

// The diff's own side labels, shared with ReactDiffViewer's line ids ("L-12")
export type DiffLineRef = { side: Side; line: number };

type RowProps = {
  numberWidth: string;
  onExpand: (id: number) => void;
  onLineNumberClick?: (lineId: string) => void;
  // A per-line cell after each line number, e.g. diff comments
  renderLineCell?: (side: Side, line: number) => ReactNode;
};

const cellStyle: CSSProperties = {
  padding: "1px 4px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  color: "var(--text-color-main)",
};

function LineCells({
  line,
  other,
  side,
  changed,
  onLineNumberClick,
  renderLineCell,
}: {
  line: Line | null;
  other: Line | null;
  side: Side;
  changed: boolean;
} & Pick<RowProps, "onLineNumberClick" | "renderLineCell">) {
  const kind = side === "L" ? "removed" : "added";
  // Word highlights only for rows on screen, and only where both sides exist
  const words = useMemo(
    () =>
      changed && line && other
        ? side === "L"
          ? diffWordsWithSpace(line.text, other.text).filter((w) => !w.added)
          : diffWordsWithSpace(other.text, line.text).filter((w) => !w.removed)
        : null,
    [changed, line, other, side],
  );
  const background =
    line && changed
      ? `var(--diff-${kind}-background)`
      : "var(--surface-background-color)";
  const highlight = `var(--diff-${kind}-background-highlight)`;
  const gutterBackground = line && changed ? highlight : background;
  return (
    <>
      <div
        // "-gutter" lets the diff comment styles find the line-number cell
        className="vdiff-gutter"
        style={{
          ...cellStyle,
          textAlign: "right",
          opacity: 0.7,
          background: gutterBackground,
        }}
        onClick={
          line && onLineNumberClick
            ? () => onLineNumberClick(`${side}-${line.number}`)
            : undefined
        }
      >
        {line?.number}
      </div>
      {renderLineCell && (
        <div
          className="gb-diff-comment-cell"
          style={{ position: "relative", background: gutterBackground }}
        >
          {line ? renderLineCell(side, line.number) : null}
        </div>
      )}
      <div style={{ ...cellStyle, background }}>
        {line && changed ? (side === "L" ? "- " : "+ ") : "  "}
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

function Row({ row, ...props }: RowProps & { row: DiffRow }) {
  if (row.type === "fold") {
    return (
      <div
        style={{
          ...cellStyle,
          background: "var(--surface-background-color)",
          textAlign: "center",
        }}
      >
        <Link onClick={() => props.onExpand(row.id)}>
          Expand {row.rows.length.toLocaleString()} unchanged lines
        </Link>
      </div>
    );
  }
  const changed = row.type === "changed";
  return (
    <div data-diff-row="" style={gridStyle(props)}>
      <LineCells
        line={row.left}
        other={row.right}
        side="L"
        changed={changed}
        onLineNumberClick={props.onLineNumberClick}
        renderLineCell={props.renderLineCell}
      />
      <LineCells
        line={row.right}
        other={row.left}
        side="R"
        changed={changed}
        onLineNumberClick={props.onLineNumberClick}
        renderLineCell={props.renderLineCell}
      />
    </div>
  );
}

const gridStyle = ({
  numberWidth,
  renderLineCell,
}: Pick<RowProps, "numberWidth" | "renderLineCell">): CSSProperties => {
  const side = `${numberWidth}${renderLineCell ? " 20px" : ""} minmax(0, 1fr)`;
  return {
    display: "grid",
    gridTemplateColumns: `${side} ${side}`,
    fontFamily: "var(--code-font-family, monospace)",
    fontSize: "11px",
    lineHeight: 1.6,
  };
};

const rowLine = (row: DiffRow, ref: DiffLineRef) =>
  row.type !== "fold" &&
  (ref.side === "L" ? row.left : row.right)?.number === ref.line;

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
  leftTitle,
  rightTitle,
  onLineNumberClick,
  renderLineCell,
  revealLine,
}: {
  oldValue: string;
  newValue: string;
  scrollRef: RefObject<HTMLElement | null>;
  leftTitle?: ReactNode;
  rightTitle?: ReactNode;
  onLineNumberClick?: (lineId: string) => void;
  renderLineCell?: (side: Side, line: number) => ReactNode;
  // Scrolls this line into view (expanding its fold) when it changes
  revealLine?: DiffLineRef | null;
}) {
  const renderInFull = useContext(RenderInFullContext);
  useRenderAfterParentRefs();
  // Past the time limit, comparing anyway is the viewer's call
  const [unlimitedFor, setUnlimitedFor] = useState<[string, string] | null>(
    null,
  );
  const unlimited =
    unlimitedFor?.[0] === oldValue && unlimitedFor?.[1] === newValue;
  const built = useMemo(
    () => ({
      rows: buildDiffRows(
        oldValue,
        newValue,
        unlimited
          ? null
          : renderInFull
            ? COPY_DIFF_TIMEOUT_MS
            : DIFF_TIMEOUT_MS,
      ),
    }),
    [oldValue, newValue, unlimited, renderInFull],
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

  // Bring a referenced line into view so it can be found and scrolled to,
  // once per request
  const revealed = useRef<DiffLineRef | null>(null);
  useEffect(() => {
    if (!revealLine || renderInFull || revealed.current === revealLine) return;
    const index = rows.findIndex((row) => rowLine(row, revealLine));
    if (index >= 0) {
      revealed.current = revealLine;
      virtualizer.scrollToIndex(index, { align: "center" });
      return;
    }
    const fold = rows.find(
      (row) =>
        row.type === "fold" && row.rows.some((r) => rowLine(r, revealLine)),
    );
    if (fold?.type === "fold") {
      setExpanded({ built, ids: new Set([...expandedIds, fold.id]) });
    }
  }, [revealLine, rows, renderInFull, virtualizer, built, expandedIds]);

  if (!built.rows && renderInFull) {
    return (
      <div>
        <div>Before:</div>
        <pre>{oldValue}</pre>
        <div>After:</div>
        <pre>{newValue}</pre>
      </div>
    );
  }
  if (!built.rows) {
    return (
      <div>
        <em>This change is too large to compare quickly.</em>{" "}
        <Link onClick={() => setUnlimitedFor([oldValue, newValue])}>
          Compare anyway (may take a while)
        </Link>
      </div>
    );
  }

  const lastNumber = Math.max(
    splitLines(oldValue).length,
    splitLines(newValue).length,
  );
  const rowProps: RowProps = {
    numberWidth: `calc(${String(lastNumber).length}ch + 8px)`,
    onExpand,
    onLineNumberClick,
    renderLineCell,
  };
  const titles =
    leftTitle || rightTitle ? (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          fontSize: "11px",
          fontWeight: 600,
        }}
      >
        <div style={cellStyle}>{leftTitle}</div>
        <div style={cellStyle}>{rightTitle}</div>
      </div>
    ) : null;

  if (renderInFull) {
    return (
      <div>
        {titles}
        {rows.map((row, i) => (
          <Row key={i} row={row} {...rowProps} />
        ))}
      </div>
    );
  }

  // Rows stay in normal flow between spacers, as in VirtualizedCode
  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  return (
    <div>
      {titles}
      <div style={{ paddingTop, paddingBottom }}>
        {items.map((item) => (
          <div
            key={item.index}
            data-index={item.index}
            ref={virtualizer.measureElement}
          >
            <Row row={rows[item.index]} {...rowProps} />
          </div>
        ))}
      </div>
    </div>
  );
});

export default VirtualizedDiff;
