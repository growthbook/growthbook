// The page-structure snapshot the extension captures: significant containers
// (sections, layout wrappers, heading ancestors), each with a durable
// selector and a parent pointer. Extensions that send `docOrder` also give
// document order and the nearest visible siblings, which is what lets the
// prompt render an outline and the model build a move. Pure functions so the
// tools and the prompt renderer share one tree.

export interface PageStructureNode {
  selector: string;
  parentSelector?: string;
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  label?: string;
  docOrder?: number;
  prevSiblingSelector?: string;
  nextSiblingSelector?: string;
  layout?: "flex-row" | "flex-column" | "grid";
}

export interface StructureTreeNode {
  node: PageStructureNode;
  depth: number;
  children: StructureTreeNode[];
}

// Older extensions send nodes in capture-priority order: nesting can be
// rebuilt from parent pointers but sibling order can't, so the outline is
// only rendered when every node carries `docOrder`.
export function hasDocumentOrder(nodes: PageStructureNode[]): boolean {
  return nodes.length > 0 && nodes.every((n) => typeof n.docOrder === "number");
}

export function buildStructureTree(
  nodes: PageStructureNode[],
): StructureTreeNode[] {
  const sorted = [...nodes].sort(
    (a, b) => (a.docOrder ?? 0) - (b.docOrder ?? 0),
  );
  const bySelector = new Map<string, StructureTreeNode>();
  for (const node of sorted) {
    if (!bySelector.has(node.selector)) {
      bySelector.set(node.selector, { node, depth: 0, children: [] });
    }
  }
  const roots: StructureTreeNode[] = [];
  for (const tn of bySelector.values()) {
    const parent = tn.node.parentSelector
      ? bySelector.get(tn.node.parentSelector)
      : undefined;
    if (parent && parent !== tn) parent.children.push(tn);
    else roots.push(tn);
  }
  // A malformed payload could point parents in a cycle; never recurse twice.
  const seen = new Set<StructureTreeNode>();
  const setDepth = (tn: StructureTreeNode, depth: number) => {
    if (seen.has(tn)) return;
    seen.add(tn);
    tn.depth = depth;
    for (const c of tn.children) setDepth(c, depth + 1);
  };
  for (const r of roots) setDepth(r, 0);
  return roots;
}

const truncate = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

// Layout rides in the tag so a row or grid is visible where the model picks
// an insert anchor.
const describeLine = (n: PageStructureNode): string =>
  `\`${n.selector}\` <${n.tag}${n.id ? `#${n.id}` : ""}${
    n.layout ? ` ${n.layout}` : ""
  }>${n.label ? ` "${truncate(n.label, 40)}"` : ""}`;

// Indented outline of the top of the tree. Deeper levels stay reachable via
// describeContainer, so the budget goes to the containers a request is most
// likely to name.
export function renderPageOutline(
  nodes: PageStructureNode[],
  {
    maxDepth = 3,
    maxLines = 60,
  }: { maxDepth?: number; maxLines?: number } = {},
): string {
  if (!hasDocumentOrder(nodes)) return "";
  const lines: string[] = [];
  let omitted = 0;
  const countAll = (tn: StructureTreeNode): number =>
    1 + tn.children.reduce((n, c) => n + countAll(c), 0);
  const walk = (tn: StructureTreeNode) => {
    if (tn.depth >= maxDepth || lines.length >= maxLines) {
      omitted += countAll(tn);
      return;
    }
    lines.push(`${"  ".repeat(tn.depth)}- ${describeLine(tn.node)}`);
    for (const c of tn.children) walk(c);
  };
  for (const r of buildStructureTree(nodes)) walk(r);
  if (omitted > 0) {
    lines.push(
      `  … ${omitted} more container${
        omitted === 1 ? "" : "s"
      } nested deeper — call describeContainer(selector) to list a container's children.`,
    );
  }
  return lines.join("\n");
}

export interface ContainerSummary {
  selector: string;
  tag: string;
  id?: string;
  label?: string;
  classes?: string[];
  role?: string;
  layout?: PageStructureNode["layout"];
}

export interface ContainerDescription extends ContainerSummary {
  parentSelector?: string;
  prevSiblingSelector?: string;
  nextSiblingSelector?: string;
  children: ContainerSummary[];
}

const summarize = (n: PageStructureNode): ContainerSummary => ({
  selector: n.selector,
  tag: n.tag,
  ...(n.id ? { id: n.id } : {}),
  ...(n.label ? { label: n.label } : {}),
  ...(n.classes?.length ? { classes: n.classes } : {}),
  ...(n.role ? { role: n.role } : {}),
  ...(n.layout ? { layout: n.layout } : {}),
});

export function describeContainer(
  nodes: PageStructureNode[],
  selector: string,
): ContainerDescription | null {
  const node = nodes.find((n) => n.selector === selector);
  if (!node) return null;
  const find = (list: StructureTreeNode[]): StructureTreeNode | null => {
    for (const tn of list) {
      if (tn.node.selector === selector) return tn;
      const hit = find(tn.children);
      if (hit) return hit;
    }
    return null;
  };
  const tn = find(buildStructureTree(nodes));
  return {
    ...summarize(node),
    ...(node.parentSelector ? { parentSelector: node.parentSelector } : {}),
    ...(node.prevSiblingSelector
      ? { prevSiblingSelector: node.prevSiblingSelector }
      : {}),
    ...(node.nextSiblingSelector
      ? { nextSiblingSelector: node.nextSiblingSelector }
      : {}),
    children: (tn?.children ?? []).map((c) => summarize(c.node)),
  };
}
