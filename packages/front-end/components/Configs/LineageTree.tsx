import React, { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiDotOutline,
  PiWarningFill,
  PiPlusBold,
} from "react-icons/pi";
import { LineageNode } from "@/components/Configs/fieldSchema";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";

const ROW_HEIGHT = 30;
const GUIDE_COLOR = "var(--slate-a6)";
// Indent the first two levels under a root; deeper nodes stop indenting.
const MAX_INDENT_DEPTH = 2;

export default function LineageTree({
  nodes,
  currentKey,
  fieldCounts,
  namesByKey,
  archivedByKey,
  draftKeys,
}: {
  nodes: LineageNode[];
  currentKey: string;
  // Own-value field count per config key, used for mixin rows whose config is
  // not part of the rendered family (so it has no LineageNode).
  fieldCounts?: Record<string, number>;
  // Display name per config key, so mixin rows (whose config usually lives
  // outside the rendered family) show the name instead of the raw key.
  namesByKey?: Record<string, string>;
  // Archived flag per config key, so archived configs render struck-through
  // (they're otherwise invisible — the list hides them by default).
  archivedByKey?: Record<string, boolean>;
  // Keys whose rendered content reflects an unpublished draft (currently just the
  // local/active draft). Marked with an amber dot so it's clear the tree is
  // showing staged, not live, data for that node.
  draftKeys?: Record<string, boolean>;
}): React.ReactElement {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Index children-by-parent and node-by-key once per `nodes` change so the
  // recursive render is O(N) rather than O(N²) (a filter/find per node visit).
  const { childrenByParent, nodeByKey } = useMemo(() => {
    const children = new Map<string | null, LineageNode[]>();
    const byKey = new Map<string, LineageNode>();
    for (const n of nodes) {
      byKey.set(n.key, n);
      const list = children.get(n.parentKey);
      if (list) list.push(n);
      else children.set(n.parentKey, [n]);
    }
    return { childrenByParent: children, nodeByKey: byKey };
  }, [nodes]);

  const childrenOf = (parentKey: string | null) =>
    childrenByParent.get(parentKey) ?? [];

  // Field-count pill, matching the counter badges on the Configs/Features tabs.
  // Center the digit (the badge's min-width otherwise left-aligns it) and keep it
  // from shrinking when a deeply-nested row gets tight in the narrow sidebar.
  const countBadge = (count: number) => (
    <Tooltip
      content={`${count} field${count === 1 ? "" : "s"} defined in this config`}
    >
      <Badge
        size="xs"
        color="gray"
        radius="full"
        label={`${count}`}
        style={{
          flexShrink: 0,
          justifyContent: "center",
          textAlign: "center",
        }}
      />
    </Tooltip>
  );

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A composition mixin, rendered as its own row (nested like a child but marked
  // with a "+" to convey it's a layered-in config, not a parent/child edge).
  const renderMixinRow = (mk: string, depth: number): React.ReactNode => {
    const node = nodeByKey.get(mk);
    const name = namesByKey?.[mk] ?? node?.name ?? mk;
    const count = fieldCounts?.[mk] ?? node?.fieldCount;
    const isArchived = !!archivedByKey?.[mk];
    const isCurrent = mk === currentKey;
    const isDraftNode = !!draftKeys?.[mk];
    const showStub = depth >= 1 && depth <= MAX_INDENT_DEPTH;
    return (
      <Box key={`mixin-${mk}`} style={{ position: "relative" }}>
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
          title={`Composes ${name}${isArchived ? " (archived)" : ""}`}
          onClick={() => router.push(`/configs/${mk}`)}
          style={{
            height: ROW_HEIGHT,
            borderRadius: "var(--radius-2)",
            cursor: "pointer",
            // Inline background only for the current node so the CSS :hover rule
            // (lower specificity) still applies to the other rows.
            background: isCurrent ? "var(--violet-a3)" : undefined,
          }}
        >
          <Flex
            align="center"
            justify="center"
            style={{ width: 14, flexShrink: 0, color: "var(--slate-10)" }}
          >
            <PiPlusBold size={10} />
          </Flex>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              marginLeft: 4,
              fontSize: "var(--font-size-1)",
              fontStyle: "italic",
              fontWeight: isCurrent ? 500 : 400,
              color: isCurrent
                ? "var(--violet-11)"
                : isArchived
                  ? "var(--slate-9)"
                  : "var(--slate-11)",
              textDecoration: isArchived ? "line-through" : undefined,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          {isDraftNode && (
            <Tooltip content="Showing an unpublished draft — values here reflect staged changes, not the live config.">
              <Box
                style={{
                  flexShrink: 0,
                  width: 8,
                  height: 8,
                  marginRight: 4,
                  borderRadius: "50%",
                  background: "var(--amber-9)",
                }}
              />
            </Tooltip>
          )}
          {count !== undefined && countBadge(count)}
        </Flex>
      </Box>
    );
  };

  const renderNodes = (
    parentKey: string | null,
    depth: number,
    // Guard against malformed cyclic data (a node listed as its own ancestor),
    // which would otherwise recurse until the stack overflows.
    seen: Set<string> = new Set(),
  ): React.ReactNode =>
    childrenOf(parentKey).map((n) => {
      if (seen.has(n.key)) return null;
      const childSeen = new Set(seen).add(n.key);
      const hasChildren = childrenOf(n.key).length > 0;
      const mixins = n.extendsKeys ?? [];
      const hasMixins = mixins.length > 0;
      // Both children and mixins are nested under the node, so either makes the
      // node expandable/collapsible.
      const expandable = hasChildren || hasMixins;
      const expanded = !collapsed.has(n.key);
      const isCurrent = n.key === currentKey;
      // Cap indentation at MAX_INDENT_DEPTH so deep chains don't run out of room
      // in the narrow sidebar; deeper nodes align under the last indented level
      // (guide stub + caret still convey structure).
      const showStub = depth >= 1 && depth <= MAX_INDENT_DEPTH;
      const indentChildren = depth < MAX_INDENT_DEPTH;
      const hasIncompatible = (n.incompatibleFields?.length ?? 0) > 0;
      const hasViolations = (n.invariantViolations?.length ?? 0) > 0;
      const isArchived = !!archivedByKey?.[n.key];
      const isDraftNode = !!draftKeys?.[n.key];
      // Mixins listed first, then child configs.
      const nested = (
        <>
          {mixins.map((mk) => renderMixinRow(mk, depth + 1))}
          {renderNodes(n.key, depth + 1, childSeen)}
        </>
      );
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
                if (expandable) {
                  e.stopPropagation();
                  toggle(n.key);
                }
              }}
              style={{ width: 14, flexShrink: 0, color: "var(--slate-11)" }}
            >
              {expandable ? (
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
              title={`${n.name}${isArchived ? " (archived)" : ""}`}
              style={{
                flex: 1,
                minWidth: 0,
                marginLeft: 4,
                fontSize: "var(--font-size-1)",
                fontWeight: isCurrent ? 500 : 400,
                color: isCurrent
                  ? "var(--violet-11)"
                  : isArchived
                    ? "var(--slate-9)"
                    : undefined,
                textDecoration: isArchived ? "line-through" : undefined,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {n.name}
            </span>
            {isDraftNode && (
              <Tooltip content="Showing an unpublished draft — values here reflect staged changes, not the live config.">
                <Box
                  style={{
                    flexShrink: 0,
                    width: 8,
                    height: 8,
                    marginRight: 4,
                    borderRadius: "50%",
                    background: "var(--amber-9)",
                  }}
                />
              </Tooltip>
            )}
            {hasIncompatible && (
              <PiWarningFill
                size={12}
                title={`Incompatible value(s): ${n.incompatibleFields?.join(", ")}`}
                style={{ flexShrink: 0, color: "var(--amber-11)" }}
              />
            )}
            {hasViolations && (
              <PiWarningFill
                size={12}
                title={`Violates validation rule(s): ${n.invariantViolations
                  ?.map((v) => v.message)
                  .join("; ")}`}
                style={{ flexShrink: 0, color: "var(--red-11)" }}
              />
            )}
            {n.fieldCount !== undefined && countBadge(n.fieldCount)}
          </Flex>
          {expandable &&
            expanded &&
            (indentChildren ? (
              <Box
                style={{
                  marginLeft: 6,
                  paddingLeft: 5,
                  borderLeft: `1px solid ${GUIDE_COLOR}`,
                }}
              >
                {nested}
              </Box>
            ) : (
              nested
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
