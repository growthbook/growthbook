import React, { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight, PiDotOutline } from "react-icons/pi";
import { LineageNode } from "@/components/Configs/fieldSchema";

const ROW_HEIGHT = 30;
const GUIDE_COLOR = "var(--slate-a6)";
// Indent the first two levels under a root; deeper nodes stop indenting.
const MAX_INDENT_DEPTH = 2;

export default function LineageTree({
  nodes,
  currentKey,
}: {
  nodes: LineageNode[];
  currentKey: string;
}): React.ReactElement {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const childrenOf = (parentKey: string | null) =>
    nodes.filter((n) => n.parentKey === parentKey);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderNodes = (
    parentKey: string | null,
    depth: number,
  ): React.ReactNode =>
    childrenOf(parentKey).map((n) => {
      const hasChildren = childrenOf(n.key).length > 0;
      const expanded = !collapsed.has(n.key);
      const isCurrent = n.key === currentKey;
      // Cap indentation at MAX_INDENT_DEPTH so deep chains don't run out of room
      // in the narrow sidebar; deeper nodes align under the last indented level
      // (guide stub + caret still convey structure).
      const showStub = depth >= 1 && depth <= MAX_INDENT_DEPTH;
      const indentChildren = depth < MAX_INDENT_DEPTH;
      return (
        <Box key={n.key} style={{ position: "relative" }}>
          {showStub && (
            <Box
              style={{
                position: "absolute",
                left: -5,
                top: ROW_HEIGHT / 2,
                width: 5,
                height: 1,
                background: GUIDE_COLOR,
              }}
            />
          )}
          <Flex
            align="center"
            gap="1"
            pl="1"
            pr="3"
            className="lineage-tree-row"
            onClick={() => router.push(`/configs/${n.key}`)}
            style={{
              height: ROW_HEIGHT,
              borderRadius: "var(--radius-2)",
              cursor: "pointer",
              // Inline background only for the current node so the CSS :hover
              // rule (lower specificity) applies to the other rows.
              background: isCurrent ? "var(--violet-a3)" : undefined,
            }}
          >
            <Flex
              align="center"
              justify="center"
              onClick={(e) => {
                if (hasChildren) {
                  e.stopPropagation();
                  toggle(n.key);
                }
              }}
              style={{ width: 14, flexShrink: 0, color: "var(--slate-11)" }}
            >
              {hasChildren ? (
                expanded ? (
                  <PiCaretDown size={10} />
                ) : (
                  <PiCaretRight size={10} />
                )
              ) : (
                <PiDotOutline size={20} />
              )}
            </Flex>
            <span
              title={n.name}
              style={{
                flex: 1,
                minWidth: 0,
                marginLeft: 4,
                fontSize: "var(--font-size-1)",
                fontWeight: isCurrent ? 500 : 400,
                color: isCurrent ? "var(--violet-11)" : undefined,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {n.name}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: "var(--font-size-1)",
                color: "var(--slate-10)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {n.fieldCount}
            </span>
          </Flex>
          {hasChildren &&
            expanded &&
            (indentChildren ? (
              <Box
                style={{
                  marginLeft: 6,
                  paddingLeft: 5,
                  borderLeft: `1px solid ${GUIDE_COLOR}`,
                }}
              >
                {renderNodes(n.key, depth + 1)}
              </Box>
            ) : (
              renderNodes(n.key, depth + 1)
            ))}
        </Box>
      );
    });

  return (
    <Box>
      <style>{`
        .lineage-tree-row:hover {
          background: var(--slate-a3);
        }
      `}</style>
      {renderNodes(null, 0)}
    </Box>
  );
}
