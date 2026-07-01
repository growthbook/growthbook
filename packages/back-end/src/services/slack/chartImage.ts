import fs from "fs";
import path from "path";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { logger } from "back-end/src/util/logger";

// Server-side experiment-card rendering for Slack (Phase 2). Pure-WASM pipeline
// — no native binaries (sharp/node-canvas) and no external service, so it works
// in the Docker image and keeps experiment data on-box:
//
//   card model -> satori (JS, flexbox) -> SVG -> @resvg/resvg-wasm -> PNG
//
// Faithful to the GrowthBook "Slack experiment cards" design handoff. Two
// Satori constraints shape the code: (1) no CSS grid, so the results table is
// built from fixed-width flex rows; (2) charts are generated as standalone
// SVG strings embedded as <img> data-URIs. Those embedded SVGs are pure shapes
// (no <text>) so resvg needs no fonts of its own — all text goes through Satori
// and is emitted as vector paths.

// ---------------------------------------------------------------------------
// Assets: fonts (Inter + Roboto Mono) and the GrowthBook logo. All vendored in
// ./assets and copied to dist by the `build:slack-assets` script; resolve from
// src when running via ts/tests (same pattern as agent skills).
// ---------------------------------------------------------------------------

function resolveAssetPath(file: string): string {
  const candidates = [
    path.join(__dirname, "assets", file),
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "services",
      "slack",
      "assets",
      file,
    ),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Slack card asset not found: ${file} (looked in ${candidates.join(", ")})`,
    );
  }
  return found;
}

type FontSpec = { name: string; weight: 400 | 500 | 600; file: string };
const FONT_SPECS: FontSpec[] = [
  { name: "Inter", weight: 400, file: "inter-latin-400-normal.woff" },
  { name: "Inter", weight: 500, file: "inter-latin-500-normal.woff" },
  { name: "Inter", weight: 600, file: "inter-latin-600-normal.woff" },
  {
    name: "Roboto Mono",
    weight: 400,
    file: "roboto-mono-latin-400-normal.woff",
  },
  {
    name: "Roboto Mono",
    weight: 500,
    file: "roboto-mono-latin-500-normal.woff",
  },
];

type LoadedFont = {
  name: string;
  weight: 400 | 500 | 600;
  style: "normal";
  data: Buffer;
};
let loadedFonts: LoadedFont[] | null = null;
function getFonts(): LoadedFont[] {
  if (!loadedFonts) {
    loadedFonts = FONT_SPECS.map((f) => ({
      name: f.name,
      weight: f.weight,
      style: "normal" as const,
      data: fs.readFileSync(resolveAssetPath(f.file)),
    }));
  }
  return loadedFonts;
}

let logoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (!logoDataUri) {
    const svg = fs.readFileSync(resolveAssetPath("gb-logo-color.svg"));
    logoDataUri = `data:image/svg+xml;base64,${svg.toString("base64")}`;
  }
  return logoDataUri;
}
const LOGO_ASPECT = 1749 / 321; // from the asset's viewBox

let wasmReady: Promise<void> | null = null;
function ensureWasmInitialized(): Promise<void> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const wasmPath = path.join(
        path.dirname(require.resolve("@resvg/resvg-wasm")),
        "index_bg.wasm",
      );
      await initWasm(fs.readFileSync(wasmPath));
    })().catch((err) => {
      wasmReady = null;
      throw err;
    });
  }
  return wasmReady;
}

// ---------------------------------------------------------------------------
// Design tokens (light theme). Mirrors reference/colors_and_type.css + the
// prototype's PAL/SOLID/SOFT maps.
// ---------------------------------------------------------------------------

const P = {
  panel: "#FFFFFF",
  bg: "#FAF8FF",
  text: "#1F2D5C",
  muted: "#60646C",
  subtle: "#80838D",
  border: "#DDDEE3",
  borderSub: "#EDEEF0",
  zebra: "#FBFBFD",
  chip: "#F1F2F4",
  st: {
    violet: "#5746AF",
    blue: "#006DCB",
    green: "#00713F",
    red: "#C40006",
    amber: "#AB6400",
    slate: "#60646C",
  },
  vio: {
    pos: "rgba(48,164,108,0.42)",
    neg: "rgba(229,72,77,0.38)",
    zero: "#C1C4CD",
    median: "#1F2D5C",
  },
  ci: { track: "#EDEEF0", neutral: "#C1C4CD", dot: "#1F2D5C" },
};

const SOLID: Record<Hue, string> = {
  violet: "#6E56CF",
  blue: "#3E63DD",
  green: "#30A46C",
  red: "#E5484D",
  amber: "#FFB224",
  slate: "#8B8D98",
};
const SOFT: Record<Hue, string> = {
  violet: "rgba(110,86,207,.10)",
  blue: "rgba(62,99,221,.10)",
  green: "rgba(48,164,108,.12)",
  red: "rgba(229,72,77,.10)",
  amber: "rgba(255,178,36,.16)",
  slate: "rgba(31,45,92,.06)",
};

type Hue = "violet" | "blue" | "green" | "red" | "amber" | "slate";
export type CardState =
  | "started"
  | "running"
  | "winner"
  | "loser"
  | "stopped"
  | "warning";

const HUE: Record<CardState, Hue> = {
  started: "violet",
  running: "blue",
  winner: "green",
  loser: "red",
  stopped: "slate",
  warning: "amber",
};
const BADGE: Record<CardState, string> = {
  started: "Started",
  running: "Running",
  winner: "Significant · Won",
  loser: "Rolled back · Lost",
  stopped: "Stopped · Inconclusive",
  warning: "SRM detected",
};
// Variation number-circle palette (index 0 = control).
const VC = ["#3E63DD", "#12A594", "#F76808", "#E93D82"];

const CARD_WIDTH = 1000;
const RAIL = 6;
const COLS = [30, 150, 84, 84, 74, "flex" as const, 82];
const VIOLIN_DOMAIN: [number, number] = [-20, 20];
const CI_DOMAIN: [number, number] = [-10, 10];

// ---------------------------------------------------------------------------
// Data model (mirrors the prototype's EXPS shape).
// ---------------------------------------------------------------------------

export interface CardGoalRow {
  v: string; // variation name
  i: number; // variation index (number circle)
  ctrl: string;
  vr: string;
  cn?: string;
  vn?: string;
  ctw?: string; // "99.1%"
  chg?: string; // "+6.1%"
  dir?: "up" | "down";
  vio?: { c: number; s: number }; // violin center (lift %) + spread
  ci?: { lo: number; hi: number; pt: number };
  muted?: boolean;
}

export interface CardCiMetric {
  name: string;
  ctrl: string;
  vr: string;
  chg?: string;
  dir?: "up" | "down";
  ci: { lo: number; hi: number; pt: number };
  sig?: boolean;
}

export interface ExperimentCardData {
  state: CardState;
  name: string;
  key: string;
  goal: string;
  variants: string[];
  tags?: string[];
  users?: string;
  days?: string;
  dates?: string;
  ds?: string;
  note?: string;
  rows: CardGoalRow[];
  secondary?: CardCiMetric[];
  guardrail?: CardCiMetric[];
  // started-only
  hypothesis?: string;
  metrics?: { goal: string; secondary: string[]; guardrail: string[] };
  target?: number;
  // warning-only
  srm?: string;
  p?: string;
}

// ---------------------------------------------------------------------------
// Element helpers (Satori "without JSX" object form).
// ---------------------------------------------------------------------------

type El = {
  type: string;
  props: {
    style?: Record<string, unknown>;
    src?: string;
    width?: number;
    height?: number;
    children?: El | string | (El | string | null)[];
  };
};

function el(
  type: string,
  style: Record<string, unknown>,
  children?: El["props"]["children"],
): El {
  return {
    type,
    props: { style, ...(children !== undefined ? { children } : {}) },
  };
}

// A text node. Satori renders a div/span with a string child; we always pass a
// font family + weight so glyphs resolve to the vendored fonts.
function txt(s: string, style: Record<string, unknown>, mono = false): El {
  return el(
    "div",
    {
      display: "flex",
      fontFamily: mono ? "Roboto Mono" : "Inter",
      ...style,
    },
    s,
  );
}

function svgImg(svg: string, width: number, height: number): El {
  return {
    type: "img",
    props: {
      src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      width,
      height,
      style: { display: "flex" },
    },
  };
}

function fmtPct(v: number): string {
  return (v > 0 ? "+" : "") + Math.round(v * 10) / 10 + "%";
}

// ---------------------------------------------------------------------------
// Charts — pure-shape SVG strings (no <text>; labels are drawn in Satori).
// ---------------------------------------------------------------------------

function violinSvg(
  w: number,
  ht: number,
  domain: [number, number],
  vio: { c: number; s: number },
  opts: { ci?: { lo: number; hi: number } } = {},
): string {
  const [dmin, dmax] = domain;
  const axisH = 8;
  const dh = ht - axisH;
  const midY = dh / 2;
  const A = dh * 0.34;
  const xOf = (v: number) => ((v - dmin) / (dmax - dmin)) * w;
  const zeroX = xOf(0);
  const N = 46;

  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const v = dmin + ((dmax - dmin) * i) / N;
    const hh = A * Math.exp(-((v - vio.c) ** 2) / (2 * vio.s * vio.s));
    pts.push([xOf(v), hh]);
  }
  let d = `M ${pts[0]![0]} ${midY - pts[0]![1]}`;
  for (let i = 1; i <= N; i++) d += ` L ${pts[i]![0]} ${midY - pts[i]![1]}`;
  for (let i = N; i >= 0; i--) d += ` L ${pts[i]![0]} ${midY + pts[i]![1]}`;
  d += " Z";

  const cX = xOf(vio.c);
  const parts: string[] = [
    `<clipPath id="cp"><rect x="${zeroX}" y="0" width="${Math.max(0, w - zeroX)}" height="${dh}"/></clipPath>`,
    `<clipPath id="cn"><rect x="0" y="0" width="${zeroX}" height="${dh}"/></clipPath>`,
    `<line x1="${zeroX}" y1="1" x2="${zeroX}" y2="${dh - 1}" stroke="${P.vio.zero}" stroke-width="1" stroke-dasharray="2 2"/>`,
    `<path d="${d}" fill="${P.vio.pos}" clip-path="url(#cp)"/>`,
    `<path d="${d}" fill="${P.vio.neg}" clip-path="url(#cn)"/>`,
  ];
  if (opts.ci) {
    const th = A * 0.72;
    const loX = xOf(opts.ci.lo);
    const hiX = xOf(opts.ci.hi);
    parts.push(
      `<line x1="${loX}" y1="${midY - th}" x2="${loX}" y2="${midY + th}" stroke="${P.vio.median}" stroke-width="1" opacity="0.5"/>`,
      `<line x1="${hiX}" y1="${midY - th}" x2="${hiX}" y2="${midY + th}" stroke="${P.vio.median}" stroke-width="1" opacity="0.5"/>`,
    );
  }
  parts.push(
    `<line x1="${cX}" y1="${midY - A}" x2="${cX}" y2="${midY + A}" stroke="${P.vio.median}" stroke-width="1.5"/>`,
  );
  // Axis baseline + ticks at min / 0 / max (labels rendered in Satori).
  const by = dh + 0.5;
  parts.push(
    `<line x1="0" y1="${by}" x2="${w}" y2="${by}" stroke="${P.vio.zero}" stroke-width="1"/>`,
  );
  for (const t of [dmin, 0, dmax]) {
    const x = xOf(t);
    const zero = t === 0;
    parts.push(
      `<line x1="${x}" y1="${by - 2}" x2="${x}" y2="${by + 2}" stroke="${zero ? P.subtle : P.vio.zero}" stroke-width="${zero ? 1.3 : 1}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">${parts.join("")}</svg>`;
}

function ciPillSvg(
  w: number,
  ht: number,
  domain: [number, number],
  ci: { lo: number; hi: number; pt: number },
  color: string,
): string {
  const [dmin, dmax] = domain;
  const midY = ht / 2;
  const xOf = (v: number) => ((v - dmin) / (dmax - dmin)) * w;
  const zeroX = xOf(0);
  const lo = xOf(ci.lo);
  const hi = xOf(ci.hi);
  const pt = xOf(ci.pt);
  const pillH = 9;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">${[
    `<line x1="0" y1="${midY}" x2="${w}" y2="${midY}" stroke="${P.ci.track}" stroke-width="3" stroke-linecap="round"/>`,
    `<line x1="${zeroX}" y1="2" x2="${zeroX}" y2="${ht - 2}" stroke="${P.vio.zero}" stroke-width="1" stroke-dasharray="2 2"/>`,
    `<rect x="${lo}" y="${midY - pillH / 2}" width="${Math.max(2, hi - lo)}" height="${pillH}" rx="${pillH / 2}" fill="${color}" opacity="0.28"/>`,
    `<line x1="${lo}" y1="${midY - 5}" x2="${lo}" y2="${midY + 5}" stroke="${color}" stroke-width="1.5"/>`,
    `<line x1="${hi}" y1="${midY - 5}" x2="${hi}" y2="${midY + 5}" stroke="${color}" stroke-width="1.5"/>`,
    `<circle cx="${pt}" cy="${midY}" r="4" fill="${color}"/>`,
  ].join("")}</svg>`;
}

function arrowImg(dir: "up" | "down", color: string, size = 9): El {
  const d =
    dir === "up"
      ? `M${size / 2} 0 L${size} ${size} L0 ${size} Z`
      : `M0 0 L${size} 0 L${size / 2} ${size} Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="${d}" fill="${color}"/></svg>`;
  return svgImg(svg, size, size);
}

// ---------------------------------------------------------------------------
// Shared cells / primitives.
// ---------------------------------------------------------------------------

function badge(state: CardState): El {
  const hue = HUE[state];
  return el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 11px",
      borderRadius: 9999,
      backgroundColor: SOFT[hue],
      alignSelf: "flex-start",
    },
    [
      el("div", {
        width: 7,
        height: 7,
        borderRadius: 9999,
        backgroundColor: SOLID[hue],
      }),
      txt(BADGE[state], { fontSize: 12, fontWeight: 600, color: P.st[hue] }),
    ],
  );
}

function vnumCircle(i: number, size = 18): El {
  const c = VC[i] || "#8B8D98";
  return el(
    "div",
    {
      display: "flex",
      width: size,
      height: size,
      borderRadius: 9999,
      border: `1.5px solid ${c}`,
      alignItems: "center",
      justifyContent: "center",
    },
    txt(String(i), {
      fontSize: Math.round(size * 0.55),
      fontWeight: 600,
      color: c,
    }),
  );
}

function chip(label: string): El {
  return txt(label, {
    fontSize: 12,
    fontWeight: 500,
    color: P.muted,
    padding: "4px 10px",
    backgroundColor: P.chip,
    borderRadius: 6,
  });
}

function pctCell(chg: string, dir: "up" | "down", size = 13): El {
  const col = dir === "up" ? P.st.green : P.st.red;
  return el("div", { display: "flex", alignItems: "center", gap: 5 }, [
    arrowImg(dir, col, Math.round(size * 0.62)),
    txt(chg, { fontSize: size, fontWeight: 600, color: col }, true),
  ]);
}

function ctwColor(ctw?: string): string {
  const n = ctw ? parseFloat(ctw) : NaN;
  if (!isNaN(n)) {
    if (n >= 95) return P.st.green;
    if (n <= 5) return P.st.red;
  }
  return P.muted;
}

// A results-table row built from fixed-width flex cells (Satori has no grid).
function gridRow(
  cells: (El | null)[],
  opts: {
    padding?: string;
    borderBottom?: string;
    backgroundColor?: string;
    opacity?: number;
  } = {},
): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: opts.padding ?? "11px 24px",
      ...(opts.borderBottom ? { borderBottom: opts.borderBottom } : {}),
      ...(opts.backgroundColor
        ? { backgroundColor: opts.backgroundColor }
        : {}),
      ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    },
    COLS.map((w, i) => {
      const align =
        i >= 2 && i <= 4 ? "flex-end" : i === 6 ? "flex-end" : "flex-start";
      return el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: align,
          ...(w === "flex" ? { flexGrow: 1 } : { width: w }),
        },
        cells[i] ? [cells[i]] : [],
      );
    }),
  );
}

function colHeader(goalLabel: string): El {
  const labels = [
    "",
    goalLabel,
    "Control",
    "Variation",
    "Chance",
    "Interval",
    "Change",
  ];
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: "7px 24px",
      backgroundColor: P.zebra,
    },
    COLS.map((w, i) => {
      const align = (i >= 2 && i <= 4) || i === 6 ? "flex-end" : "flex-start";
      return el(
        "div",
        {
          display: "flex",
          justifyContent: align,
          ...(w === "flex" ? { flexGrow: 1 } : { width: w }),
        },
        labels[i]
          ? [
              txt(labels[i]!, {
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: P.subtle,
              }),
            ]
          : [],
      );
    }),
  );
}

function goalRowEl(r: CardGoalRow): El {
  const intervalCell = el(
    "div",
    { display: "flex", flexDirection: "column", flexGrow: 1, gap: 2 },
    [
      r.vio
        ? svgImg(
            violinSvg(190, 40, VIOLIN_DOMAIN, r.vio, { ci: r.ci }),
            190,
            40,
          )
        : null,
      // Axis labels (moved out of the SVG so resvg needs no fonts).
      el(
        "div",
        { display: "flex", justifyContent: "space-between", width: 190 },
        [
          txt(
            fmtPct(VIOLIN_DOMAIN[0]),
            { fontSize: 8.5, color: P.subtle },
            true,
          ),
          txt("0", { fontSize: 8.5, color: P.subtle }, true),
          txt(
            fmtPct(VIOLIN_DOMAIN[1]),
            { fontSize: 8.5, color: P.subtle },
            true,
          ),
        ],
      ),
      r.ci
        ? txt(
            `95% CI [${fmtPct(r.ci.lo)}, ${fmtPct(r.ci.hi)}]`,
            {
              fontSize: 9.5,
              color: P.subtle,
              width: 190,
              justifyContent: "center",
            },
            true,
          )
        : null,
    ],
  );

  const vrCell = el(
    "div",
    { display: "flex", flexDirection: "column", alignItems: "flex-end" },
    [
      txt(r.vr, { fontSize: 13, fontWeight: 500, color: P.text }, true),
      r.vn ? txt(r.vn, { fontSize: 10, color: P.subtle }, true) : null,
    ],
  );

  return gridRow(
    [
      vnumCircle(r.i, 18),
      txt(r.v, { fontSize: 13, fontWeight: 500, color: P.text }),
      txt(r.ctrl, { fontSize: 13, fontWeight: 500, color: P.text }, true),
      vrCell,
      txt(
        r.ctw ?? "—",
        { fontSize: 13, fontWeight: 600, color: ctwColor(r.ctw) },
        true,
      ),
      intervalCell,
      r.chg && r.dir
        ? pctCell(r.chg, r.dir, 13)
        : txt("—", { fontSize: 13, color: P.subtle }, true),
    ],
    { borderBottom: `1px solid ${P.borderSub}`, opacity: r.muted ? 0.55 : 1 },
  );
}

function ciRowEl(m: CardCiMetric, color: string): El {
  return gridRow(
    [
      null,
      txt(m.name, { fontSize: 13, fontWeight: 500, color: P.text }),
      txt(m.ctrl, { fontSize: 13, fontWeight: 500, color: P.text }, true),
      txt(m.vr, { fontSize: 13, fontWeight: 500, color: P.text }, true),
      txt(m.sig ? "sig" : "ns", { fontSize: 11, color: P.subtle }, true),
      el("div", { display: "flex", flexGrow: 1 }, [
        svgImg(ciPillSvg(190, 32, CI_DOMAIN, m.ci, color), 190, 32),
      ]),
      m.chg && m.dir
        ? pctCell(m.chg, m.dir, 13)
        : txt("—", { fontSize: 13, color: P.subtle }, true),
    ],
    { borderBottom: `1px solid ${P.borderSub}` },
  );
}

function sectionLabel(t: string): El {
  return txt(t, {
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: P.subtle,
    padding: "10px 24px 4px",
  });
}

// ---------------------------------------------------------------------------
// Card sections.
// ---------------------------------------------------------------------------

function headerEl(exp: ExperimentCardData): El {
  const hue = HUE[exp.state];
  const logoH = 16;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      backgroundColor: SOFT[hue],
      borderBottom: `1px solid ${P.border}`,
      padding: "16px 24px 14px",
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
        },
        [
          el("div", { display: "flex", flexDirection: "column", gap: 9 }, [
            badge(exp.state),
            el(
              "div",
              { display: "flex", flexDirection: "row", alignItems: "baseline" },
              [
                txt(exp.name, {
                  fontSize: 19,
                  fontWeight: 600,
                  color: P.text,
                  letterSpacing: "-0.01em",
                }),
                txt(
                  exp.key,
                  { fontSize: 12, color: P.subtle, marginLeft: 10 },
                  true,
                ),
              ],
            ),
          ]),
          {
            type: "img",
            props: {
              src: getLogoDataUri(),
              width: Math.round(logoH * LOGO_ASPECT),
              height: logoH,
              style: { display: "flex" },
            },
          } as El,
        ],
      ),
      ...(exp.tags && exp.tags.length
        ? [
            el(
              "div",
              { display: "flex", flexDirection: "row", gap: 6, marginTop: 11 },
              exp.tags.map((t) =>
                txt(`#${t}`, {
                  fontSize: 11,
                  fontWeight: 500,
                  color: P.muted,
                  padding: "2px 9px",
                  backgroundColor: P.chip,
                  border: `1px solid ${P.border}`,
                  borderRadius: 4,
                }),
              ),
            ),
          ]
        : []),
    ],
  );
}

function footerEl(items: (string | undefined)[]): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      padding: "12px 24px",
      borderTop: `1px solid ${P.border}`,
      marginTop: "auto",
    },
    items.filter((x): x is string => !!x).map((t) => chip(t)),
  );
}

function standardBody(exp: ExperimentCardData): El {
  const children: (El | null)[] = [
    colHeader(`Goal · ${exp.goal}`),
    ...exp.rows.map(goalRowEl),
  ];
  if (exp.secondary?.length) {
    children.push(sectionLabel("Secondary metrics"));
    for (const m of exp.secondary)
      children.push(ciRowEl(m, m.sig ? SOLID.green : P.ci.neutral));
  }
  if (exp.guardrail?.length) {
    children.push(sectionLabel("Guardrail metrics"));
    for (const m of exp.guardrail) children.push(ciRowEl(m, P.ci.neutral));
  }
  return el(
    "div",
    { display: "flex", flexDirection: "column", flexGrow: 1 },
    children.filter(Boolean) as El[],
  );
}

function startedBody(exp: ExperimentCardData): El {
  const metricCol = (label: string, list: string[], dot: string): El =>
    el("div", { display: "flex", flexDirection: "column", flexGrow: 1 }, [
      txt(
        label,
        {
          fontSize: 10,
          fontWeight: 600,
          color: P.subtle,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom: 9,
        },
        true,
      ),
      el(
        "div",
        { display: "flex", flexDirection: "column", gap: 8 },
        list.map((m) =>
          el(
            "div",
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            },
            [
              el("div", {
                width: 7,
                height: 7,
                borderRadius: 9999,
                backgroundColor: dot,
              }),
              txt(m, { fontSize: 13.5, fontWeight: 500, color: P.text }),
            ],
          ),
        ),
      ),
    ]);

  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      flexGrow: 1,
      padding: "20px 24px",
    },
    [
      el("div", { display: "flex", flexDirection: "column" }, [
        txt(
          "Hypothesis",
          {
            fontSize: 10,
            fontWeight: 600,
            color: P.subtle,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 7,
          },
          true,
        ),
        txt(exp.hypothesis ?? "", {
          fontSize: 15,
          lineHeight: 1.55,
          color: P.text,
        }),
      ]),
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          gap: 22,
          marginTop: 20,
          paddingTop: 20,
          borderTop: `1px solid ${P.borderSub}`,
        },
        [
          metricCol(
            "Goal metric",
            exp.metrics ? [exp.metrics.goal] : [],
            SOLID.violet,
          ),
          metricCol("Secondary", exp.metrics?.secondary ?? [], SOLID.blue),
          metricCol("Guardrails", exp.metrics?.guardrail ?? [], SOLID.slate),
        ],
      ),
    ],
  );
}

function warningBody(exp: ExperimentCardData): El {
  const alert = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path d="M12 3 L22 20 H2 Z" fill="none" stroke="${P.st.amber}" stroke-width="2.2" stroke-linejoin="round"/><line x1="12" y1="10" x2="12" y2="14" stroke="${P.st.amber}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1.1" fill="${P.st.amber}"/></svg>`;
  return el("div", { display: "flex", flexDirection: "column", flexGrow: 1 }, [
    el(
      "div",
      {
        display: "flex",
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
        padding: "12px 24px",
        backgroundColor: SOFT.amber,
        borderBottom: `1px solid ${P.border}`,
      },
      [
        svgImg(alert, 16, 16),
        el(
          "div",
          { display: "flex", flexDirection: "row", alignItems: "center" },
          [
            txt("SRM · ", { fontSize: 13, fontWeight: 600, color: P.st.amber }),
            txt(`${exp.srm ?? ""}  (${exp.p ?? ""})`, {
              fontSize: 13,
              fontWeight: 500,
              color: P.text,
            }),
          ],
        ),
      ],
    ),
    colHeader(`Goal · ${exp.goal}`),
    ...exp.rows.map(goalRowEl),
    ...(exp.note
      ? [
          txt(exp.note, {
            fontSize: 12,
            lineHeight: 1.5,
            color: P.subtle,
            padding: "12px 24px",
          }),
        ]
      : []),
  ]);
}

function buildCard(exp: ExperimentCardData): El {
  const hue = HUE[exp.state];
  let body: El;
  let footerItems: (string | undefined)[];

  if (exp.state === "started") {
    body = startedBody(exp);
    footerItems = [
      exp.variants.join(" · "),
      exp.target ? `Target ~${exp.target.toLocaleString()} users` : undefined,
      exp.dates,
      exp.ds,
    ];
  } else if (exp.state === "warning") {
    body = warningBody(exp);
    footerItems = [
      exp.days,
      exp.users ? `${exp.users} users` : undefined,
      exp.dates,
      exp.ds,
    ];
  } else {
    body = standardBody(exp);
    footerItems = [
      exp.days,
      exp.users ? `${exp.users} users` : undefined,
      exp.dates,
      exp.ds,
      "SRM check: passed",
    ];
  }

  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      width: CARD_WIDTH,
      backgroundColor: P.panel,
      border: `1px solid ${P.border}`,
      borderRadius: 14,
      overflow: "hidden",
    },
    [
      el("div", { display: "flex", width: RAIL, backgroundColor: SOLID[hue] }),
      el("div", { display: "flex", flexDirection: "column", flexGrow: 1 }, [
        headerEl(exp),
        body,
        footerEl(footerItems),
      ]),
    ],
  );
}

// ---------------------------------------------------------------------------
// Render.
// ---------------------------------------------------------------------------

/**
 * Render an experiment card to a PNG buffer. Rendered at 2x width for crisp
 * display in Slack; height auto-fits the content (image-block mode).
 */
export async function renderExperimentCard(
  exp: ExperimentCardData,
): Promise<Buffer> {
  await ensureWasmInitialized();

  const svg = await satori(
    buildCard(exp) as unknown as Parameters<typeof satori>[0],
    {
      width: CARD_WIDTH,
      fonts: getFonts(),
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_WIDTH * 2 },
  });
  return Buffer.from(resvg.render().asPng());
}

/** Sample cards (from the design prototype) for eyeballing each state. */
export function sampleCard(state: CardState = "winner"): ExperimentCardData {
  const secondary: CardCiMetric[] = [
    {
      name: "Revenue per user",
      ctrl: "$12.40",
      vr: "$12.86",
      chg: "+3.1%",
      dir: "up",
      ci: { lo: -0.4, hi: 6.4, pt: 3.1 },
      sig: false,
    },
  ];
  const guardrail: CardCiMetric[] = [
    {
      name: "Page load time",
      ctrl: "842 ms",
      vr: "849 ms",
      chg: "+0.8%",
      dir: "up",
      ci: { lo: -1.0, hi: 2.6, pt: 0.8 },
      sig: false,
    },
  ];

  switch (state) {
    case "started":
      return {
        state,
        name: "Checkout v2 flow",
        key: "checkout-v2-flow",
        goal: "Checkout completion rate",
        variants: ["Control", "Treatment A"],
        tags: ["revenue", "checkout"],
        target: 40000,
        dates: "Jun 28, 2026",
        ds: "Snowflake · Prod",
        hypothesis:
          "A streamlined one-page checkout reduces friction and lifts completion rate without lowering average order value.",
        metrics: {
          goal: "Checkout completion rate",
          secondary: ["Revenue per user", "Add-to-cart rate"],
          guardrail: ["Page load time", "Refund rate"],
        },
        rows: [],
      };
    case "running":
      return {
        state,
        name: "Mobile nav redesign",
        key: "mobile-nav-redesign",
        goal: "Sessions per user",
        variants: ["Control", "Bottom tabs"],
        tags: ["engagement", "mobile"],
        users: "31,200",
        days: "Day 21",
        dates: "Started Jun 9, 2026",
        ds: "Snowflake · Prod",
        rows: [
          {
            v: "Bottom tabs",
            i: 1,
            ctrl: "4.62",
            vr: "4.72",
            cn: "15.4k",
            vn: "15.8k",
            ctw: "78.4%",
            chg: "+2.1%",
            dir: "up",
            vio: { c: 2.1, s: 5.2 },
            ci: { lo: -1.8, hi: 6.1, pt: 2.1 },
          },
        ],
        secondary,
        guardrail,
      };
    case "loser":
      return {
        state,
        name: "Signup CTA copy",
        key: "signup-cta-copy",
        goal: "Signup conversion",
        variants: ["Control", "Start free"],
        tags: ["acquisition", "copy"],
        users: "22,100",
        days: "Day 14 · stopped",
        dates: "May 20 – Jun 3, 2026",
        ds: "Snowflake · Prod",
        rows: [
          {
            v: "Start free",
            i: 1,
            ctrl: "5.10%",
            vr: "5.04%",
            cn: "11.0k",
            vn: "11.1k",
            ctw: "14.0%",
            chg: "-1.2%",
            dir: "down",
            vio: { c: -1.2, s: 3.0 },
            ci: { lo: -4.6, hi: 2.3, pt: -1.2 },
          },
        ],
        secondary,
        guardrail,
      };
    case "stopped":
      return {
        state,
        name: "Pricing page layout",
        key: "pricing-page-layout",
        goal: "Purchase rate",
        variants: ["Control", "Layout B"],
        tags: ["pricing"],
        users: "88,900",
        days: "Day 30 · stopped",
        dates: "May 1 – May 31, 2026",
        ds: "BigQuery · Prod",
        rows: [
          {
            v: "Layout B",
            i: 1,
            ctrl: "2.30%",
            vr: "2.32%",
            cn: "44.5k",
            vn: "44.4k",
            ctw: "63.0%",
            chg: "+0.9%",
            dir: "up",
            vio: { c: 0.9, s: 4.0 },
            ci: { lo: -3.2, hi: 5.1, pt: 0.9 },
          },
        ],
        secondary,
        guardrail,
      };
    case "warning":
      return {
        state,
        name: "Onboarding tour v3",
        key: "onboarding-tour-v3",
        goal: "Activation rate",
        variants: ["Control", "Shorter", "Video-first"],
        tags: ["activation"],
        users: "9,880",
        days: "Day 5",
        dates: "Started Jun 25, 2026",
        ds: "Mixpanel export",
        // Note: the bundled Inter subset is latin-only (no Greek), so we avoid
        // glyphs like "χ²" here — real SRM p-values are formatted on our side.
        srm: "Expected 33 / 33 / 33 · Observed 38 / 34 / 28",
        p: "p < 0.001",
        note: "Sample Ratio Mismatch — traffic is not splitting as configured. Results are unreliable until fixed.",
        rows: [
          {
            v: "Shorter",
            i: 1,
            ctrl: "—",
            vr: "—",
            ctw: "—",
            chg: "+0.4%",
            dir: "up",
            vio: { c: 0.4, s: 6 },
            muted: true,
          },
          {
            v: "Video-first",
            i: 2,
            ctrl: "—",
            vr: "—",
            ctw: "—",
            chg: "-0.9%",
            dir: "down",
            vio: { c: -0.9, s: 6 },
            muted: true,
          },
        ],
      };
    case "winner":
    default:
      return {
        state: "winner",
        name: "Homepage hero test",
        key: "homepage-hero-test",
        goal: "Signup conversion",
        variants: ["Control", "Hero B", "Hero C"],
        tags: ["acquisition"],
        users: "162,400",
        days: "Day 26 · stopped",
        dates: "May 12 – Jun 7, 2026",
        ds: "Snowflake · Prod",
        rows: [
          {
            v: "Hero B",
            i: 1,
            ctrl: "5.10%",
            vr: "5.41%",
            cn: "54.1k",
            vn: "54.3k",
            ctw: "99.1%",
            chg: "+6.1%",
            dir: "up",
            vio: { c: 6.1, s: 2.1 },
            ci: { lo: 3.8, hi: 8.4, pt: 6.1 },
          },
          {
            v: "Hero C",
            i: 2,
            ctrl: "5.10%",
            vr: "5.29%",
            cn: "54.1k",
            vn: "54.0k",
            ctw: "91.0%",
            chg: "+3.8%",
            dir: "up",
            vio: { c: 3.8, s: 2.6 },
            ci: { lo: 0.9, hi: 6.7, pt: 3.8 },
          },
        ],
        secondary,
        guardrail,
      };
  }
}

/** Warm the renderer (font + wasm) at startup rather than on first Slack use. */
export async function warmChartImageRenderer(): Promise<void> {
  try {
    await ensureWasmInitialized();
    getFonts();
    getLogoDataUri();
  } catch (err) {
    logger.warn(err, "Slack chart image renderer failed to warm up");
  }
}
