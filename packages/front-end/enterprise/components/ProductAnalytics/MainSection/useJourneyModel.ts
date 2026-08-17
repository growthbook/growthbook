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
  journeyLevelMatchesStep,
  journeyPathIsPrefix,
} from "shared/journeys";

const LEAK_OTHER = "\u0002other";
const LEAK_EXIT = "\u0002exit";
const LOADING_NODE_KEY = "\u0002loading";

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
  loading?: boolean;
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

type JourneyHistoryLevel = {
  nodes: JourneyNode[];
};

export type JourneyHistory = {
  anchorTotal: number;
  anchorDims: Map<string, number>;
  /** Next-step distribution after path[0..i-1]. Null until observed. */
  levels: Array<JourneyHistoryLevel | null>;
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
  waitingForFrontier: boolean;
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

function rankNode(k: string): number {
  return k === JOURNEY_OTHER ? 2 : JOURNEY_TERMINALS.has(k) ? 3 : 1;
}

function cloneNodes(nodes: JourneyNode[]): JourneyNode[] {
  return nodes.map((n) => ({
    ...n,
    dimParts: n.dimParts ? new Map(n.dimParts) : null,
  }));
}

function cloneHistory(history: JourneyHistory): JourneyHistory {
  return {
    anchorTotal: history.anchorTotal,
    anchorDims: new Map(history.anchorDims),
    levels: history.levels.map((level) =>
      level ? { nodes: cloneNodes(level.nodes) } : null,
    ),
  };
}

function historiesEqual(a: JourneyHistory | null, b: JourneyHistory): boolean {
  if (!a) return false;
  if (a.anchorTotal !== b.anchorTotal) return false;
  if (a.levels.length !== b.levels.length) return false;
  if (a.anchorDims.size !== b.anchorDims.size) return false;
  for (const [k, v] of a.anchorDims) {
    if (b.anchorDims.get(k) !== v) return false;
  }
  for (let i = 0; i < a.levels.length; i++) {
    const la = a.levels[i];
    const lb = b.levels[i];
    if ((la == null) !== (lb == null)) return false;
    if (!la || !lb) continue;
    if (la.nodes.length !== lb.nodes.length) return false;
    for (let n = 0; n < la.nodes.length; n++) {
      if (
        la.nodes[n].key !== lb.nodes[n].key ||
        la.nodes[n].value !== lb.nodes[n].value
      ) {
        return false;
      }
    }
  }
  return true;
}

/** These rows can describe the next-step distribution after `draftPath[0..i-1]`. */
function journeyCanObserveLevel({
  rowPath,
  draftPath,
  lookaheadDepth,
  levelIndex,
}: {
  rowPath: PathStep[];
  draftPath: PathStep[];
  lookaheadDepth: number;
  levelIndex: number;
}): boolean {
  if (!journeyPathIsPrefix(rowPath, draftPath)) return false;
  const extra = levelIndex - rowPath.length;
  return extra >= 0 && extra < lookaheadDepth;
}

function computeLevelFromRows({
  pathRows,
  pathPrefix,
  rowPathLength,
  hasDimension,
}: {
  pathRows: PathRow[];
  pathPrefix: PathStep[];
  rowPathLength: number;
  hasDimension: boolean;
}): JourneyHistoryLevel {
  const extra = pathPrefix.length - rowPathLength;
  const committedExtra = pathPrefix.slice(rowPathLength);
  const filtered =
    extra === 0
      ? pathRows
      : pathRows.filter((r) =>
          committedExtra.every((step, i) =>
            journeyLevelMatchesStep(r.levels[i], step),
          ),
        );
  const nodeAgg = new Map<
    string,
    { value: number; dims: Map<string, number> }
  >();
  for (const r of filtered) {
    const v = r.levels[extra];
    if (v === JOURNEY_NONE || v == null) continue;
    let na = nodeAgg.get(v);
    if (!na) {
      na = { value: 0, dims: new Map() };
      nodeAgg.set(v, na);
    }
    na.value += r.n;
    addDim(na.dims, r.dim, r.n);
  }
  const nodes: JourneyNode[] = [];
  for (const [key, agg] of nodeAgg) {
    nodes.push({
      key,
      label: key,
      value: agg.value,
      dimParts: hasDimension ? agg.dims : null,
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
  level: JourneyHistoryLevel,
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
): JourneyHistoryLevel {
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
): Map<number, JourneyHistoryLevel> {
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
  const levels = new Map<number, JourneyHistoryLevel>();
  for (const [stepIndex, agg] of byStep) {
    levels.set(stepIndex, levelFromAgg(agg, hasDimension));
  }
  return levels;
}

function reduceJourneyHistory({
  previous,
  rows,
  dataset,
  rowPath,
  hasDimension,
}: {
  previous: JourneyHistory | null;
  rows: ProductAnalyticsResultRow[];
  dataset: JourneyDataset;
  rowPath: PathStep[];
  hasDimension: boolean;
}): JourneyHistory {
  const pathRows = parsePathRows(rows);
  const committedLevels = parseCommittedLevels(rows, hasDimension);

  const next: JourneyHistory = previous
    ? cloneHistory(previous)
    : { anchorTotal: 0, anchorDims: new Map(), levels: [] };

  const needed = dataset.path.length + 1;
  if (next.levels.length > needed) next.levels.length = needed;
  while (next.levels.length < needed) next.levels.push(null);

  for (const [stepIndex, level] of committedLevels) {
    if (stepIndex <= dataset.path.length) {
      next.levels[stepIndex] = level;
    }
  }

  for (let i = 0; i <= dataset.path.length; i++) {
    const frozen = i < dataset.path.length && next.levels[i] != null;
    if (frozen) continue;
    if (
      !journeyCanObserveLevel({
        rowPath,
        draftPath: dataset.path,
        lookaheadDepth: dataset.lookaheadDepth,
        levelIndex: i,
      })
    ) {
      continue;
    }
    next.levels[i] = computeLevelFromRows({
      pathRows,
      pathPrefix: dataset.path.slice(0, i),
      rowPathLength: rowPath.length,
      hasDimension,
    });
  }

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
  } else if (next.anchorTotal === 0) {
    next.anchorTotal = pathRows.reduce((a, r) => a + r.n, 0);
    if (hasDimension) {
      for (const r of pathRows) addDim(next.anchorDims, r.dim, r.n);
    }
  }

  if (previous && historiesEqual(previous, next)) return previous;
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

function appendLoadingFrontier(
  model: JourneyViewModel,
  depth: number,
): JourneyViewModel {
  const side = model.direction === "forward" ? "f" : "b";
  const value = model.prefixCount[depth] || model.anchorTotal;
  if (value <= 0) return model;
  const loadingCol: JourneyColumn = {
    side,
    committed: false,
    frontier: true,
    loading: true,
    fi: 0,
    label: "Next steps",
    offset: (model.direction === "forward" ? 1 : -1) * (depth + 1),
    nodes: [
      {
        key: LOADING_NODE_KEY,
        label: "Loading next steps…",
        value,
        dimParts: null,
      },
    ],
    x: 0,
    total: 0,
    scale: 0,
  };
  if (model.direction === "backward") {
    const first = model.columns[0];
    const toKey = first?.nodes[0]?.key;
    if (!first || !toKey) return model;
    return {
      ...model,
      columns: [loadingCol, ...model.columns],
      edges: [
        {
          ci: 0,
          from: LOADING_NODE_KEY,
          to: toKey,
          value,
          dims: null,
          committedEdge: false,
          srcKey: LOADING_NODE_KEY,
          tgtKey: toKey,
          side,
          fi: 0,
          h0: 0,
          h1: 0,
          y0: 0,
          y1: 0,
        },
        ...model.edges.map((e) => ({ ...e, ci: e.ci + 1 })),
      ],
    };
  }
  const last = model.columns[model.columns.length - 1];
  const fromKey = last?.nodes[0]?.key;
  if (!last || !fromKey) return model;
  return {
    ...model,
    columns: [...model.columns, loadingCol],
    edges: [
      ...model.edges,
      {
        ci: model.columns.length - 1,
        from: fromKey,
        to: LOADING_NODE_KEY,
        value,
        dims: null,
        committedEdge: false,
        srcKey: fromKey,
        tgtKey: LOADING_NODE_KEY,
        side,
        fi: 0,
        h0: 0,
        h1: 0,
        y0: 0,
        y1: 0,
      },
    ],
  };
}

function materializeJourneyViewModel({
  dataset,
  history,
  rowPathLength,
  hasDimension,
  frontierLoading,
}: {
  dataset: JourneyDataset;
  history: JourneyHistory;
  rowPathLength: number;
  hasDimension: boolean;
  frontierLoading: boolean;
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
    if (k < rowPathLength) {
      const total = prefixCount[prefixCount.length - 1] ?? history.anchorTotal;
      leak.push({
        other: 0,
        exit: 0,
        otherDims: new Map(),
        exitDims: new Map(),
      });
      prefixCount.push(total);
      prefixDims.push(new Map(prefixDims[prefixDims.length - 1] ?? new Map()));
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
  const waitingForFrontier = frontier == null && history.anchorTotal > 0;

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
      : matchedTotal === 0 && !waitingForFrontier
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
    waitingForFrontier,
  };
  model.violations = verifyModel(model, depth);
  if (frontierLoading && waitingForFrontier) {
    return appendLoadingFrontier(model, depth);
  }
  return model;
}

export function buildJourneyViewState({
  rows,
  dataset,
  rowPath = [],
  hasDimension,
  previousHistory = null,
  frontierLoading = false,
}: {
  rows: ProductAnalyticsResultRow[];
  dataset: JourneyDataset;
  rowPath?: PathStep[];
  hasDimension: boolean;
  previousHistory?: JourneyHistory | null;
  frontierLoading?: boolean;
}): { model: JourneyViewModel; history: JourneyHistory } {
  const history = reduceJourneyHistory({
    previous: previousHistory,
    rows,
    dataset,
    rowPath,
    hasDimension,
  });
  return {
    model: materializeJourneyViewModel({
      dataset,
      history,
      rowPathLength: rowPath.length,
      hasDimension,
      frontierLoading,
    }),
    history,
  };
}

export { LEAK_OTHER, LEAK_EXIT };
