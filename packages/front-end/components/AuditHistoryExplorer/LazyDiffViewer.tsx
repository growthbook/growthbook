import {
  memo,
  ReactNode,
  RefObject,
  useContext,
  useMemo,
  useState,
} from "react";
import { diffLines } from "diff";
import ReactDiffViewer, {
  DiffMethod,
  ReactDiffViewerProps,
} from "react-diff-viewer-continued";
import {
  isLongCode,
  RenderInFullContext,
} from "@/components/SyntaxHighlighting/VirtualizedCode";
import VirtualizedDiff, {
  DiffLineRef,
} from "@/components/AuditHistoryExplorer/VirtualizedDiff";
import Button from "@/ui/Button";

// Each changed line is a table row, and a section that adds, replaces or
// reorders a large value changes most lines, so past this many a diff waits
// to be asked for. Unchanged lines fold, so long but mostly equal sections
// still render.
const COLLAPSE_AFTER_CHANGED_LINES = 400;

// Added plus removed lines, or null once the diff passes the limit or takes
// too long; the search stops early, so huge or reordered values stay cheap
function countChangedLines(a: string, b: string): number | null {
  const changes = diffLines(a, b, {
    maxEditLength: COLLAPSE_AFTER_CHANGED_LINES,
    timeout: 100,
  });
  if (!changes) return null;
  return changes.reduce(
    (count, change) =>
      change.added || change.removed ? count + change.count : count,
    0,
  );
}

// ReactDiffViewer re-diffs on every render; memo skips renders whose props are
// unchanged, so callers should pass stable styles and callbacks.
const LazyDiffViewer = memo(function LazyDiffViewer({
  oldValue,
  newValue,
  compareMethod = DiffMethod.LINES,
  alwaysShow = false,
  scrollRef,
  renderLineCell,
  revealLine,
  onLineClick,
  ...props
}: ReactDiffViewerProps & {
  oldValue: string;
  newValue: string;
  // Skips the size gate, e.g. for a section whose lines carry comments
  alwaysShow?: boolean;
  // The bounded box the diff scrolls in. When given, long values render only
  // the rows in view instead of every row of the diff.
  scrollRef?: RefObject<HTMLElement | null>;
  // Long values only: the per-line cell (ReactDiffViewer's renderGutter is a
  // table cell), and a line to bring into view
  renderLineCell?: (side: "L" | "R", line: number) => ReactNode;
  revealLine?: DiffLineRef | null;
  // A line number clicked, as "L-12" / "R-12"
  onLineClick?: (lineId: string) => void;
}) {
  const renderInFull = useContext(RenderInFullContext);
  const changedLines = useMemo(
    () => countChangedLines(oldValue, newValue),
    [oldValue, newValue],
  );
  // Expanding applies to the values it was clicked for
  const [expanded, setExpanded] = useState<[string, string] | null>(null);
  const show =
    alwaysShow ||
    renderInFull ||
    (changedLines !== null && changedLines <= COLLAPSE_AFTER_CHANGED_LINES) ||
    (expanded?.[0] === oldValue && expanded?.[1] === newValue);

  if (!show) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded([oldValue, newValue])}
      >
        Show diff (
        {changedLines === null
          ? `over ${COLLAPSE_AFTER_CHANGED_LINES} changed lines`
          : `${changedLines.toLocaleString()} changed lines`}
        )
      </Button>
    );
  }
  if (scrollRef && (isLongCode(oldValue) || isLongCode(newValue))) {
    return (
      <VirtualizedDiff
        oldValue={oldValue}
        newValue={newValue}
        scrollRef={scrollRef}
        leftTitle={props.leftTitle}
        rightTitle={props.rightTitle}
        onLineNumberClick={onLineClick}
        renderLineCell={renderLineCell}
        revealLine={revealLine}
      />
    );
  }
  return (
    <ReactDiffViewer
      oldValue={oldValue}
      newValue={newValue}
      compareMethod={compareMethod}
      onLineNumberClick={onLineClick && ((lineId) => onLineClick(lineId))}
      {...props}
    />
  );
});

export default LazyDiffViewer;
