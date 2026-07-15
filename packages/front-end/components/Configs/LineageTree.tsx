import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretRight,
  PiDotOutline,
  PiLinkBreak,
  PiWarningFill,
  PiPlusBold,
} from "react-icons/pi";
import { isScopedConfig } from "shared/util";
import { LineageNode } from "@/components/Configs/fieldSchema";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import styles from "./LineageTree.module.scss";

// Label for a flavor row: its environment(s), else project(s), else its name.
function flavorScopeLabel(n: LineageNode): string {
  const envs = n.scopedConfig?.environments;
  if (envs?.length) return envs.join(", ");
  const projs = n.scopedConfig?.projects;
  if (projs?.length) return projs.join(", ");
  return n.name;
}

const ROW_HEIGHT = 30;
const GUIDE_COLOR = "var(--slate-a6)";
// Indent the first two levels under a root; deeper nodes stop indenting.
const MAX_INDENT_DEPTH = 2;

// Horizontal elbow joining a row to its parent's vertical guide. Runs from the
// guide (5px left of the row's content edge) to just shy of the row's icon —
// close enough to read as connected, with a couple px of breathing room so the
// icon (e.g. the compose "+") stays legible rather than bleeding into the line.
function RowConnector(): React.ReactElement {
  return (
    <Box
      style={{
        position: "absolute",
        left: -5,
        top: ROW_HEIGHT / 2,
        width: 8,
        height: 1,
        background: GUIDE_COLOR,
      }}
    />
  );
}

export default function LineageTree({
  nodes,
  currentKey,
  fieldCounts,
  namesByKey,
  archivedByKey,
  draftKeys,
  extensible,
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
  // Family extensibility: in a non-extensible family an orphaned override is a
  // future publish error (amber); in an extensible one it's informational.
  extensible?: boolean;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const router = useRouter();

  // The rows are clickable Flex containers (not anchors), so navigate in-app on a
  // plain click but honor the browser's open-in-new-tab gestures (cmd/ctrl/shift
  // or middle-click) the way a real link would, instead of always forcing a new
  // tab. `onAuxClick` covers the middle-click case.
  const openConfig = (key: string) => (e: React.MouseEvent) => {
    const url = `/configs/${key}`;
    if (e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
    } else if (e.button === 0) {
      router.push(url);
    }
  };

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
  // Env/project flavors are children too (parent = base), but they're grouped
  // under an "Environments" label rather than rendered as plain child nodes.
  const flavorChildrenOf = (parentKey: string | null) =>
    childrenOf(parentKey).filter((c) => isScopedConfig(c));
  const regularChildrenOf = (parentKey: string | null) =>
    childrenOf(parentKey).filter((c) => !isScopedConfig(c));

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

  // The "Environments" branch defaults collapsed (env variants are secondary to
  // the main lineage), unlike config nodes which default expanded. Keyed by the
  // parent config; presence = open.
  const [openEnvGroups, setOpenEnvGroups] = useState<Set<string>>(new Set());

  // Auto-open the branch containing the flavor you're currently viewing so it's
  // visible on landing, and leave it open once opened — navigating away doesn't
  // re-collapse it (an explicit toggle still can).
  useEffect(() => {
    const current = nodeByKey.get(currentKey);
    const parentKey = current?.parentKey;
    if (current && parentKey && isScopedConfig(current)) {
      setOpenEnvGroups((prev) =>
        prev.has(parentKey) ? prev : new Set(prev).add(parentKey),
      );
    }
  }, [currentKey, nodeByKey]);

  const toggleEnvGroup = (parentKey: string) =>
    setOpenEnvGroups((prev) => {
      const next = new Set(prev);
      if (next.has(parentKey)) next.delete(parentKey);
      else next.add(parentKey);
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
        {showStub && <RowConnector />}
        <Flex
          align="center"
          gap="1"
          pl="1"
          pr="3"
          className={styles.row}
          title={`Composes ${name}${isArchived ? " (archived)" : ""}`}
          onClick={isCurrent ? undefined : openConfig(mk)}
          onAuxClick={isCurrent ? undefined : openConfig(mk)}
          style={{
            height: ROW_HEIGHT,
            borderRadius: "var(--radius-2)",
            cursor: isCurrent ? "default" : "pointer",
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
              // Mixins share the default text color of the other config rows;
              // only the archived (and current) states diverge.
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

  // A single env/project flavor, rendered as a leaf under the "Environments"
  // group. Labelled by its scope (e.g. "dev"); clicking opens the flavor config.
  const renderFlavorRow = (n: LineageNode, depth: number): React.ReactNode => {
    const label = flavorScopeLabel(n);
    const isCurrent = n.key === currentKey;
    const isArchived = !!archivedByKey?.[n.key];
    const isDraftNode = !!draftKeys?.[n.key];
    // Env leaves indent one level past the spine's max-depth cap (the group
    // adds a +1 override), so allow the connector stub one deeper too.
    const showStub = depth >= 1 && depth <= MAX_INDENT_DEPTH + 1;
    return (
      <Box key={`flavor-${n.key}`} style={{ position: "relative" }}>
        {showStub && <RowConnector />}
        <Flex
          align="center"
          gap="1"
          pl="1"
          pr="3"
          className={styles.row}
          title={`${n.name}${isArchived ? " (archived)" : ""}`}
          onClick={isCurrent ? undefined : openConfig(n.key)}
          onAuxClick={isCurrent ? undefined : openConfig(n.key)}
          style={{
            height: ROW_HEIGHT,
            borderRadius: "var(--radius-2)",
            cursor: isCurrent ? "default" : "pointer",
            background: isCurrent ? "var(--violet-a3)" : undefined,
          }}
        >
          <Flex
            align="center"
            justify="center"
            style={{ width: 14, flexShrink: 0, color: "var(--slate-11)" }}
          >
            <PiDotOutline size={20} />
          </Flex>
          <span
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
            {label}
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
          {n.fieldCount !== undefined && countBadge(n.fieldCount)}
        </Flex>
      </Box>
    );
  };

  // The "Environments" branch under a node: a collapsible group (a sibling of
  // the node's child configs, connected to the node's guide by a stub) with the
  // env-override leaves nested one level beneath it. Defaults collapsed — its
  // own caret expands it, matching the config rows. Rendered before the child
  // configs; null when the node has none. `depth` is the child level.
  const renderEnvironmentsGroup = (
    parentKey: string,
    depth: number,
  ): React.ReactNode => {
    const flavors = flavorChildrenOf(parentKey);
    if (!flavors.length) return null;
    const showStub = depth >= 1 && depth <= MAX_INDENT_DEPTH;
    const isOpen = openEnvGroups.has(parentKey);
    return (
      <Box key={`envs-${parentKey}`} style={{ position: "relative" }}>
        {showStub && <RowConnector />}
        <Flex
          align="center"
          gap="1"
          pl="1"
          pr="3"
          className={styles.row}
          onClick={() => toggleEnvGroup(parentKey)}
          style={{
            height: ROW_HEIGHT,
            borderRadius: "var(--radius-2)",
            cursor: "pointer",
          }}
        >
          <Flex
            align="center"
            justify="center"
            style={{ width: 14, flexShrink: 0, color: "var(--slate-11)" }}
          >
            {isOpen ? <PiCaretDown size={10} /> : <PiCaretRight size={10} />}
          </Flex>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              marginLeft: 4,
              fontSize: "var(--font-size-1)",
              fontWeight: 500,
              color: "var(--slate-10)",
            }}
          >
            Environments
          </span>
          <Tooltip
            content={`${flavors.length} environment override${
              flavors.length === 1 ? "" : "s"
            }`}
          >
            <Badge
              size="xs"
              color="gray"
              radius="full"
              label={`${flavors.length}`}
              style={{
                flexShrink: 0,
                justifyContent: "center",
                textAlign: "center",
              }}
            />
          </Tooltip>
        </Flex>
        {isOpen && (
          // Indent the env leaves one step past the label (even at deep levels
          // where the spine stops indenting), so "dev" sits forward at the
          // child-name column.
          <Box
            style={{
              marginLeft: 6,
              paddingLeft: 5,
              borderLeft: `1px solid ${GUIDE_COLOR}`,
            }}
          >
            {flavors.map((f) => renderFlavorRow(f, depth + 1))}
          </Box>
        )}
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
    // Flavors aren't rendered as plain nodes — they're grouped under the
    // "Environments" label of their parent (see renderEnvironmentsGroup).
    regularChildrenOf(parentKey).map((n) => {
      if (seen.has(n.key)) return null;
      const childSeen = new Set(seen).add(n.key);
      const hasChildren = regularChildrenOf(n.key).length > 0;
      const hasFlavors = flavorChildrenOf(n.key).length > 0;
      const mixins = n.extendsKeys ?? [];
      const hasMixins = mixins.length > 0;
      // Children, mixins, and the Environments group all nest under the node, so
      // any of them makes it expandable/collapsible.
      const expandable = hasChildren || hasMixins || hasFlavors;
      const expanded = !collapsed.has(n.key);
      const isCurrent = n.key === currentKey;
      // Cap indentation at MAX_INDENT_DEPTH so deep chains don't run out of room
      // in the narrow sidebar; deeper nodes align under the last indented level
      // (guide stub + caret still convey structure).
      const showStub = depth >= 1 && depth <= MAX_INDENT_DEPTH;
      const indentChildren = depth < MAX_INDENT_DEPTH;
      const hasIncompatible = (n.incompatibleFields?.length ?? 0) > 0;
      const hasOrphaned = (n.orphanedFields?.length ?? 0) > 0;
      const hasViolations = (n.invariantViolations?.length ?? 0) > 0;
      const isArchived = !!archivedByKey?.[n.key];
      const isDraftNode = !!draftKeys?.[n.key];
      // Under a node, in order: mixins, then the "Environments" branch (a
      // labeled group with its env-override leaves nested beneath it), then the
      // regular child configs — all in the node's indented block, so env
      // overrides read as a distinct branch, not siblings of the child configs.
      const nested = (
        <>
          {mixins.map((mk) => renderMixinRow(mk, depth + 1))}
          {renderEnvironmentsGroup(n.key, depth + 1)}
          {renderNodes(n.key, depth + 1, childSeen)}
        </>
      );
      return (
        <Box key={n.key} style={{ position: "relative" }}>
          {showStub && <RowConnector />}
          <Flex
            align="center"
            gap="1"
            pl="1"
            pr="3"
            className={styles.row}
            onClick={isCurrent ? undefined : openConfig(n.key)}
            onAuxClick={isCurrent ? undefined : openConfig(n.key)}
            style={{
              height: ROW_HEIGHT,
              borderRadius: "var(--radius-2)",
              cursor: isCurrent ? "default" : "pointer",
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
            {hasOrphaned && (
              <PiLinkBreak
                size={12}
                title={
                  `Undeclared value key(s): ${n.orphanedFields?.join(", ")} — ` +
                  `the effective schema no longer declares them; they still ` +
                  `resolve, but nothing validates them and validation rules ` +
                  `read them as null.` +
                  (extensible === false
                    ? " This family is not extensible, so the next changing publish of this config will be rejected until they are removed or re-declared."
                    : "")
                }
                style={{
                  flexShrink: 0,
                  color:
                    extensible === false ? "var(--amber-11)" : "var(--slate-9)",
                }}
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

  return <Box>{renderNodes(null, 0)}</Box>;
}
