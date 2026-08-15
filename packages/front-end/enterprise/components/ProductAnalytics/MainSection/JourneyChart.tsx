import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import type {
  ExplorationConfig,
  JourneyDataset,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  JOURNEY_NONE,
  JOURNEY_OTHER,
  JOURNEY_TERMINALS,
  JOURNEY_OPTIONS_PER_STEP_INCREMENT,
  canIncreaseJourneyOptions,
  journeyDimValueCount,
  journeyOptionsAt,
  withJourneyOptionsAt,
} from "shared/journeys";
import TextUI from "@/ui/Text";
import { CHART_COLORS } from "@/enterprise/components/ProductAnalytics/chart-theme";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  buildJourneyViewModel,
  type JourneyColumn,
  type JourneyEdge,
  type JourneyNode,
  type JourneyViewModel,
} from "./useJourneyModel";

const NODE_W = 13;
const NODE_GAP = 7;
const PAD_T = 34;
const PAD_B = 12;
const ANIM_MS = 320;
const VIEW_MORE_GAP = 18;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function pct(a: number, b: number): string {
  if (b <= 0) return "—";
  const p = (100 * a) / b;
  return `${p.toFixed(p >= 10 ? 0 : 1)}%`;
}

function ribbonPath(
  x0: number,
  y0: number,
  h0: number,
  x1: number,
  y1: number,
  h1: number,
): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${
    y1 + h1
  } C${xm},${y1 + h1} ${xm},${y0 + h0} ${x0},${y0 + h0} Z`;
}

function dimColor(dimTop: string[], v: string): string {
  const i = dimTop.indexOf(v);
  return i >= 0 && i < CHART_COLORS.length ? CHART_COLORS[i] : "var(--gray-8)";
}

function truncateLabel(label: string, pitch: number): string {
  const maxCh = Math.max(6, Math.floor((pitch - NODE_W - 18) / 6.2));
  return label.length > maxCh ? `${label.slice(0, maxCh - 1)}…` : label;
}

type LaidNode = JourneyNode & {
  h: number;
  y: number;
  _out: number;
  _in: number;
};

type Layout = {
  cols: JourneyColumn[];
  edges: JourneyEdge[];
  pitch: number;
};

function animKey(n: JourneyNode): string {
  return JOURNEY_TERMINALS.has(n.key) || n.terminal === true ? n.label : n.key;
}

function colKey(c: JourneyColumn): string {
  return `${c.side}:${c.offset}`;
}

function edgeKey(e: JourneyEdge, cols: JourneyColumn[]): string {
  const A = cols[e.ci];
  const B = cols[e.ci + 1];
  return `${A?.offset ?? e.ci}|${e.from}|${B?.offset ?? e.ci + 1}|${e.to}`;
}

function laid(n: JourneyNode): LaidNode {
  return n as LaidNode;
}

function layoutSignature(L: Layout): string {
  return L.cols
    .map(
      (c) =>
        `${colKey(c)}@${c.x.toFixed(1)}:` +
        c.nodes
          .map((n) => {
            const ln = laid(n);
            return `${animKey(n)}:${ln.y.toFixed(1)}:${ln.h.toFixed(1)}`;
          })
          .join(","),
    )
    .join("|");
}

/** Interpolate geometry only. Labels, values, and topology come from `to`. */
function lerpLayout(from: Layout, to: Layout, t: number): Layout {
  const fromCols = new Map(from.cols.map((c) => [colKey(c), c]));
  const fromEdges = new Map(from.edges.map((e) => [edgeKey(e, from.cols), e]));
  const cols = to.cols.map((toCol) => {
    const fromCol = fromCols.get(colKey(toCol));
    const x = lerp(fromCol?.x ?? toCol.x, toCol.x, t);
    const fromNodes = new Map(
      (fromCol?.nodes ?? []).map((n) => [animKey(n), laid(n)]),
    );
    const nodes = toCol.nodes.map((toN) => {
      const tn = laid(toN);
      const fn = fromNodes.get(animKey(toN));
      return {
        ...toN,
        h: Math.max(0.01, lerp(fn?.h ?? 0, tn.h, t)),
        y: fn ? lerp(fn.y, tn.y, t) : lerp(tn.y + tn.h / 2, tn.y, t),
      };
    });
    return { ...toCol, x, nodes };
  });
  const edges = to.edges.map((toE) => {
    const fe = fromEdges.get(edgeKey(toE, to.cols));
    if (!fe) {
      return {
        ...toE,
        h0: lerp(0, toE.h0, t),
        h1: lerp(0, toE.h1, t),
        y0: lerp(toE.y0 + toE.h0 / 2, toE.y0, t),
        y1: lerp(toE.y1 + toE.h1 / 2, toE.y1, t),
      };
    }
    return {
      ...toE,
      h0: lerp(fe.h0, toE.h0, t),
      h1: lerp(fe.h1, toE.h1, t),
      y0: lerp(fe.y0, toE.y0, t),
      y1: lerp(fe.y1, toE.y1, t),
    };
  });
  return {
    cols,
    edges,
    pitch: lerp(from.pitch, to.pitch, t),
  };
}

function layout(
  m: JourneyViewModel,
  width: number,
  height: number,
  scaleMode: "perStep" | "funnel",
): Layout {
  const perStep = scaleMode === "perStep";
  const cols = m.columns.map((c) => ({
    ...c,
    nodes: c.nodes.map((n) => ({ ...n })),
  }));
  const pitch = cols.length > 1 ? (width - NODE_W) / (cols.length - 1) : 0;
  const maxGaps = Math.max(
    0,
    ...cols.map((c) => Math.max(0, c.nodes.length - 1) * NODE_GAP),
  );
  const availGlobal = height - PAD_T - PAD_B - maxGaps;
  const globalScale = m.anchorTotal > 0 ? availGlobal / m.anchorTotal : 0;

  cols.forEach((c) => {
    c.total = c.nodes.reduce((a, n) => a + n.value, 0);
    const gaps = Math.max(0, c.nodes.length - 1) * NODE_GAP;
    const viewMoreGap =
      c.frontier && c.nodes.some((n) => n.key === JOURNEY_OTHER)
        ? VIEW_MORE_GAP
        : 0;
    let y: number;
    if (perStep) {
      const availC = height - PAD_T - PAD_B - gaps - viewMoreGap;
      c.scale = c.total > 0 ? availC / c.total : 0;
      y = PAD_T;
    } else {
      c.scale = globalScale;
      y =
        PAD_T +
        (availGlobal - c.total * globalScale) / 2 +
        (maxGaps - gaps) / 2;
    }
    for (const n of c.nodes) {
      const ln = n as LaidNode;
      ln.h = Math.max(1.5, n.value * c.scale);
      ln.y = y;
      y += ln.h + NODE_GAP;
      if (n.key === JOURNEY_OTHER && c.frontier) y += VIEW_MORE_GAP;
      ln._out = 0;
      ln._in = 0;
    }
  });

  const find = (col: JourneyColumn, key: string) =>
    col.nodes.find((n) => n.key === key) as LaidNode | undefined;

  const byCol = new Map<number, JourneyEdge[]>();
  for (const e of m.edges) {
    const list = byCol.get(e.ci) ?? [];
    list.push({ ...e });
    byCol.set(e.ci, list);
  }
  const out: JourneyEdge[] = [];
  for (const [ci, list] of byCol) {
    const A = cols[ci];
    const B = cols[ci + 1];
    if (!A || !B) continue;
    const live = list.filter((e) => find(A, e.from) && find(B, e.to));
    live.sort(
      (a, b) =>
        (find(B, a.to)?.y ?? 0) - (find(B, b.to)?.y ?? 0) ||
        (find(A, a.from)?.y ?? 0) - (find(A, b.from)?.y ?? 0),
    );
    for (const e of live) {
      const a = find(A, e.from);
      if (!a) continue;
      e.h0 = e.value * A.scale;
      e.h1 = e.value * B.scale;
      e.y0 = a.y + a._out;
      a._out += e.h0;
    }
    live.sort(
      (a, b) =>
        (find(A, a.from)?.y ?? 0) - (find(A, b.from)?.y ?? 0) ||
        (find(B, a.to)?.y ?? 0) - (find(B, b.to)?.y ?? 0),
    );
    for (const e of live) {
      const b = find(B, e.to);
      if (!b) continue;
      e.y1 = b.y + b._in;
      b._in += e.h1;
    }
    out.push(...live);
  }
  cols.forEach((c, ci) => {
    c.x = ci * pitch;
  });
  return { cols, edges: out, pitch };
}

type TipContent = {
  title: string;
  lines: string[];
  dimRows: { label: string; n: number; color: string }[];
  total: number;
};

type TipApi = {
  show: (args: {
    tooltipData: TipContent;
    tooltipLeft: number;
    tooltipTop: number;
  }) => void;
  hide: () => void;
};

function JourneyTooltip({
  apiRef,
}: {
  apiRef: React.MutableRefObject<TipApi | null>;
}) {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<TipContent>();
  apiRef.current = { show: showTooltip, hide: hideTooltip };
  if (!tooltipOpen || !tooltipData) return null;
  return (
    <TooltipWithBounds
      left={tooltipLeft}
      top={tooltipTop}
      style={{
        ...defaultStyles,
        background: "var(--color-panel-solid)",
        color: "var(--gray-12)",
        border: "1px solid var(--gray-a6)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        maxWidth: 280,
      }}
    >
      <div style={{ fontWeight: 640, marginBottom: 2 }}>
        {tooltipData.title}
      </div>
      {tooltipData.lines.map((line) => (
        <div key={line} style={{ color: "var(--gray-11)" }}>
          {line}
        </div>
      ))}
      {tooltipData.dimRows.map((r) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 3,
          }}
        >
          <span
            style={{
              width: 12,
              height: 2,
              background: r.color,
              flex: "none",
            }}
          />
          <span>{r.label}</span>
          <span
            style={{
              marginLeft: "auto",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmt(r.n)}
          </span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          marginTop: 6,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
        }}
      >
        <span style={{ color: "var(--gray-11)" }}>total</span>
        <span style={{ marginLeft: "auto" }}>{fmt(tooltipData.total)}</span>
      </div>
    </TooltipWithBounds>
  );
}

function SankeySvg({
  model,
  width,
  height,
  scaleMode,
  onCommit,
  onPop,
  onViewMore,
  canViewMore,
}: {
  model: JourneyViewModel;
  width: number;
  height: number;
  scaleMode: "perStep" | "funnel";
  onCommit: (keys: string[]) => void;
  onPop: (index: number) => void;
  onViewMore: (levelIndex: number) => void;
  canViewMore: (levelIndex: number) => boolean;
}) {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const target = useMemo(
    () => layout(model, w, h, scaleMode),
    [model, w, h, scaleMode],
  );
  const [drawn, setDrawn] = useState(target);
  const visualRef = useRef(target);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipApi = useRef<TipApi | null>(null);

  useLayoutEffect(() => {
    const from = visualRef.current;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce || layoutSignature(from) === layoutSignature(target)) {
      visualRef.current = target;
      setDrawn(target);
      return;
    }
    let raf = 0;
    let safety = 0;
    const t0 = performance.now();
    const apply = (t: number) => {
      const next = lerpLayout(from, target, t);
      visualRef.current = next;
      setDrawn(next);
    };
    apply(0);
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ANIM_MS);
      apply(easeOut(t));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else if (safety) {
        window.clearTimeout(safety);
        safety = 0;
      }
    };
    raf = requestAnimationFrame(step);
    safety = window.setTimeout(() => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      apply(1);
      safety = 0;
    }, ANIM_MS + 140);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(safety);
    };
  }, [target]);

  const L = drawn;

  const showTip = (event: React.PointerEvent, content: TipContent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    tipApi.current?.show({
      tooltipData: content,
      tooltipLeft: event.clientX - rect.left,
      tooltipTop: event.clientY - rect.top,
    });
  };
  const hideTooltip = () => tipApi.current?.hide();

  return (
    <Box position="relative">
      <svg
        ref={svgRef}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Sankey of user journeys"
      >
        <Group>
          {L.cols.map((c, ci) => (
            <text
              key={`h-${ci}`}
              x={c.x}
              y={16}
              fontSize={13}
              fontWeight={600}
              fill="var(--gray-12)"
              textAnchor={ci === L.cols.length - 1 ? "end" : "start"}
            >
              {c.anchor
                ? model.direction === "backward"
                  ? "End"
                  : "Start"
                : c.label}
              {c.committed && !c.anchor && c.commitIndex != null ? (
                <tspan
                  dx={5}
                  fill="var(--gray-11)"
                  fontWeight={500}
                  style={{ cursor: "pointer" }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onPop(c.commitIndex as number);
                  }}
                >
                  ×
                </tspan>
              ) : null}
            </text>
          ))}
          {L.edges.map((e, ei) => {
            const A = L.cols[e.ci];
            const B = L.cols[e.ci + 1];
            if (!A || !B) return null;
            const x0 = A.x + NODE_W;
            const x1 = B.x;
            const op = e.leak ? 0.28 : e.committedEdge ? 0.45 : 0.62;
            const parts: {
              y0: number;
              y1: number;
              h0: number;
              h1: number;
              fill: string;
            }[] =
              e.dims && e.dims.size
                ? (() => {
                    const order = model.dimTop
                      .concat([JOURNEY_OTHER])
                      .filter((d) => e.dims?.has(d));
                    const gaps = Math.max(0, order.length - 1) * 2;
                    const usable0 = Math.max(0.5, e.h0 - gaps);
                    const usable1 = Math.max(0.5, e.h1 - gaps);
                    let a0 = e.y0;
                    let a1 = e.y1;
                    return order.map((d) => {
                      const frac = (e.dims?.get(d) ?? 0) / e.value;
                      const part = {
                        y0: a0,
                        y1: a1,
                        h0: usable0 * frac,
                        h1: usable1 * frac,
                        fill: dimColor(model.dimTop, d),
                      };
                      a0 += part.h0 + 2;
                      a1 += part.h1 + 2;
                      return part;
                    });
                  })()
                : [
                    {
                      y0: e.y0,
                      y1: e.y1,
                      h0: e.h0,
                      h1: e.h1,
                      fill: "var(--accent-a8)",
                    },
                  ];
            const commitKeys =
              e.committedEdge ||
              e.leak ||
              (e.tgtKey && JOURNEY_TERMINALS.has(e.tgtKey))
                ? null
                : e.fi === 0
                  ? e.tgtKey
                    ? [e.tgtKey]
                    : null
                  : e.srcKey && !JOURNEY_TERMINALS.has(e.srcKey) && e.tgtKey
                    ? [e.srcKey, e.tgtKey]
                    : null;
            return (
              <g
                key={ei}
                role={commitKeys ? "button" : "img"}
                tabIndex={commitKeys ? 0 : undefined}
                style={{ cursor: commitKeys ? "pointer" : "default" }}
                onPointerEnter={(ev) =>
                  showTip(ev, {
                    title: `${e.from} → ${e.to}`,
                    lines: [
                      `${pct(e.value, model.anchorTotal)} of ${
                        model.direction === "backward"
                          ? "ending step"
                          : "starting step"
                      }`,
                    ],
                    dimRows: model.dimTop
                      .concat([JOURNEY_OTHER])
                      .filter((d) => e.dims?.has(d))
                      .map((d) => ({
                        label: d,
                        n: e.dims?.get(d) ?? 0,
                        color: dimColor(model.dimTop, d),
                      })),
                    total: e.value,
                  })
                }
                onPointerLeave={hideTooltip}
                onClick={() => commitKeys && onCommit(commitKeys)}
                onKeyDown={(ev) => {
                  if (!commitKeys) return;
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onCommit(commitKeys);
                  }
                }}
              >
                {parts.map((p, pi) => (
                  <path
                    key={pi}
                    d={ribbonPath(x0, p.y0, p.h0, x1, p.y1, p.h1)}
                    fill={p.fill}
                    fillOpacity={op}
                  />
                ))}
              </g>
            );
          })}
          {L.cols.map((c, ci) => {
            const lastCol = ci === L.cols.length - 1;
            return c.nodes.map((n) => {
              const ln = n as LaidNode;
              const term = JOURNEY_TERMINALS.has(n.key) || n.terminal === true;
              const fill = c.anchor
                ? "var(--accent-9)"
                : term
                  ? "var(--gray-8)"
                  : c.frontier
                    ? "var(--accent-7)"
                    : "var(--accent-9)";
              const hitH = Math.max(24, ln.h + 4);
              const canCommit = !!c.frontier && !term && c.fi === 0;
              const canPop = !!c.committed && !c.anchor && n.chain === true;
              const lx = lastCol ? c.x - 7 : c.x + NODE_W + 7;
              const anch = lastCol ? "end" : "start";
              return (
                <g key={`${c.offset}-${n.key}`}>
                  <rect
                    x={c.x}
                    y={ln.y}
                    width={NODE_W}
                    height={ln.h}
                    rx={3}
                    fill={fill}
                  />
                  <rect
                    x={c.x - 5}
                    y={ln.y + ln.h / 2 - hitH / 2}
                    width={NODE_W + 10}
                    height={hitH}
                    fill="transparent"
                    role={canCommit || canPop ? "button" : "img"}
                    tabIndex={0}
                    style={{
                      cursor: canCommit || canPop ? "pointer" : "default",
                    }}
                    onPointerEnter={(ev) =>
                      showTip(ev, {
                        title: n.label,
                        lines: [
                          `${pct(n.value, model.anchorTotal)} of ${
                            model.direction === "backward"
                              ? "ending step"
                              : "starting step"
                          }`,
                          ...(scaleMode === "perStep" && c.total
                            ? [
                                `${pct(n.value, c.total)} of this step — what the height shows`,
                              ]
                            : []),
                        ],
                        dimRows: model.dimTop
                          .concat([JOURNEY_OTHER])
                          .filter((d) => n.dimParts?.has(d))
                          .map((d) => ({
                            label: d,
                            n: n.dimParts?.get(d) ?? 0,
                            color: dimColor(model.dimTop, d),
                          })),
                        total: n.value,
                      })
                    }
                    onPointerLeave={hideTooltip}
                    onClick={() => {
                      if (canCommit) onCommit([n.key]);
                      else if (canPop && c.commitIndex != null)
                        onPop(c.commitIndex);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key !== "Enter" && ev.key !== " ") return;
                      ev.preventDefault();
                      if (canCommit) onCommit([n.key]);
                      else if (canPop && c.commitIndex != null)
                        onPop(c.commitIndex);
                    }}
                  />
                  {ln.h >= 13 && (
                    <text
                      x={lx}
                      y={
                        ln.h >= 27
                          ? ln.y + ln.h / 2 - 1
                          : ln.y + Math.min(ln.h / 2 + 3.5, ln.h - 2)
                      }
                      fontSize={11}
                      fill="var(--gray-12)"
                      textAnchor={anch}
                    >
                      {truncateLabel(n.label, L.pitch)}
                    </text>
                  )}
                  {ln.h >= 27 && (
                    <text
                      x={lx}
                      y={ln.y + ln.h / 2 + 11}
                      fontSize={10.5}
                      fill="var(--gray-11)"
                      textAnchor={anch}
                    >
                      {`${fmt(n.value)}  (${pct(n.value, model.anchorTotal)})`}
                    </text>
                  )}
                  {n.key === JOURNEY_OTHER &&
                    c.frontier &&
                    c.optionsLevel != null &&
                    canViewMore(c.optionsLevel) && (
                      <text
                        x={lx}
                        y={ln.y + ln.h + 13}
                        fontSize={11}
                        fill="var(--accent-11)"
                        textAnchor={anch}
                        role="button"
                        tabIndex={0}
                        style={{
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (c.optionsLevel == null) return;
                          onViewMore(c.optionsLevel);
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key !== "Enter" && ev.key !== " ") return;
                          ev.preventDefault();
                          ev.stopPropagation();
                          if (c.optionsLevel == null) return;
                          onViewMore(c.optionsLevel);
                        }}
                      >
                        View more
                      </text>
                    )}
                </g>
              );
            });
          })}
        </Group>
      </svg>
      <JourneyTooltip apiRef={tipApi} />
    </Box>
  );
}

export default function JourneyChart({
  exploration,
  submittedExploreState,
}: {
  exploration: ProductAnalyticsExploration | null;
  submittedExploreState: ExplorationConfig;
  animate?: boolean;
}) {
  const {
    draftExploreState,
    setDraftExploreState,
    commitJourneyStep,
    popJourneyPath,
  } = useExplorerContext();
  const dataset: JourneyDataset | null =
    draftExploreState.dataset?.type === "journey"
      ? draftExploreState.dataset
      : submittedExploreState.dataset.type === "journey"
        ? submittedExploreState.dataset
        : null;
  const submittedPathLength =
    submittedExploreState.dataset.type === "journey"
      ? submittedExploreState.dataset.path.length
      : 0;
  const modelDataset: JourneyDataset | null =
    dataset &&
    submittedExploreState.dataset.type === "journey" &&
    dataset.path.length < submittedPathLength
      ? submittedExploreState.dataset
      : dataset;
  const hasDimension = submittedExploreState.dimensions.length > 0;
  const scaleMode = "perStep";

  const model = useMemo(() => {
    if (!modelDataset) return null;
    const m = buildJourneyViewModel({
      rows: exploration?.result?.rows ?? [],
      dataset: modelDataset,
      submittedPathLength,
      hasDimension,
    });
    if (process.env.NODE_ENV !== "production" && m.violations.length) {
      console.warn("[journeys] INVARIANT VIOLATIONS:", m.violations);
    }
    return m;
  }, [modelDataset, exploration, submittedPathLength, hasDimension]);

  const onCommit = useCallback(
    (keys: string[]) => {
      for (const key of keys) {
        if (
          key === JOURNEY_OTHER ||
          JOURNEY_TERMINALS.has(key) ||
          key === JOURNEY_NONE
        ) {
          continue;
        }
        commitJourneyStep(key);
      }
    },
    [commitJourneyStep],
  );

  const dimValues = journeyDimValueCount(submittedExploreState.dimensions[0]);
  const canViewMore = useCallback(
    (levelIndex: number) => {
      if (!dataset) return false;
      return canIncreaseJourneyOptions({
        optionsPerStep: dataset.optionsPerStep,
        levelIndex,
        depth: dataset.depth,
        pathLength: dataset.path.length,
        dimValues,
      });
    },
    [dataset, dimValues],
  );
  const onViewMore = useCallback(
    (levelIndex: number) => {
      setDraftExploreState((prev) => {
        if (prev.dataset.type !== "journey") return prev;
        const nextValue =
          journeyOptionsAt(prev.dataset.optionsPerStep, levelIndex) +
          JOURNEY_OPTIONS_PER_STEP_INCREMENT;
        return {
          ...prev,
          dataset: {
            ...prev.dataset,
            optionsPerStep: withJourneyOptionsAt(
              prev.dataset.optionsPerStep,
              levelIndex,
              nextValue,
            ),
          },
        } as ExplorationConfig;
      });
    },
    [setDraftExploreState],
  );

  if (!dataset || !model) return null;

  if (model.emptyReason === "no-anchor") {
    return (
      <Flex p="4">
        <TextUI color="text-mid">
          No journeys contain that{" "}
          {dataset.direction === "backward" ? "ending" : "starting"} step under
          the current filters. Widen the date range or drop a filter.
        </TextUI>
      </Flex>
    );
  }
  if (model.emptyReason === "no-match") {
    return (
      <Flex p="4">
        <TextUI color="text-mid">No matching journeys.</TextUI>
      </Flex>
    );
  }

  return (
    <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
      <Box style={{ flex: 1, minHeight: 220, position: "relative" }}>
        <ParentSizeModern>
          {({ width, height }) => {
            if (width < 10 || height < 10) return null;
            return (
              <SankeySvg
                model={model}
                width={width}
                height={Math.max(280, height)}
                scaleMode={scaleMode}
                onCommit={onCommit}
                onPop={popJourneyPath}
                onViewMore={onViewMore}
                canViewMore={canViewMore}
              />
            );
          }}
        </ParentSizeModern>
      </Box>
      {hasDimension && (
        <Flex gap="4" px="3" pb="2" wrap="wrap">
          {model.dimTop.concat([JOURNEY_OTHER]).map((d) => (
            <Flex key={d} align="center" gap="2">
              <Box
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  background: dimColor(model.dimTop, d),
                }}
              />
              <TextUI size="sm">{d}</TextUI>
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
}
