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

export interface KnownContainer {
  selector: string;
  // False for a parent the snapshot only knows by selector.
  captured: boolean;
  tag?: string;
  label?: string;
}

export interface ContainerDescription extends Omit<ContainerSummary, "tag"> {
  tag?: string;
  parentSelector?: string;
  prevSiblingSelector?: string;
  nextSiblingSelector?: string;
  children: ContainerSummary[];
  // Known containers somewhere under an uncaptured selector, nearest first.
  // Their exact nesting is unknown, so they are not `children`.
  descendants?: KnownContainer[];
  note?: string;
}

// Every selector the snapshot knows anything about: captured nodes, plus the
// parents they point at. Uncaptured parents take their first child's place in
// document order.
function knownContainers(
  nodes: PageStructureNode[],
): Array<KnownContainer & { docOrder: number }> {
  const out = new Map<string, KnownContainer & { docOrder: number }>();
  const sorted = [...nodes].sort(
    (a, b) => (a.docOrder ?? 0) - (b.docOrder ?? 0),
  );
  for (const n of sorted) {
    if (n.parentSelector && !out.has(n.parentSelector)) {
      out.set(n.parentSelector, {
        selector: n.parentSelector,
        captured: false,
        docOrder: n.docOrder ?? 0,
      });
    }
  }
  for (const n of sorted) {
    out.set(n.selector, {
      selector: n.selector,
      captured: true,
      tag: n.tag,
      ...(n.label ? { label: n.label } : {}),
      docOrder: n.docOrder ?? 0,
    });
  }
  return [...out.values()];
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
  if (!node) {
    // findElements hands out each match's parentSelector, but the parent is
    // often not a captured node itself (a card grid whose headings sit one
    // level down). Its captured children are still known, and listing them
    // in order is exactly what a reorder needs — so only when their order is
    // known: a snapshot without docOrder arrived in capture-priority order,
    // which would misplace a move.
    const children = nodes
      .filter((n) => n.parentSelector === selector)
      .sort((a, b) => (a.docOrder ?? 0) - (b.docOrder ?? 0));
    if (children.length > 0 && hasDocumentOrder(children)) {
      return {
        selector,
        children: children.map(summarize),
        note: "This container wasn't captured itself, so its tag, layout and siblings are unknown; `children` are its captured direct children in page order.",
      };
    }
    // Neither captured nor a captured node's parent — typically a selector
    // the model built from a class name it saw in a match. What IS known
    // underneath it is still useful: a model probing for the plans' row can
    // act on the plan cards themselves instead of asking again.
    const descendants = knownContainers(nodes)
      .filter(
        (k) =>
          k.selector.startsWith(`${selector} `) ||
          k.selector.startsWith(`${selector}>`),
      )
      .sort(
        (a, b) =>
          a.selector.slice(selector.length).split(/\s+|>/).length -
            b.selector.slice(selector.length).split(/\s+|>/).length ||
          a.docOrder - b.docOrder,
      )
      .slice(0, 12)
      .map(({ docOrder: _order, ...k }) => k);
    if (descendants.length === 0) return null;
    return {
      selector,
      children: [],
      descendants,
      note: "This selector isn't a captured container and nothing is known about its layout or direct children. `descendants` are the known containers inside it, nearest first — act on those. For a reorder, prefer one CSS `order` rule per item over a position move into this selector, whose direct children can't be verified. The items are the nearest descendants with `captured: false` (the cards); `order` only moves flex/grid items, so a rule on a captured wrapper inside a card does nothing.",
    };
  }
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
