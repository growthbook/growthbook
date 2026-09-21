import {
  buildStructureTree,
  describeContainer,
  hasDocumentOrder,
  renderPageOutline,
  type PageStructureNode,
} from "back-end/src/api/visual-editor-ai/pageStructure";

// main > [hero, features > [grid > [card…]], pricing], footer — sent out of
// document order on purpose, the way capture-priority order would.
const nodes: PageStructureNode[] = [
  {
    selector: "#pricing",
    parentSelector: "main",
    tag: "section",
    id: "pricing",
    label: "Simple pricing",
    docOrder: 4,
    prevSiblingSelector: "#features",
  },
  { selector: "main", tag: "main", docOrder: 0, nextSiblingSelector: "footer" },
  {
    selector: ".hero",
    parentSelector: "main",
    tag: "section",
    label: "Build faster with GrowthBook and ship more experiments",
    docOrder: 1,
    nextSiblingSelector: "#features",
  },
  {
    selector: "#features",
    parentSelector: "main",
    tag: "section",
    id: "features",
    label: "Features",
    docOrder: 2,
    prevSiblingSelector: ".hero",
    nextSiblingSelector: "#pricing",
  },
  {
    selector: "#features .grid",
    parentSelector: "#features",
    tag: "div",
    classes: ["grid"],
    docOrder: 3,
    layout: "grid",
  },
  {
    selector: "footer",
    tag: "footer",
    docOrder: 5,
    prevSiblingSelector: "main",
  },
];

describe("hasDocumentOrder", () => {
  it("is true only when every node carries docOrder", () => {
    expect(hasDocumentOrder(nodes)).toBe(true);
    expect(hasDocumentOrder([{ selector: "a", tag: "div" }])).toBe(false);
    expect(hasDocumentOrder([])).toBe(false);
  });
});

describe("buildStructureTree", () => {
  it("nests by parent pointer and orders siblings by docOrder", () => {
    const roots = buildStructureTree(nodes);
    expect(roots.map((r) => r.node.selector)).toEqual(["main", "footer"]);
    const main = roots[0];
    expect(main.children.map((c) => c.node.selector)).toEqual([
      ".hero",
      "#features",
      "#pricing",
    ]);
    expect(main.children[1].children[0].node.selector).toBe("#features .grid");
    expect(main.children[1].children[0].depth).toBe(2);
  });

  it("treats a node whose parent isn't in the snapshot as a root", () => {
    const roots = buildStructureTree([
      { selector: ".a", parentSelector: ".missing", tag: "div", docOrder: 0 },
    ]);
    expect(roots).toHaveLength(1);
  });

  it("survives a parent cycle", () => {
    const roots = buildStructureTree([
      { selector: ".a", parentSelector: ".b", tag: "div", docOrder: 0 },
      { selector: ".b", parentSelector: ".a", tag: "div", docOrder: 1 },
    ]);
    expect(roots).toHaveLength(0);
  });
});

describe("renderPageOutline", () => {
  it("renders an indented outline in document order with truncated labels", () => {
    expect(renderPageOutline(nodes)).toBe(
      [
        "- `main` <main>",
        '  - `.hero` <section> "Build faster with GrowthBook and ship m…"',
        '  - `#features` <section#features> "Features"',
        "    - `#features .grid` <div grid>",
        '  - `#pricing` <section#pricing> "Simple pricing"',
        "- `footer` <footer>",
      ].join("\n"),
    );
  });

  it("stops at maxDepth and says how many containers it left out", () => {
    const out = renderPageOutline(nodes, { maxDepth: 2 });
    expect(out).not.toContain("#features .grid");
    expect(out).toContain("1 more container nested deeper");
  });

  it("caps the line count", () => {
    const out = renderPageOutline(nodes, { maxLines: 2 });
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("4 more containers");
  });

  it("renders nothing for a snapshot without document order", () => {
    expect(renderPageOutline([{ selector: "main", tag: "main" }])).toBe("");
  });
});

describe("describeContainer", () => {
  it("returns siblings, parent and ordered direct children", () => {
    expect(describeContainer(nodes, "#features")).toEqual({
      selector: "#features",
      tag: "section",
      id: "features",
      label: "Features",
      parentSelector: "main",
      prevSiblingSelector: ".hero",
      nextSiblingSelector: "#pricing",
      children: [
        {
          selector: "#features .grid",
          tag: "div",
          classes: ["grid"],
          layout: "grid",
        },
      ],
    });
  });

  it("returns null for a selector nothing is known about", () => {
    expect(describeContainer(nodes, ".nope")).toBeNull();
  });

  it("lists the ordered children of an uncaptured parent a match pointed at", () => {
    // Plan cards captured as heading ancestors; their grid wasn't.
    const cards: PageStructureNode[] = [
      {
        selector: "[data-plan='pro']",
        parentSelector: "#pricing .plans",
        tag: "div",
        label: "Pro",
        docOrder: 2,
      },
      {
        selector: "[data-plan='starter']",
        parentSelector: "#pricing .plans",
        tag: "div",
        label: "Starter",
        docOrder: 1,
      },
      {
        selector: "[data-plan='enterprise']",
        parentSelector: "#pricing .plans",
        tag: "div",
        label: "Enterprise",
        docOrder: 3,
      },
    ];
    const described = describeContainer(
      [...nodes, ...cards],
      "#pricing .plans",
    );
    expect(described?.children.map((c) => c.label)).toEqual([
      "Starter",
      "Pro",
      "Enterprise",
    ]);
    expect(described?.tag).toBeUndefined();
    expect(described?.note).toMatch(/wasn't captured/);
  });
});
