import React, { useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiBracketsCurly,
  PiStackBold,
  PiDotOutline,
} from "react-icons/pi";
import { LineageNode } from "@/components/Configs/fieldSchema";

const ROW_HEIGHT = 30;
const GUIDE_COLOR = "var(--slate-a6)";

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
    isRoot: boolean,
  ): React.ReactNode =>
    childrenOf(parentKey).map((n) => {
      const hasChildren = childrenOf(n.key).length > 0;
      const expanded = !collapsed.has(n.key);
      const isCurrent = n.key === currentKey;
      return (
        <Box key={n.key} style={{ position: "relative" }}>
          {!isRoot && (
            <Box
              style={{
                position: "absolute",
                left: -9,
                top: ROW_HEIGHT / 2,
                width: 9,
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
            onClick={() => router.push(`/configs/${n.key}`)}
            style={{
              height: ROW_HEIGHT,
              borderRadius: "var(--radius-2)",
              cursor: "pointer",
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
              {hasChildren ?
                (expanded ? (
                  <PiCaretDown size={10} />
                ) : (
                  <PiCaretRight size={10} />
                )) : <PiDotOutline size={20} />}
            </Flex>
            <Flex
              align="center"
              style={{
                flexShrink: 0,
                color: isCurrent ? "var(--violet-11)" : "var(--slate-11)",
              }}
            >
              {isRoot ? (
                <PiStackBold size={14} />
              ) : (
                <PiBracketsCurly size={14} />
              )}
            </Flex>
            <Text
              size="1"
              weight={isCurrent ? "medium" : "regular"}
              truncate
              ml="1"
              style={{
                flex: 1,
                minWidth: 0,
                color: isCurrent ? "var(--violet-11)" : undefined,
              }}
            >
              {n.name}
            </Text>
            <Text
              size="1"
              style={{
                flexShrink: 0,
                color: "var(--slate-10)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {n.fieldCount}
            </Text>
          </Flex>
          {hasChildren && expanded && (
            <Box
              style={{
                marginLeft: 13,
                paddingLeft: 9,
                borderLeft: `1px solid ${GUIDE_COLOR}`,
              }}
            >
              {renderNodes(n.key, false)}
            </Box>
          )}
        </Box>
      );
    });

  return <Box>{renderNodes(null, true)}</Box>;
}
