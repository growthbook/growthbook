import { memo, useMemo, useState } from "react";
import ReactDiffViewer, {
  DiffMethod,
  ReactDiffViewerProps,
} from "react-diff-viewer-continued";
import Button from "@/ui/Button";

// Each changed line is a table row, and a section that adds or replaces a
// large value changes every line, so past this many a diff waits to be asked
// for. Unchanged lines fold, so long but mostly equal sections still render.
const COLLAPSE_AFTER_CHANGED_LINES = 400;

// Lines present on only one side; cheap, and close to the rows a line diff draws
function countChangedLines(a: string, b: string): number {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const inA = new Set(aLines);
  const inB = new Set(bLines);
  return (
    aLines.filter((line) => !inB.has(line)).length +
    bLines.filter((line) => !inA.has(line)).length
  );
}

// ReactDiffViewer re-diffs on every render; memo skips renders whose props are
// unchanged, so callers should pass stable styles and callbacks.
const LazyDiffViewer = memo(function LazyDiffViewer({
  oldValue,
  newValue,
  compareMethod = DiffMethod.LINES,
  ...props
}: ReactDiffViewerProps & { oldValue: string; newValue: string }) {
  const changedLines = useMemo(
    () => countChangedLines(oldValue, newValue),
    [oldValue, newValue],
  );
  const [show, setShow] = useState(
    changedLines <= COLLAPSE_AFTER_CHANGED_LINES,
  );

  if (!show) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setShow(true)}>
        Show diff ({changedLines.toLocaleString()} changed lines)
      </Button>
    );
  }
  return (
    <ReactDiffViewer
      oldValue={oldValue}
      newValue={newValue}
      compareMethod={compareMethod}
      {...props}
    />
  );
});

export default LazyDiffViewer;
