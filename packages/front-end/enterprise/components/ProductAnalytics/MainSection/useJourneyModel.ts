import type {
  JourneyDataset,
  JourneyDirection,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  JOURNEY_ENTRY,
  JOURNEY_EXIT,
  JOURNEY_NONE,
  JOURNEY_OTHER,
  JOURNEY_TERMINALS,
  composeStepLabel,
} from "shared/journeys";

const LEAK_OTHER = "\u0002other";
const LEAK_EXIT = "\u0002exit";

export type JourneyNode = {
  key: string;
  label: string;
  value: number;
  dimParts: Map<string, number> | null;
  chain?: boolean;
  terminal?: boolean;
};

export type JourneyColumn = {
  side: "a" | "f" | "b";
  committed: boolean;
  frontier: boolean;
  anchor?: boolean;
  fi?: number;
  optionsLevel?: number;
  label: string;
  offset: number;
  commitIndex?: number;
  nodes: JourneyNode[];
  x: number;
  total: number;
  scale: number;
};

export type JourneyEdge = {
  ci: number;
  from: string;
  to: string;
  value: number;
  dims: Map<string, number> | null;
  committedEdge?: boolean;
  leak?: boolean;
  side?: "f" | "b";
  fi?: number;
  srcKey?: string;
  tgtKey?: string;
  h0: number;
  h1: number;
  y0: number;
  y1: number;
};

type JourneyLevel = {
  nodes: JourneyNode[];
};

type JourneyHistory = {
  anchorTotal: number;
  anchorDims: Map<string, number>;
  levels: Array<JourneyLevel | null>;
};

export type JourneyViewModel = {
  columns: JourneyColumn[];
  edges: JourneyEdge[];
  anchorTotal: number;
  matchedTotal: number;
  dimTop: string[];
  anchorDims: Map<string, number>;
  prefixCount: number[];
  leak: {
    other: number;
    exit: number;
    otherDims: Map<string, number>;
    exitDims: Map<string, number>;
  }[];
  direction: JourneyDirection;
  violations: string[];
  emptyReason: "none" | "no-anchor" | "no-match";
};

type PathRow = {
  levels: string[];
  dim: string | null;
  n: number;
};

type PathStep = JourneyDataset["path"][number];

function addDim(map: Map<string, number>, dim: string | null, n: number) {
  if (!dim) return;
  map.set(dim, (map.get(dim) || 0) + n);
}

function parsePathRows(rows: ProductAnalyticsResultRow[]): PathRow[] {
  const pathRows: PathRow[] = [];
  for (const row of rows) {
    const j = row.journey;
    if (!j || j.kind !== "path") continue;
    pathRows.push({
      levels: j.levels,
      dim: row.dimensions[0] ?? null,
      n: j.count,
    });
  }
  return pathRows;
}

function cloneNodes(nodes: JourneyNode[]): JourneyNode[] {
  return nodes.map((n) => ({
    ...n,
    dimParts: n.dimParts ? new Map(n.dimParts) : null,
  }));
}

function rankNode(k: string): number {
  return k === JOURNEY_OTHER ? 2 : JOURNEY_TERMINALS.has(k) ? 3 : 1;
}

function isExitNode(n: JourneyNode, term: string): boolean {
  return (
    n.terminal === true ||
    JOURNEY_TERMINALS.has(n.key) ||
    n.key === term ||
    n.key === LEAK_EXIT
  );
}

function nodeMatchesStep(n: JourneyNode, step: PathStep): boolean {
  return n.key === step.value;
}

function splitFromLevel(
  level: JourneyLevel,
  step: PathStep,
  term: string,
): {
  taken: number;
  other: number;
  exit: number;
  takenDims: Map<string, number>;
  otherDims: Map<string, number>;
  exitDims: Map<string, number>;
} {
  let taken = 0;
  let other = 0;
  let exit = 0;
  const takenDims = new Map<string, number>();
  const otherDims = new Map<string, number>();
  const exitDims = new Map<string, number>();
  for (const n of level.nodes) {
    const dims = n.dimParts;
    if (nodeMatchesStep(n, step)) {
      taken += n.value;
      if (dims)
        for (const [k, v] of dims)
          takenDims.set(k, (takenDims.get(k) || 0) + v);
    } else if (isExitNode(n, term)) {
      exit += n.value;
      if (dims)
        for (const [k, v] of dims) exitDims.set(k, (exitDims.get(k) || 0) + v);
    } else {
      other += n.value;
      if (dims)
        for (const [k, v] of dims)
          otherDims.set(k, (otherDims.get(k) || 0) + v);
    }
  }
  return { taken, other, exit, takenDims, otherDims, exitDims };
}

function levelFromAgg(
  agg: Map<string, { value: number; dims: Map<string, number> }>,
  hasDimension: boolean,
): JourneyLevel {
  const nodes: JourneyNode[] = [];
  for (const [key, a] of agg) {
    nodes.push({
      key,
      label: key,
      value: a.value,
      dimParts: hasDimension ? a.dims : null,
    });
  }
  nodes.sort(
    (a, b) =>
      rankNode(a.key) - rankNode(b.key) ||
      b.value - a.value ||
      (a.key < b.key ? -1 : 1),
  );
  return { nodes };
}

function parseCommittedLevels(
  rows: ProductAnalyticsResultRow[],
  hasDimension: boolean,
): Map<number, JourneyLevel> {
  const byStep = new Map<
    number,
    Map<string, { value: number; dims: Map<string, number> }>
  >();
  for (const row of rows) {
    const j = row.journey;
    if (!j || j.kind !== "committed") continue;
    let agg = byStep.get(j.stepIndex);
    if (!agg) {
      agg = new Map();
      byStep.set(j.stepIndex, agg);
    }
    let na = agg.get(j.value);
    if (!na) {
      na = { value: 0, dims: new Map() };
      agg.set(j.value, na);
    }
    na.value += j.count;
    addDim(na.dims, row.dimensions[0] ?? null, j.count);
  }
  const levels = new Map<number, JourneyLevel>();
  for (const [stepIndex, agg] of byStep) {
    levels.set(stepIndex, levelFromAgg(agg, hasDimension));
  }
  return levels;
}

function computeFrontierFromPathRows(
  pathRows: PathRow[],
  hasDimension: boolean,
): JourneyLevel {
  const nodeAgg = new Map<
    string,
    { value: number; dims: Map<string, number> }
  >();
  for (const r of pathRows) {
    const v = r.levels[0];
    if (v === JOURNEY_NONE || v == null) continue;
    let na = nodeAgg.get(v);
    if (!na) {
      na = { value: 0, dims: new Map() };
      nodeAgg.set(v, na);
    }
    na.value += r.n;
    addDim(na.dims, r.dim, r.n);
  }
  return levelFromAgg(nodeAgg, hasDimension);
}

function reduceJourneyHistory({
  rows,
  dataset,
  hasDimension,
}: {
  rows: ProductAnalyticsResultRow[];
  dataset: JourneyDataset;
  hasDimension: boolean;
}): JourneyHistory {
  const pathRows = parsePathRows(rows);
  const committedLevels = parseCommittedLevels(rows, hasDimension);
  const needed = dataset.path.length + 1;
  const levels: Array<JourneyLevel | null> = Array.from(
    { length: needed },
    () => null,
  );

  for (const [stepIndex, level] of committedLevels) {
    if (stepIndex < needed) {
      levels[stepIndex] = level;
    }
  }
  if (levels[dataset.path.length] == null) {
    levels[dataset.path.length] = computeFrontierFromPathRows(
      pathRows,
      hasDimension,
    );
  }

  const next: JourneyHistory = {
    anchorTotal: 0,
    anchorDims: new Map(),
    levels,
  };
  const firstLevel = next.levels[0];
  if (firstLevel) {
    next.anchorTotal = firstLevel.nodes.reduce((a, n) => a + n.value, 0);
    if (hasDimension) {
      const dims = new Map<string, number>();
      for (const n of firstLevel.nodes) {
        if (!n.dimParts) continue;
        for (const [k, v] of n.dimParts) dims.set(k, (dims.get(k) || 0) + v);
      }
      if (dims.size) next.anchorDims = dims;
    }
  } else {
    next.anchorTotal = pathRows.reduce((a, r) => a + r.n, 0);
    if (hasDimension) {
      for (const r of pathRows) addDim(next.anchorDims, r.dim, r.n);
    }
  }
  return next;
}

function verifyModel(
  m: Pick<
    JourneyViewModel,
    | "columns"
    | "edges"
    | "anchorTotal"
    | "matchedTotal"
    | "prefixCount"
    | "leak"
    | "dimTop"
    | "anchorDims"
    | "direction"
  >,
  depth: number,
): string[] {
  const bad: string[] = [];
  const side = m.direction === "forward" ? "f" : "b";
  const cols = m.columns
    .filter((c) => c.frontier && c.side === side)
    .sort((a, b) => (a.fi ?? 0) - (b.fi ?? 0));
  if (cols.length) {
    const first = cols[0].nodes.reduce((a, n) => a + n.value, 0);
    if (first !== m.matchedTotal) {
      bad.push(
        `${side} frontier level 1 sums to ${first} but the committed population is ${m.matchedTotal}`,
      );
    }
    const deepest = m.prefixCount[depth];
    if (depth > 0 && deepest !== m.matchedTotal) {
      bad.push(
        `${side} deepest committed step is ${deepest} but the frontier totals ${m.matchedTotal}`,
      );
    }
    for (let k = 0; k < depth; k++) {
      const lk = m.leak[k];
      if (!lk) continue;
      const total = m.prefixCount[k + 1] + lk.other + lk.exit;
      if (total !== m.prefixCount[k]) {
        bad.push(
          `${side} step ${k + 1} splits to ${total} but its parent is ${m.prefixCount[k]}`,
        );
      }
    }
    const chain = [m.anchorTotal, ...m.prefixCount.slice(1)];
    for (let i = 1; i < chain.length; i++) {
      if (chain[i] > chain[i - 1]) {
        bad.push(`${side} chain widens at step ${i}: ${chain.join(" → ")}`);
      }
    }
  }
  if (m.dimTop.length) {
    const dimSum = m.dimTop
      .concat([JOURNEY_OTHER])
      .reduce((a, d) => a + (m.anchorDims.get(d) || 0), 0);
    if (dimSum !== m.anchorTotal) {
      bad.push(
        `dimension buckets sum to ${dimSum} but the anchor is ${m.anchorTotal}`,
      );
    }
  }
  return bad;
}

function materializeJourneyViewModel({
  dataset,
  history,
  hasDimension,
}: {
  dataset: JourneyDataset;
  history: JourneyHistory;
  hasDimension: boolean;
}): JourneyViewModel {
  const direction = dataset.direction;
  const side = direction === "forward" ? "f" : "b";
  const term = direction === "forward" ? JOURNEY_EXIT : JOURNEY_ENTRY;
  const anchorLabel = dataset.anchorStepValues
    ? composeStepLabel(dataset.anchorStepValues)
    : direction === "backward"
      ? "ending step"
      : "starting step";

  const prefixCount: number[] = [history.anchorTotal];
  const prefixDims: Map<string, number>[] = [new Map(history.anchorDims)];
  const leak: JourneyViewModel["leak"] = [];
  const viewPath: PathStep[] = [];

  for (let k = 0; k < dataset.path.length; k++) {
    const step = dataset.path[k];
    const level = history.levels[k];
    if (level) {
      const split = splitFromLevel(level, step, term);
      leak.push({
        other: split.other,
        exit: split.exit,
        otherDims: split.otherDims,
        exitDims: split.exitDims,
      });
      prefixCount.push(split.taken);
      prefixDims.push(split.takenDims);
      viewPath.push(step);
      continue;
    }
    break;
  }

  const depth = viewPath.length;
  const frontier = history.levels[depth] ?? null;
  const matchedTotal = frontier
    ? frontier.nodes.reduce((a, n) => a + n.value, 0)
    : (prefixCount[depth] ?? history.anchorTotal);

  const anchorDims = new Map(history.anchorDims);
  const dimTop = Array.from(anchorDims.entries())
    .filter(([k]) => k !== JOURNEY_OTHER && k !== "other")
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const sideColumns: JourneyColumn[] = [];
  for (let k = 0; k < depth; k++) {
    const lab = viewPath[k].value;
    const nodes: JourneyNode[] = [
      {
        key: lab,
        label: lab,
        value: prefixCount[k + 1] ?? 0,
        dimParts: hasDimension ? (prefixDims[k + 1] ?? null) : null,
        chain: true,
      },
    ];
    const lk = leak[k];
    if (lk && lk.other > 0) {
      nodes.push({
        key: LEAK_OTHER,
        label: JOURNEY_OTHER,
        value: lk.other,
        dimParts: hasDimension ? lk.otherDims : null,
        terminal: true,
      });
    }
    if (lk && lk.exit > 0) {
      nodes.push({
        key: LEAK_EXIT,
        label: term,
        value: lk.exit,
        dimParts: hasDimension ? lk.exitDims : null,
        terminal: true,
      });
    }
    sideColumns.push({
      side,
      committed: true,
      frontier: false,
      label: `Step ${k + 1}`,
      offset: (direction === "forward" ? 1 : -1) * (k + 1),
      commitIndex: k,
      nodes,
      x: 0,
      total: 0,
      scale: 0,
    });
  }
  if (frontier) {
    sideColumns.push({
      side,
      committed: false,
      frontier: true,
      fi: 0,
      optionsLevel: depth,
      label: `Step ${depth + 1}`,
      offset: (direction === "forward" ? 1 : -1) * (depth + 1),
      nodes: cloneNodes(frontier.nodes),
      x: 0,
      total: 0,
      scale: 0,
    });
  }

  const anchorCol: JourneyColumn = {
    side: "a",
    committed: true,
    frontier: false,
    anchor: true,
    label: "anchor",
    offset: 0,
    nodes: [
      {
        key: anchorLabel,
        label: anchorLabel,
        value: prefixCount[0] || matchedTotal,
        dimParts: hasDimension ? anchorDims : null,
      },
    ],
    x: 0,
    total: 0,
    scale: 0,
  };

  const columns: JourneyColumn[] =
    direction === "backward"
      ? [...sideColumns].reverse().concat([anchorCol])
      : [anchorCol, ...sideColumns];

  const edges: JourneyEdge[] = [];
  for (let ci = 0; ci < columns.length - 1; ci++) {
    const A = columns[ci];
    const B = columns[ci + 1];
    const target = A.side === "b" ? A : B;
    const upstream = target === B ? A : B;
    const up = upstream.nodes[0];
    if (!up) continue;
    for (const n of target.nodes) {
      const from = target === B ? up.key : n.key;
      const to = target === B ? n.key : up.key;
      edges.push({
        ci,
        value: n.value,
        dims: n.dimParts,
        committedEdge: !target.frontier,
        leak: n.terminal === true,
        from,
        to,
        side: target.frontier ? side : undefined,
        fi: target.frontier ? target.fi : undefined,
        srcKey: target === B ? up.key : n.key,
        tgtKey: target === B ? n.key : up.key,
        h0: 0,
        h1: 0,
        y0: 0,
        y1: 0,
      });
    }
  }

  const resolvedAnchor = prefixCount[0] || matchedTotal;
  const emptyReason: JourneyViewModel["emptyReason"] =
    resolvedAnchor === 0
      ? "no-anchor"
      : matchedTotal === 0
        ? "no-match"
        : "none";

  const model: JourneyViewModel = {
    columns,
    edges,
    anchorTotal: resolvedAnchor,
    matchedTotal,
    dimTop,
    anchorDims,
    prefixCount,
    leak,
    direction,
    violations: [],
    emptyReason,
  };
  model.violations = verifyModel(model, depth);
  return model;
}

function withoutHiddenDims(
  dims: Map<string, number> | null,
  hidden: ReadonlySet<string>,
): { dims: Map<string, number> | null; value: number } {
  if (!dims) return { dims, value: 0 };
  const next = new Map<string, number>();
  let value = 0;
  for (const [k, v] of dims) {
    if (hidden.has(k)) continue;
    next.set(k, v);
    value += v;
  }
  return { dims: next, value };
}

/** `dimTop` is left intact so legend colors stay stable while values are hidden. */
export function withHiddenJourneyDims(
  model: JourneyViewModel,
  hidden: ReadonlySet<string>,
): JourneyViewModel {
  if (hidden.size === 0) return model;

  const columns = model.columns.map((c) => ({
    ...c,
    nodes: c.nodes
      .map((n) => {
        if (!n.dimParts) return n;
        const { dims, value } = withoutHiddenDims(n.dimParts, hidden);
        return { ...n, dimParts: dims, value };
      })
      .filter((n) => n.value > 0),
  }));
  const edges = model.edges
    .map((e) => {
      if (!e.dims) return e;
      const { dims, value } = withoutHiddenDims(e.dims, hidden);
      return { ...e, dims, value };
    })
    .filter((e) => e.value > 0);
  return {
    ...model,
    columns,
    edges,
    anchorTotal: columns.find((c) => c.anchor)?.nodes[0]?.value ?? 0,
  };
}

export function buildJourneyViewModel({
  rows,
  dataset,
  hasDimension,
}: {
  rows: ProductAnalyticsResultRow[];
  dataset: JourneyDataset;
  hasDimension: boolean;
}): JourneyViewModel {
  return materializeJourneyViewModel({
    dataset,
    history: reduceJourneyHistory({
      rows,
      dataset,
      hasDimension,
    }),
    hasDimension,
  });
}
