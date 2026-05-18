import React, { useEffect, useState } from "react";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";

export type SymbolicatedStackLine = {
  number: number;
  content: string;
  highlight?: boolean;
};

export type SymbolicatedStackFrame = {
  function?: string;
  minified?: {
    filename?: string;
    line?: number;
    column?: number;
  };
  original?: {
    filename?: string;
    line?: number;
    column?: number;
  };
  resolved: boolean;
  context?: {
    line: number;
    content: string;
    lines: SymbolicatedStackLine[];
  };
};

export type SymbolicatedStack = {
  frames: SymbolicatedStackFrame[];
  text: string;
  resolvedFrameCount: number;
};

type Props = {
  rawStack: string;
  symbolicatedStack?: SymbolicatedStack | null;
};

function getStackMessage(text: string): string | undefined {
  const firstLine = text.split("\n")[0]?.trim();
  if (
    firstLine &&
    !firstLine.startsWith("at ") &&
    !firstLine.startsWith("    at ")
  ) {
    return firstLine;
  }

  return undefined;
}

function formatFrameLine(frame: SymbolicatedStackFrame): string {
  const fn = frame.function || "<anonymous>";
  if (frame.original?.filename) {
    return `    at ${fn} (${frame.original.filename}:${frame.original.line ?? "?"}:${frame.original.column ?? "?"})`;
  }
  if (frame.minified?.filename) {
    return `    at ${fn} (${frame.minified.filename}:${frame.minified.line ?? "?"}:${frame.minified.column ?? "?"})`;
  }
  return `    at ${fn}`;
}

function SourceContextSnippet({
  frame,
}: {
  frame: SymbolicatedStackFrame;
}): React.ReactElement {
  return (
    <div className="mt-1 mb-2 border-left pl-2">
      <div className="small text-muted mb-1">
        {frame.original?.filename}
        {frame.original?.line ? `:${frame.original.line}` : ""}
      </div>
      <div className="bg-white border rounded p-2 small">
        {frame.context?.lines.map((line) => (
          <div
            key={line.number}
            style={{
              background: line.highlight
                ? "rgba(255, 193, 7, 0.25)"
                : undefined,
            }}
          >
            <span
              className="text-muted"
              style={{ display: "inline-block", width: 36 }}
            >
              {line.number}
            </span>
            {line.content || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SymbolicatedStackTrace({
  rawStack,
  symbolicatedStack,
}: Props): React.ReactElement {
  const [expandedFrameIndex, setExpandedFrameIndex] = useState<number | null>(
    null,
  );
  const hasResolvedStack = Boolean(symbolicatedStack?.resolvedFrameCount);
  const displayText =
    hasResolvedStack && symbolicatedStack?.text
      ? symbolicatedStack.text
      : rawStack;
  const stackMessage = hasResolvedStack
    ? getStackMessage(symbolicatedStack?.text || "")
    : undefined;
  const frames = symbolicatedStack?.frames || [];

  useEffect(() => {
    setExpandedFrameIndex(null);
  }, [symbolicatedStack]);

  return (
    <div>
      {hasResolvedStack ? (
        <div className="small text-muted mb-2">
          Resolved {symbolicatedStack?.resolvedFrameCount} of{" "}
          {symbolicatedStack?.frames.length} stack frame
          {symbolicatedStack?.frames.length === 1 ? "" : "s"} from uploaded
          source maps.
        </div>
      ) : (
        <div className="small text-muted mb-2">
          Showing the captured stack. Upload source maps for this release to
          resolve original file paths and source lines.
        </div>
      )}
      <pre
        className="bg-light p-2 small mb-0"
        style={{ maxHeight: 280, overflow: "auto" }}
      >
        {hasResolvedStack ? (
          <>
            {stackMessage ? <div>{stackMessage}</div> : null}
            {frames.map((frame, index) => {
              const expandable = Boolean(frame.context?.lines.length);
              const expanded = expandedFrameIndex === index;

              return (
                <div
                  key={`${frame.original?.filename || frame.minified?.filename}-${index}`}
                >
                  <div
                    role={expandable ? "button" : undefined}
                    tabIndex={expandable ? 0 : undefined}
                    onClick={() => {
                      if (!expandable) return;
                      setExpandedFrameIndex(expanded ? null : index);
                    }}
                    onKeyDown={(event) => {
                      if (!expandable) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedFrameIndex(expanded ? null : index);
                      }
                    }}
                    style={{
                      cursor: expandable ? "pointer" : undefined,
                      background: expanded ? "rgba(0, 0, 0, 0.04)" : undefined,
                    }}
                    title={
                      expandable
                        ? expanded
                          ? "Hide source context"
                          : "Show source context"
                        : undefined
                    }
                  >
                    {expandable ? (
                      <span
                        className="text-muted"
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 12,
                          marginRight: 4,
                          verticalAlign: "middle",
                        }}
                      >
                        {expanded ? <FaAngleDown /> : <FaAngleRight />}
                      </span>
                    ) : null}
                    {formatFrameLine(frame)}
                  </div>
                  {expanded && expandable ? (
                    <SourceContextSnippet frame={frame} />
                  ) : null}
                </div>
              );
            })}
          </>
        ) : (
          displayText
        )}
      </pre>
    </div>
  );
}
