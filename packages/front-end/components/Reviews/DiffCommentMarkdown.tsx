import React, { useMemo } from "react";
import { PiGitDiff, PiArrowBendUpRight } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Markdown from "@/components/Markdown/Markdown";
import {
  DiffCommentRef,
  DiffRefSnapshot,
  scrollToDiffRef,
  splitDiffRefSegments,
} from "@/components/Reviews/diffCommentRefs";

// Boxed rendering of a `diff-ref` block inside a comment: a mini before/after
// diff snapshot captured when the comment was written (removed lines red,
// added lines green, anchored line highlighted), plus a click-through that
// scrolls back to the referenced line in the live diff.
function DiffRefWidget({
  refObj,
  snapshot,
}: {
  refObj: DiffCommentRef;
  snapshot: DiffRefSnapshot;
}) {
  const sideLabel = refObj.side === "L" ? "before" : "after";
  return (
    <button
      type="button"
      className="gb-diff-ref-widget"
      title="View in diff"
      onClick={(e) => {
        e.preventDefault();
        scrollToDiffRef(refObj);
      }}
    >
      <Flex align="center" gap="2" className="gb-diff-ref-widget-header">
        <PiGitDiff />
        <Text size="small" weight="semibold">
          {refObj.sectionKey}
        </Text>
        <Text size="small" color="text-low">
          {sideLabel}, line {refObj.line}
        </Text>
        <Flex align="center" gap="1" ml="auto" className="gb-diff-ref-jump">
          <PiArrowBendUpRight />
          <Text size="small">View in diff</Text>
        </Flex>
      </Flex>
      {snapshot.lines.length > 0 && (
        <Box className="gb-diff-ref-widget-body">
          {snapshot.lines.map((line, i) => {
            const opClass =
              line.op === "-"
                ? " gb-diff-ref-del"
                : line.op === "+"
                  ? " gb-diff-ref-add"
                  : "";
            const anchorClass = line.anchored ? " gb-diff-ref-anchor" : "";
            return (
              <div
                key={i}
                className={`gb-diff-ref-line${opClass}${anchorClass}`}
              >
                <span className="gb-diff-ref-op">
                  {line.op === " " ? "\u00a0" : line.op}
                </span>
                {line.text || "\u00a0"}
              </div>
            );
          })}
        </Box>
      )}
    </button>
  );
}

// Drop-in replacement for <Markdown> on comment bodies that may contain
// `diff-ref` blocks: ordinary markdown renders as usual, ref blocks render
// as interactive DiffRefWidgets. Comments without refs pass straight
// through to <Markdown>.
export default function MarkdownWithDiffRefs({
  children,
  className,
  highlightCode = false,
}: {
  children: string;
  className?: string;
  highlightCode?: boolean;
}) {
  const segments = useMemo(() => splitDiffRefSegments(children), [children]);

  if (segments.length === 1 && segments[0].type === "markdown") {
    return (
      <Markdown className={className} highlightCode={highlightCode}>
        {children}
      </Markdown>
    );
  }

  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.type === "markdown" ? (
          seg.text.trim() ? (
            <Markdown key={i} highlightCode={highlightCode}>
              {seg.text}
            </Markdown>
          ) : null
        ) : (
          <DiffRefWidget key={i} refObj={seg.ref} snapshot={seg.snapshot} />
        ),
      )}
    </div>
  );
}
