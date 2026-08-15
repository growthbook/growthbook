import { useMemo } from "react";
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
  isJourneyTerminal,
} from "shared/journeys";

const SEP = "\u0001";
const ANCHOR_SRC = "\u0002anchor";
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

export type JourneyViewModel = {
  columns: JourneyColumn[];
  edges: JourneyEdge[];
  anchorTotal: number;
  matchedTotal: number;
  renderDepth: number;
  fetchDepth: number;
  dimTop: string[];
  dimTotals: Map<string, number>;
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

type ProgressRow = {
  depthReached: number;
  outcome: "taken" | "other" | "exit";
  dim: string | null;
  n: number;
};

function addDim(map: Map<string, number>, dim: string | null, n: number) {
  if (!dim) return;
  map.set(dim, (map.get(dim) || 0) + n);
}

function committedLabel(step: JourneyDataset["path"][number]): string {
  if (step.mode === "other") return JOURNEY_OTHER;
  return step.value;
}

function levelMatchesStep(
  value: string | undefined,
  step: JourneyDataset["path"][number],
): boolean {
  if (value == null || value === JOURNEY_NONE) return false;
  if (step.mode === "other") return value === JOURNEY_OTHER;
  return value === step.value;
}

function parseRows(rows: ProductAnalyticsResultRow[]): {
  pathRows: PathRow[];
  progressRows: ProgressRow[];
} {
  const pathRows: PathRow[] = [];
  const progressRows: ProgressRow[] = [];
  for (const row of rows) {
    const j = row.journey;
    if (!j) continue;
    const dim = row.dimensions[0] ?? null;
    if (j.kind === "progress") {
      progressRows.push({
        depthReached: j.depthReached,
        outcome: j.outcome,
        dim,
        n: j.count,
      });
      continue;
    }
    pathRows.push({ levels: j.levels, dim, n: j.count });
  }
  return { pathRows, progressRows };
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
    for (let i = 1; i < cols.length; i++) {
      for (const n of cols[i - 1].nodes) {
        if (JOURNEY_TERMINALS.has(n.key)) continue;
        const kids = m.edges
          .filter(
            (e) => e.side === side && e.fi === cols[i].fi && e.srcKey === n.key,
          )
          .reduce((a, e) => a + e.value, 0);
        if (kids !== n.value) {
          bad.push(
            `${side} lvl${i + 1} ${n.key}: children ${kids} ≠ parent ${n.value}`,
          );
        }
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

export function buildJourneyViewModel({
  rows,
  dataset,
  submittedPathLength,
  hasDimension,
}: {
  rows: ProductAnalyticsResultRow[];
  dataset: JourneyDataset;
  submittedPathLength: number;
  hasDimension: boolean;
}): JourneyViewModel {
  const direction = dataset.direction;
  const side = direction === "forward" ? "f" : "b";
  const fetchDepth = dataset.depth;
  const renderDepth = Math.min(2, fetchDepth);
  const extra = Math.max(0, dataset.path.length - submittedPathLength);
  const viewPath = dataset.path;
  const depth = viewPath.length;
  const term = direction === "forward" ? JOURNEY_EXIT : JOURNEY_ENTRY;
  const anchorLabel = dataset.anchorStepValues
    ? composeStepLabel(dataset.anchorStepValues)
    : direction === "backward"
      ? "ending step"
      : "starting step";

  const { pathRows: allPathRows, progressRows } = parseRows(rows);

  let pathRows = allPathRows;
  const rawPathRows = allPathRows;
  if (extra > 0) {
    const committedExtra = viewPath.slice(submittedPathLength);
    pathRows = allPathRows
      .filter((r) =>
        committedExtra.every((step, i) => levelMatchesStep(r.levels[i], step)),
      )
      .map((r) => ({ ...r, levels: r.levels.slice(extra) }));
  }

  const matchedTotal = pathRows.reduce((a, r) => a + r.n, 0);

  const dimTotals = new Map<string, number>();
  if (hasDimension) {
    for (const r of pathRows) {
      if (r.dim) dimTotals.set(r.dim, (dimTotals.get(r.dim) || 0) + r.n);
    }
  }
  const dimTop = Array.from(dimTotals.entries())
    .filter(([k]) => k !== JOURNEY_OTHER && k !== "other")
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const nodeAgg = new Map<
    string,
    { value: number; dims: Map<string, number> }
  >();
  const edgeAgg = new Map<
    string,
    { value: number; dims: Map<string, number> }
  >();
  const rk = renderDepth;
  for (const r of pathRows) {
    for (let fi = 0; fi < rk; fi++) {
      const v = r.levels[fi];
      if (v === JOURNEY_NONE || v == null) continue;
      const nk = `${side}${SEP}${fi}${SEP}${v}`;
      let na = nodeAgg.get(nk);
      if (!na) {
        na = { value: 0, dims: new Map() };
        nodeAgg.set(nk, na);
      }
      na.value += r.n;
      addDim(na.dims, r.dim, r.n);
      const src = fi === 0 ? ANCHOR_SRC : r.levels[fi - 1];
      if (src === JOURNEY_NONE) continue;
      const ek = `${side}${SEP}${fi}${SEP}${src}${SEP}${v}`;
      let ea = edgeAgg.get(ek);
      if (!ea) {
        ea = { value: 0, dims: new Map() };
        edgeAgg.set(ek, ea);
      }
      ea.value += r.n;
      addDim(ea.dims, r.dim, r.n);
    }
  }

  const prefixCount: number[] = [];
  const prefixDims: Map<string, number>[] = [];
  const leak: JourneyViewModel["leak"] = [];

  const useProgress = extra === 0 && progressRows.length > 0 && depth > 0;
  if (useProgress) {
    for (let d = 0; d <= depth; d++) {
      let c = 0;
      const dm = new Map<string, number>();
      for (const r of progressRows) {
        if (r.depthReached >= d) {
          c += r.n;
          addDim(dm, r.dim, r.n);
        }
      }
      prefixCount.push(c);
      prefixDims.push(dm);
    }
    for (let k = 0; k < depth; k++) {
      let ot = 0;
      let ex = 0;
      const otD = new Map<string, number>();
      const exD = new Map<string, number>();
      for (const r of progressRows) {
        if (r.depthReached !== k) continue;
        if (r.outcome === "exit") {
          ex += r.n;
          addDim(exD, r.dim, r.n);
        } else {
          ot += r.n;
          addDim(otD, r.dim, r.n);
        }
      }
      leak.push({ other: ot, exit: ex, otherDims: otD, exitDims: exD });
    }
  } else {
    if (extra > 0) {
      prefixCount.length = 0;
      prefixDims.length = 0;
      prefixCount.push(rawPathRows.reduce((a, r) => a + r.n, 0));
      const aDims = new Map<string, number>();
      for (const r of rawPathRows) addDim(aDims, r.dim, r.n);
      prefixDims.push(aDims);
      const committedExtra = viewPath.slice(submittedPathLength);
      for (let k = 0; k < extra; k++) {
        const step = viewPath[submittedPathLength + k];
        let taken = 0;
        let ot = 0;
        let ex = 0;
        const takenD = new Map<string, number>();
        const otD = new Map<string, number>();
        const exD = new Map<string, number>();
        for (const r of rawPathRows) {
          const prefixOk = committedExtra
            .slice(0, k)
            .every((s, i) => levelMatchesStep(r.levels[i], s));
          if (!prefixOk) continue;
          const v = r.levels[k];
          if (levelMatchesStep(v, step)) {
            taken += r.n;
            addDim(takenD, r.dim, r.n);
          } else if (v === term || v == null || v === JOURNEY_NONE) {
            ex += r.n;
            addDim(exD, r.dim, r.n);
          } else {
            ot += r.n;
            addDim(otD, r.dim, r.n);
          }
        }
        leak.push({ other: ot, exit: ex, otherDims: otD, exitDims: exD });
        prefixCount.push(taken);
        prefixDims.push(takenD);
      }
    } else {
      prefixCount.push(matchedTotal);
      const aDims = new Map<string, number>();
      for (const r of pathRows) addDim(aDims, r.dim, r.n);
      prefixDims.push(aDims);
    }
  }

  const anchorDims = prefixDims[0] ? new Map(prefixDims[0]) : new Map();
  if (hasDimension && anchorDims.size === 0) {
    for (const r of extra > 0 ? rawPathRows : pathRows) {
      addDim(anchorDims, r.dim, r.n);
    }
  }

  const sideColumns: JourneyColumn[] = [];
  for (let k = 0; k < depth; k++) {
    const lab = committedLabel(viewPath[k]);
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
  for (let fi = 0; fi < rk; fi++) {
    sideColumns.push({
      side,
      committed: false,
      frontier: true,
      fi,
      optionsLevel: depth + fi,
      label: `Step ${depth + fi + 1}`,
      offset: (direction === "forward" ? 1 : -1) * (depth + fi + 1),
      nodes: [],
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

  const rank = (k: string) =>
    k === JOURNEY_OTHER ? 2 : JOURNEY_TERMINALS.has(k) ? 3 : 1;
  for (const col of columns) {
    if (!col.frontier) continue;
    const prefix = `${col.side}${SEP}${col.fi}${SEP}`;
    const nodes: JourneyNode[] = [];
    for (const [key, agg] of nodeAgg) {
      if (!key.startsWith(prefix)) continue;
      const nk = key.slice(prefix.length);
      nodes.push({
        key: nk,
        label: nk,
        value: agg.value,
        dimParts: hasDimension ? agg.dims : null,
      });
    }
    nodes.sort(
      (a, b) =>
        rank(a.key) - rank(b.key) ||
        b.value - a.value ||
        (a.key < b.key ? -1 : 1),
    );
    col.nodes = nodes;
  }

  const edges: JourneyEdge[] = [];
  for (let ci = 0; ci < columns.length - 1; ci++) {
    const A = columns[ci];
    const B = columns[ci + 1];
    const target = A.side === "b" ? A : B;
    const flowsRight = target === B;
    if (!target.frontier) {
      const upstream = target === B ? A : B;
      const up = upstream.nodes[0];
      if (!up) continue;
      for (const n of target.nodes) {
        edges.push({
          ci,
          value: n.value,
          dims: n.dimParts,
          committedEdge: true,
          leak: n.terminal === true,
          from: target === B ? up.key : n.key,
          to: target === B ? n.key : up.key,
          h0: 0,
          h1: 0,
          y0: 0,
          y1: 0,
        });
      }
      continue;
    }
    const prefix = `${target.side}${SEP}${target.fi}${SEP}`;
    for (const [key, agg] of edgeAgg) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length).split(SEP);
      let src = rest[0];
      const tgt = rest[1];
      if (tgt === JOURNEY_NONE) continue;
      const upstreamCol = flowsRight ? A : B;
      if (src === ANCHOR_SRC) src = upstreamCol.nodes[0]?.key ?? src;
      else if (src === JOURNEY_NONE) continue;
      edges.push({
        ci,
        from: flowsRight ? src : tgt,
        to: flowsRight ? tgt : src,
        value: agg.value,
        dims: hasDimension ? agg.dims : null,
        side: target.side === "a" ? undefined : target.side,
        fi: target.fi,
        srcKey: src,
        tgtKey: tgt,
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
    renderDepth: rk,
    fetchDepth,
    dimTop,
    dimTotals,
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

export function facetJourneyModel(
  m: JourneyViewModel,
  dimValue: string,
): JourneyViewModel {
  const total = m.anchorDims.get(dimValue) || 0;
  const nodeValue = (n: JourneyNode) =>
    n.dimParts ? n.dimParts.get(dimValue) || 0 : total;
  return {
    ...m,
    columns: m.columns.map((c) => ({
      ...c,
      nodes: c.nodes
        .map((n) => ({ ...n, value: nodeValue(n) }))
        .filter((n) => n.value > 0),
    })),
    edges: m.edges
      .map((e) => ({
        ...e,
        value: e.dims ? e.dims.get(dimValue) || 0 : total,
      }))
      .filter((e) => e.value > 0),
    anchorTotal: total,
  };
}

export function useJourneyModel({
  rows,
  dataset,
  submittedPathLength,
  hasDimension,
}: {
  rows: ProductAnalyticsResultRow[] | undefined;
  dataset: JourneyDataset | null;
  submittedPathLength: number;
  hasDimension: boolean;
}): JourneyViewModel | null {
  return useMemo(() => {
    if (!dataset) return null;
    return buildJourneyViewModel({
      rows: rows ?? [],
      dataset,
      submittedPathLength,
      hasDimension,
    });
  }, [rows, dataset, submittedPathLength, hasDimension]);
}

export { LEAK_OTHER, LEAK_EXIT, ANCHOR_SRC, isJourneyTerminal, JOURNEY_OTHER };
