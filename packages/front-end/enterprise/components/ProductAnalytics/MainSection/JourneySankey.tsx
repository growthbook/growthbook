import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box } from "@radix-ui/themes";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { JOURNEY_OTHER, JOURNEY_TERMINALS } from "shared/journeys";
import type { JourneyHeightScale } from "shared/validators";
import { CHART_COLORS } from "@/enterprise/components/ProductAnalytics/chart-theme";
import {
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

export function dimColor(dimTop: string[], v: string): string {
  const i = dimTop.indexOf(v);
  return i >= 0 && i < CHART_COLORS.length ? CHART_COLORS[i] : "var(--gray-8)";
}

const RIBBON_OPACITY = 0.55;
const EXIT_RIBBON_OPACITY = 0.35;
const EXIT_RIBBON_FILL = "var(--gray-8)";
const STEP_BAR_FILL = "var(--accent-9)";

function isExitNode(n: Pick<JourneyNode, "key" | "label">): boolean {
  return JOURNEY_TERMINALS.has(n.key) || JOURNEY_TERMINALS.has(n.label);
}

function edgeTargetsExit(
  e: JourneyEdge,
  left: JourneyColumn,
  right: JourneyColumn,
): boolean {
  const target = left.side === "b" ? left : right;
  const key = target === right ? e.to : e.from;
  const node = target.nodes.find((n) => n.key === key);
  return !!node && isExitNode(node);
}

function ribbonParts(
  e: JourneyEdge,
  dimTop: string[],
  toExit: boolean,
): { y0: number; y1: number; h0: number; h1: number; fill: string }[] {
  if (toExit) {
    return [
      {
        y0: e.y0,
        y1: e.y1,
        h0: e.h0,
        h1: e.h1,
        fill: EXIT_RIBBON_FILL,
      },
    ];
  }
  if (e.dims && e.dims.size) {
    const order = dimTop.concat([JOURNEY_OTHER]).filter((d) => e.dims?.has(d));
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
        fill: dimColor(dimTop, d),
      };
      a0 += part.h0 + 2;
      a1 += part.h1 + 2;
      return part;
    });
  }
  return [
    {
      y0: e.y0,
      y1: e.y1,
      h0: e.h0,
      h1: e.h1,
      fill: "var(--accent-a8)",
    },
  ];
}

function truncateLabel(label: string, pitch: number): string {
  const maxCh = Math.max(6, Math.floor((pitch - NODE_W - 40) / 9.2));
  return label.length > maxCh ? `${label.slice(0, maxCh - 1)}…` : label;
}

function NodeLabel({
  x,
  y,
  h,
  align,
  name,
  count,
  percent,
  pitch,
}: {
  x: number;
  y: number;
  h: number;
  align: "start" | "end";
  name: string;
  count: string;
  percent: string;
  pitch: number;
}) {
  const showStats = h >= 36;
  if (h < 18) return null;
  const label = truncateLabel(name, pitch);
  const stats = `${count}  (${percent})`;
  const contentW = Math.max(
    label.length * 9.2,
    showStats ? stats.length * 6.4 : 0,
  );
  const padX = 8;
  const padY = 5;
  const line2 = 16;
  const contentH = showStats ? 16 + line2 : 16;
  const plateW = contentW + padX * 2;
  const plateH = contentH + padY * 2;
  const plateX = align === "end" ? x - plateW + padX : x - padX;
  const plateY = y + h / 2 - plateH / 2;
  const nameBaseline = plateY + padY + 13;
  return (
    <g pointerEvents="none">
      <rect
        x={plateX}
        y={plateY}
        width={plateW}
        height={plateH}
        rx={3}
        fill="var(--color-panel-solid)"
        fillOpacity={0.4}
        stroke="var(--gray-a4)"
        strokeWidth={1}
      />
      <text
        x={x}
        y={nameBaseline}
        fontSize={16}
        fontWeight={600}
        fill="var(--gray-12)"
        textAnchor={align}
      >
        {label}
      </text>
      {showStats ? (
        <text
          x={x}
          y={nameBaseline + line2}
          fontSize={11}
          fill="var(--gray-11)"
          textAnchor={align}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <tspan>{count}</tspan>
          <tspan fill="var(--gray-10)">{`  (${percent})`}</tspan>
        </text>
      ) : null}
    </g>
  );
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

function dimSig(dims: Map<string, number> | null): string {
  if (!dims?.size) return "";
  return Array.from(dims, ([k, v]) => `${k}:${v.toFixed(1)}`).join(",");
}

function layoutSignature(L: Layout): string {
  return (
    L.cols
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
      .join("|") +
    "#" +
    L.edges.map((e) => `${edgeKey(e, L.cols)}:${dimSig(e.dims)}`).join(";")
  );
}

function lerpDimMap(
  from: Map<string, number> | null,
  to: Map<string, number> | null,
  t: number,
): Map<string, number> | null {
  if (!from && !to) return null;
  const keys = new Set<string>();
  if (from) for (const k of from.keys()) keys.add(k);
  if (to) for (const k of to.keys()) keys.add(k);
  const next = new Map<string, number>();
  for (const k of keys) {
    const v = lerp(from?.get(k) ?? 0, to?.get(k) ?? 0, t);
    if (v > 0) next.set(k, v);
  }
  return next.size ? next : null;
}

/** Interpolate geometry and dimension shares. Labels and topology come from `to`. */
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
      value: lerp(fe.value, toE.value, t),
      dims: lerpDimMap(fe.dims, toE.dims, t),
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

function columnFillScale(
  total: number,
  nodeCount: number,
  height: number,
): number {
  const gaps = Math.max(0, nodeCount - 1) * NODE_GAP;
  const availC = height - PAD_T - PAD_B - gaps;
  return total > 0 ? availC / total : 0;
}

/** Relative: each column fills the height. Absolute: one scale for the whole
 *  journey so later steps shrink as users exit. */
function layout(
  m: JourneyViewModel,
  width: number,
  height: number,
  heightScale: JourneyHeightScale,
): Layout {
  const cols = m.columns.map((c) => ({
    ...c,
    nodes: c.nodes.map((n) => ({ ...n })),
  }));
  const pitch = cols.length > 1 ? (width - NODE_W) / (cols.length - 1) : 0;
  const totals = cols.map((c) => c.nodes.reduce((a, n) => a + n.value, 0));
  let sharedScale = 0;
  if (heightScale === "absolute") {
    let min = Infinity;
    cols.forEach((c, i) => {
      const s = columnFillScale(totals[i], c.nodes.length, height);
      if (s > 0 && s < min) min = s;
    });
    sharedScale = min === Infinity ? 0 : min;
  }
  cols.forEach((c, i) => {
    c.total = totals[i];
    c.scale =
      heightScale === "absolute"
        ? sharedScale
        : columnFillScale(c.total, c.nodes.length, height);
    let y = PAD_T;
    for (const n of c.nodes) {
      const ln = n as LaidNode;
      ln.h = Math.max(1.5, n.value * c.scale);
      ln.y = y;
      y += ln.h + NODE_GAP;
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
  heightScale,
  onCommit,
  onPop,
  onViewMore,
  canViewMore,
  viewMoreLoading,
  canCommitStep,
}: {
  model: JourneyViewModel;
  width: number;
  height: number;
  heightScale: JourneyHeightScale;
  onCommit: (keys: string[]) => void;
  onPop: (index: number) => void;
  onViewMore: (levelIndex: number) => void;
  canViewMore: (levelIndex: number) => boolean;
  viewMoreLoading: (levelIndex: number) => boolean;
  canCommitStep: boolean;
}) {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = useMemo(
    () => layout(model, w, h, heightScale),
    [model, w, h, heightScale],
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
          {L.cols.map((c, ci) => {
            const commitIndex = c.commitIndex;
            const canPop = c.committed && !c.anchor && commitIndex != null;
            return (
              <text
                key={`h-${ci}`}
                x={c.x}
                y={16}
                fontSize={13}
                fontWeight={600}
                fill="var(--gray-12)"
                textAnchor={ci === L.cols.length - 1 ? "end" : "start"}
                role={canPop ? "button" : undefined}
                tabIndex={canPop ? 0 : undefined}
                aria-label={canPop ? `Return to ${c.label}` : undefined}
                style={{ cursor: canPop ? "pointer" : "default" }}
                onClick={
                  !canPop || commitIndex == null
                    ? undefined
                    : () => onPop(commitIndex)
                }
                onKeyDown={
                  !canPop || commitIndex == null
                    ? undefined
                    : (ev) => {
                        if (ev.key !== "Enter" && ev.key !== " ") return;
                        ev.preventDefault();
                        onPop(commitIndex);
                      }
                }
              >
                {c.anchor
                  ? model.direction === "backward"
                    ? "End"
                    : "Start"
                  : c.label}
              </text>
            );
          })}
          {L.edges.map((e, ei) => {
            const A = L.cols[e.ci];
            const B = L.cols[e.ci + 1];
            if (!A || !B) return null;
            const x0 = A.x + NODE_W;
            const x1 = B.x;
            const toExit = edgeTargetsExit(e, A, B);
            const op = toExit ? EXIT_RIBBON_OPACITY : RIBBON_OPACITY;
            const parts = ribbonParts(e, model.dimTop, toExit);
            const targetCol = A.side === "b" ? A : B;
            const popIndex =
              e.committedEdge &&
              !e.leak &&
              targetCol.committed &&
              !targetCol.anchor &&
              targetCol.commitIndex != null
                ? targetCol.commitIndex
                : null;
            const frontierKey = targetCol === B ? e.tgtKey : e.srcKey;
            const optionsLevel = targetCol.optionsLevel;
            const expandsOther =
              targetCol.frontier &&
              frontierKey === JOURNEY_OTHER &&
              optionsLevel != null &&
              canViewMore(optionsLevel) &&
              !viewMoreLoading(optionsLevel);
            const commitKeys =
              e.committedEdge ||
              e.leak ||
              !canCommitStep ||
              !frontierKey ||
              frontierKey === JOURNEY_OTHER ||
              JOURNEY_TERMINALS.has(frontierKey)
                ? null
                : [frontierKey];
            const clickable = expandsOther || !!commitKeys || popIndex != null;
            return (
              <g
                key={ei}
                role={clickable ? "button" : "img"}
                tabIndex={clickable ? 0 : undefined}
                aria-label={
                  expandsOther
                    ? "Show more paths"
                    : commitKeys
                      ? `Drill into ${frontierKey}`
                      : popIndex != null
                        ? `Return to ${targetCol.label}`
                        : undefined
                }
                style={{ cursor: clickable ? "pointer" : "default" }}
                onPointerEnter={(ev) => {
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
                  });
                }}
                onPointerLeave={hideTooltip}
                onClick={() => {
                  if (expandsOther && optionsLevel != null) {
                    onViewMore(optionsLevel);
                  } else if (commitKeys) onCommit(commitKeys);
                  else if (popIndex != null) onPop(popIndex);
                }}
                onKeyDown={(ev) => {
                  if (!clickable) return;
                  if (ev.key !== "Enter" && ev.key !== " ") return;
                  ev.preventDefault();
                  if (expandsOther && optionsLevel != null) {
                    onViewMore(optionsLevel);
                  } else if (commitKeys) onCommit(commitKeys);
                  else if (popIndex != null) onPop(popIndex);
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
              const term = isExitNode(n) || n.terminal === true;
              const fill = term ? EXIT_RIBBON_FILL : STEP_BAR_FILL;
              const hitH = Math.max(24, ln.h + 4);
              const lx = lastCol ? c.x - 7 : c.x + NODE_W + 7;
              const anch = lastCol ? "end" : "start";
              const moreLoading =
                c.optionsLevel != null && viewMoreLoading(c.optionsLevel);
              const canExpandOther =
                n.key === JOURNEY_OTHER &&
                !!c.frontier &&
                c.optionsLevel != null &&
                canViewMore(c.optionsLevel) &&
                !moreLoading;
              const canCommit =
                canCommitStep &&
                !!c.frontier &&
                !term &&
                n.key !== JOURNEY_OTHER &&
                c.fi === 0;
              const canPop =
                n.chain === true &&
                c.committed &&
                !c.anchor &&
                c.commitIndex != null;
              const clickable = canCommit || canExpandOther || canPop;
              return (
                <g key={`${c.offset}-${n.key}`}>
                  <rect
                    x={c.x}
                    y={ln.y}
                    width={NODE_W}
                    height={ln.h}
                    rx={3}
                    fill={fill}
                  >
                    {n.key === JOURNEY_OTHER && moreLoading && !reduceMotion ? (
                      <animate
                        attributeName="opacity"
                        values="0.45;0.9;0.45"
                        dur="1.4s"
                        repeatCount="indefinite"
                      />
                    ) : null}
                  </rect>
                  <rect
                    x={c.x - 5}
                    y={ln.y + ln.h / 2 - hitH / 2}
                    width={NODE_W + 10}
                    height={hitH}
                    fill="transparent"
                    role={clickable ? "button" : "img"}
                    tabIndex={clickable ? 0 : undefined}
                    aria-label={
                      canExpandOther
                        ? "Show more paths"
                        : canCommit
                          ? `Drill into ${n.label}`
                          : canPop
                            ? `Return to ${n.label}`
                            : undefined
                    }
                    aria-busy={
                      n.key === JOURNEY_OTHER ? moreLoading : undefined
                    }
                    style={{
                      cursor: clickable ? "pointer" : "default",
                    }}
                    onPointerEnter={(ev) => {
                      showTip(ev, {
                        title: n.label,
                        lines: [
                          `${pct(n.value, model.anchorTotal)} of ${
                            model.direction === "backward"
                              ? "ending step"
                              : "starting step"
                          }`,
                          ...(c.total && heightScale === "relative"
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
                      });
                    }}
                    onPointerLeave={hideTooltip}
                    onClick={() => {
                      if (canExpandOther && c.optionsLevel != null) {
                        onViewMore(c.optionsLevel);
                      } else if (canCommit) {
                        onCommit([n.key]);
                      } else if (canPop && c.commitIndex != null) {
                        onPop(c.commitIndex);
                      }
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key !== "Enter" && ev.key !== " ") return;
                      ev.preventDefault();
                      if (canExpandOther && c.optionsLevel != null) {
                        onViewMore(c.optionsLevel);
                      } else if (canCommit) {
                        onCommit([n.key]);
                      } else if (canPop && c.commitIndex != null) {
                        onPop(c.commitIndex);
                      }
                    }}
                  />
                  <NodeLabel
                    x={lx}
                    y={ln.y}
                    h={ln.h}
                    align={anch}
                    name={n.label}
                    count={fmt(n.value)}
                    percent={pct(n.value, model.anchorTotal)}
                    pitch={L.pitch}
                  />
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

export default function JourneySankey({
  model,
  heightScale,
  onCommit,
  onPop,
  onViewMore,
  canViewMore,
  viewMoreLoading,
  canCommitStep,
}: {
  model: JourneyViewModel;
  heightScale: JourneyHeightScale;
  onCommit: (keys: string[]) => void;
  onPop: (index: number) => void;
  onViewMore: (levelIndex: number) => void;
  canViewMore: (levelIndex: number) => boolean;
  viewMoreLoading: (levelIndex: number) => boolean;
  canCommitStep: boolean;
}) {
  return (
    <ParentSizeModern>
      {({ width, height }) => {
        if (width < 10 || height < 10) return null;
        return (
          <SankeySvg
            model={model}
            width={width}
            height={Math.max(280, height)}
            heightScale={heightScale}
            onCommit={onCommit}
            onPop={onPop}
            onViewMore={onViewMore}
            canViewMore={canViewMore}
            viewMoreLoading={viewMoreLoading}
            canCommitStep={canCommitStep}
          />
        );
      }}
    </ParentSizeModern>
  );
}
