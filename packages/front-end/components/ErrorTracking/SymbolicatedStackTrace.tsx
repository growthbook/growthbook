import React, { useEffect, useState } from "react";
import { Box } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Text from "@/ui/Text";

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
    <Box
      mt="1"
      mb="2"
      pl="2"
      style={{ borderLeft: "2px solid var(--gray-a5)" }}
    >
      <Text as="div" size="sm" color="text-low" mb="1">
        {frame.original?.filename}
        {frame.original?.line ? `:${frame.original.line}` : ""}
      </Text>
      <Box
        p="2"
        style={{
          background: "var(--color-panel-solid)",
          border: "1px solid var(--gray-a5)",
          borderRadius: "var(--radius-2)",
        }}
      >
        <Text as="div" size="sm">
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
                style={{
                  display: "inline-block",
                  width: 36,
                  color: "var(--color-text-low)",
                }}
              >
                {line.number}
              </span>
              {line.content || " "}
            </div>
          ))}
        </Text>
      </Box>
    </Box>
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
        <Text as="div" size="sm" color="text-low" mb="2">
          Resolved {symbolicatedStack?.resolvedFrameCount} of{" "}
          {symbolicatedStack?.frames.length} stack frame
          {symbolicatedStack?.frames.length === 1 ? "" : "s"} from uploaded
          source maps.
        </Text>
      ) : (
        <Text as="div" size="sm" color="text-low" mb="2">
          Showing the captured stack. Upload source maps for this release to
          resolve original file paths and source lines.
        </Text>
      )}
      <pre
        style={{
          background: "var(--gray-a2)",
          padding: "var(--space-2)",
          fontSize: "var(--font-size-1)",
          marginBottom: 0,
          maxHeight: 280,
          overflow: "auto",
        }}
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
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 12,
                          marginRight: 4,
                          verticalAlign: "middle",
                          color: "var(--color-text-low)",
                        }}
                      >
                        {expanded ? <PiCaretDown /> : <PiCaretRight />}
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
