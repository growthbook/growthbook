import fs from "fs";
import path from "path";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { logger } from "back-end/src/util/logger";

// Server-side experiment-card rendering for Slack. Pure-WASM pipeline (no native
// binaries, no external service) so it runs in the Docker image and keeps data
// on-box:
//
//   card model -> satori (JS, flexbox) -> SVG -> @resvg/resvg-wasm -> PNG
//
// Two Satori constraints shape the code: no CSS grid (the results table is
// fixed-width flex rows), and charts are standalone SVG strings embedded as
// <img> data-URIs. Those SVGs are pure shapes (no <text>) so resvg needs no
// fonts — all text goes through Satori and is emitted as vector paths.

// Assets: fonts (Inter + Roboto Mono) + logo, vendored in ./assets and copied to
// dist by `build:slack-assets`; resolve from src when running via ts/tests.

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
    const svg = fs.readFileSync(resolveAssetPath("gb-logo-brand.svg"));
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

// Design tokens (light theme). Mirrors reference/colors_and_type.css + the
// prototype's PAL/SOLID/SOFT maps.

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
// Soft tag badges (bg / text), cycled by index — GrowthBook's tag treatment.
const TAG_COLORS: { bg: string; fg: string }[] = [
  { bg: "#ECEAFB", fg: "#5746AF" }, // violet
  { bg: "#E5F1FF", fg: "#0A4A9E" }, // blue
  { bg: "#E3F5F1", fg: "#0A6E62" }, // teal
  { bg: "#FCEEE6", fg: "#944100" }, // orange
];

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
// Narrower + taller than the detailed card so the aspect ratio isn't extreme —
// Slack center-crops very wide/short image previews. The min-height keeps short
// cards from being wide-and-short (hero centers in the leftover space); taller
// ones just grow.
const COMPACT_WIDTH = 560;
const COMPACT_MIN_HEIGHT = 240;
const RAIL = 6;
const COLS = [30, 150, 84, 84, 74, "flex" as const, 82];
const VIOLIN_DOMAIN: [number, number] = [-20, 20];
const CI_DOMAIN: [number, number] = [-10, 10];
// The violin / CI chart spans this width; the flex interval column is wider, so
// the extra room sits to its right. Left padding separates it from Chance.
const INTERVAL_W = 320;
const INTERVAL_PAD_LEFT = 28;

// Data model (mirrors the prototype's EXPS shape).

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
  // Shown above the conclusion for non-started states; and in the started body.
  hypothesis?: string;
  // Completed experiments (won / lost / stopped) with a written analysis.
  conclusion?: { text: string };
  // Orthogonal to state — an experiment can be Running or Won and still be
  // flagged unhealthy. Renders a red banner under the header when unhealthy.
  health?: { status: "healthy" | "unhealthy"; issues: [string, string][] };
  metrics?: { goal: string; secondary: string[]; guardrail: string[] };
  target?: number;
  srm?: string;
  p?: string;
  // The notification *event* the compact card announces (distinct from
  // `state`/status). When unset, the compact card derives it from state.
  event?: CompactEvent;
  daysToPower?: number; // "started" compact hero: est. days to reach power
  compactLine?: string; // one-line conclusion fallback for outcome events
  winningVariation?: string; // "won" state: the variation that was shipped
  winningVariationIndex?: number; // its 0-based variation index (control = 0)
}

// A compact notification announces an EVENT (distinct from the experiment's
// status). started/significance fire while Running; won/lost/stopped once
// Stopped; warning is a health alert.
export type CompactEvent =
  | "started"
  | "significance"
  | "won"
  | "lost"
  | "stopped"
  | "warning"
  | "decisionShip"
  | "decisionRollback";

// Element helpers (Satori "without JSX" object form).

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

// A text node. We always pass a font family so glyphs resolve to the vendored
// fonts.
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

// Lightweight markdown for user-authored prose (hypothesis / conclusion), which
// comes from GrowthBook's markdown editor. Satori has no markdown support and
// only the vendored font weights (Inter 400/500/600, no 700/italic), so we parse
// a safe subset into styled runs: bold -> 600, inline code -> mono, links ->
// label, bullets -> real bullets, italic -> plain (no italic font). Not a full
// parser — just the marks common in short write-ups.

type MdRun = { text: string; bold?: boolean; code?: boolean };
type MdBlock = { type: "p" | "li"; runs: MdRun[] };

function parseInlineMd(input: string): MdRun[] {
  // Drop link URLs, keep the label (not clickable in an image).
  const s = input.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const runs: MdRun[] = [];
  // Bold, `code`, then italic unwrapped to plain. The italic branch is
  // boundary-guarded so it doesn't fire inside snake_case identifiers.
  const re =
    /(\*\*|__)(.+?)\1|`([^`]+)`|(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\4(?![\w*])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) runs.push({ text: m[3], code: true });
    else if (m[5] !== undefined) runs.push({ text: m[5] });
    last = re.lastIndex;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.filter((r) => r.text.length > 0);
}

function parseMarkdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "p", runs: parseInlineMd(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (bullet) {
      flush();
      blocks.push({ type: "li", runs: parseInlineMd(bullet[1]!) });
    } else if (heading) {
      flush();
      // Render a heading as a bold paragraph (no distinct heading sizes here).
      blocks.push({ type: "p", runs: [{ text: heading[1]!, bold: true }] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

interface MdStyle {
  fontSize: number;
  color: string;
  weight: 400 | 500 | 600;
  lineHeight: number;
  letterSpacing?: string;
}

// Hypothesis + conclusion prose share one style (same size/color) so they read
// as equally important; each block's label + tint provides the differentiation.
const PROSE_STYLE: MdStyle = {
  fontSize: 13,
  color: P.text,
  weight: 400,
  lineHeight: 1.5,
};

function runSpan(r: MdRun, base: MdStyle): El {
  return txt(
    r.text,
    {
      fontSize: r.code ? base.fontSize - 0.5 : base.fontSize,
      lineHeight: base.lineHeight,
      color: r.code ? P.st.slate : base.color,
      fontWeight: r.bold ? 600 : base.weight,
      // Preserve run-boundary spaces — Satori trims each flex child's edge
      // whitespace, gluing adjacent runs together otherwise.
      whiteSpace: "pre-wrap",
      ...(base.letterSpacing ? { letterSpacing: base.letterSpacing } : {}),
      ...(r.code
        ? {
            backgroundColor: P.chip,
            borderRadius: 3,
            padding: "0 4px",
          }
        : {}),
    },
    r.code,
  );
}

// Render markdown into a stacked block layout. Paragraphs and list items are
// `flexWrap` rows of styled runs so text still wraps within the card.
function renderMarkdown(md: string, base: MdStyle): El {
  const blocks = parseMarkdownBlocks(md);
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: 6 },
    blocks.map((b) => {
      const runsRow = el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "baseline",
        },
        b.runs.map((r) => runSpan(r, base)),
      );
      if (b.type === "li") {
        return el(
          "div",
          {
            display: "flex",
            flexDirection: "row",
            gap: 8,
            alignItems: "flex-start",
          },
          [
            el("div", {
              width: 5,
              height: 5,
              borderRadius: 9999,
              backgroundColor: base.color,
              marginTop: base.fontSize * 0.5,
              flexShrink: 0,
            }),
            runsRow,
          ],
        );
      }
      return runsRow;
    }),
  );
}

function fmtPct(v: number): string {
  return (v > 0 ? "+" : "") + Math.round(v * 10) / 10 + "%";
}

// Charts — pure-shape SVG strings (no <text>; labels are drawn in Satori).

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
          ...(w === "flex"
            ? { flexGrow: 1, paddingLeft: INTERVAL_PAD_LEFT }
            : { width: w }),
        },
        cells[i] ? [cells[i]] : [],
      );
    }),
  );
}

// The metric's display name on its own line, above the column header (the name
// is intentionally NOT in the column header, per the design handoff).
function metricNameEl(name: string): El {
  return txt(name, {
    fontSize: 14,
    fontWeight: 500,
    color: P.text,
    padding: "0 24px 9px",
  });
}

function colHeader(): El {
  // Number-circle and Interval cells are intentionally label-less ("Interval"
  // was dropped from the header per product feedback).
  const labels = ["", "", "Control", "Variation", "Chance", "", "Change"];
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

// `label` overrides the row's variation name: 2-way tests label the single
// treatment row with the goal metric name and drop the number circle, mirroring
// secondary / guardrail rows.
function goalRowEl(r: CardGoalRow, label?: string): El {
  const intervalCell = el(
    "div",
    { display: "flex", flexDirection: "column", flexGrow: 1, gap: 2 },
    [
      r.vio
        ? svgImg(
            violinSvg(INTERVAL_W, 40, VIOLIN_DOMAIN, r.vio, { ci: r.ci }),
            INTERVAL_W,
            40,
          )
        : null,
      // Axis labels (moved out of the SVG so resvg needs no fonts).
      el(
        "div",
        { display: "flex", justifyContent: "space-between", width: INTERVAL_W },
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
              width: INTERVAL_W,
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
      label ? null : vnumCircle(r.i, 18),
      txt(label ?? r.v, { fontSize: 13, fontWeight: 500, color: P.text }),
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
        svgImg(
          ciPillSvg(INTERVAL_W, 32, CI_DOMAIN, m.ci, color),
          INTERVAL_W,
          32,
        ),
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

// Soft tag badges (no leading '#'), colors cycled from TAG_COLORS.
function tagBadges(tags: string[]): El[] {
  return tags.map((t, i) => {
    const c = TAG_COLORS[i % TAG_COLORS.length]!;
    return txt(t, {
      fontSize: 11,
      fontWeight: 500,
      color: c.fg,
      backgroundColor: c.bg,
      padding: "2px 9px",
      borderRadius: 3,
    });
  });
}

// Single-row header, no background tint (the left rail + badge carry status):
// name · key · badge on the left, tags + logo on the right.
function headerEl(exp: ExperimentCardData): El {
  const logoH = 15;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 16,
      padding: "14px 24px",
      borderBottom: `1px solid ${P.border}`,
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        },
        [
          txt(exp.name, {
            fontSize: 17,
            fontWeight: 600,
            color: P.text,
            letterSpacing: "-0.01em",
          }),
          txt(exp.key, { fontSize: 12, color: P.subtle }, true),
          badge(exp.state),
        ],
      ),
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        },
        [
          ...(exp.tags?.length ? tagBadges(exp.tags) : []),
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
    ],
  );
}

// Plain-text metadata footer, items joined by a middot separator (not chips).
function footerEl(items: (string | undefined)[]): El {
  const fitems = items.filter((x): x is string => !!x);
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      padding: "11px 24px",
      borderTop: `1px solid ${P.border}`,
      marginTop: "auto",
    },
    fitems.map((t, i) =>
      el(
        "div",
        { display: "flex", flexDirection: "row", alignItems: "center" },
        [
          i > 0
            ? txt("·", {
                fontSize: 11.5,
                color: P.subtle,
                margin: "0 9px",
                opacity: 0.55,
              })
            : null,
          txt(t, { fontSize: 11.5, color: P.subtle }),
        ].filter(Boolean) as El[],
      ),
    ),
  );
}

// The goal-metric section. A 2-way test labels its single row with the goal
// metric name (dropping the metric-name line + number circle). Multi-way tests
// keep the metric name up top and one numbered row per variation.
function goalSectionEls(exp: ExperimentCardData): (El | null)[] {
  const twoWay = exp.rows.length === 1;
  return [
    sectionLabel("Goal metric"),
    twoWay ? null : metricNameEl(exp.goal),
    colHeader(),
    ...exp.rows.map((r) => goalRowEl(r, twoWay ? exp.goal : undefined)),
  ];
}

function standardBody(exp: ExperimentCardData): El {
  const children: (El | null)[] = [...goalSectionEls(exp)];
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
        renderMarkdown(exp.hypothesis ?? "", {
          fontSize: 15,
          lineHeight: 1.55,
          color: P.text,
          weight: 400,
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
    ...goalSectionEls(exp),
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

function triAlertSvg(color: string, size = 18): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M12 3 L22 20 H2 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><line x1="12" y1="9.5" x2="12" y2="14.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.2" fill="${color}"/></svg>`;
}

// Health is orthogonal to status — an unhealthy experiment gets a red banner
// under the header regardless of whether it's Running, Won, etc.
function healthBannerEl(exp: ExperimentCardData): El | null {
  if (!exp.health || exp.health.status !== "unhealthy") return null;
  const col = P.st.red;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      gap: 12,
      alignItems: "flex-start",
      padding: "13px 24px",
      backgroundColor: SOFT.red,
      borderBottom: `1px solid ${P.border}`,
    },
    [
      svgImg(triAlertSvg(col, 18), 18, 18),
      el(
        "div",
        { display: "flex", flexDirection: "column", flexGrow: 1, gap: 6 },
        [
          txt("Health · Needs attention", {
            fontSize: 12.5,
            fontWeight: 700,
            color: col,
          }),
          el(
            "div",
            { display: "flex", flexDirection: "column", gap: 4 },
            exp.health.issues.map(([label, detail]) =>
              el(
                "div",
                {
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: 4,
                },
                [
                  txt(label, {
                    fontSize: 12,
                    lineHeight: 1.4,
                    fontWeight: 600,
                    color: P.text,
                  }),
                  txt(`— ${detail}`, {
                    fontSize: 12,
                    lineHeight: 1.4,
                    color: P.muted,
                  }),
                ],
              ),
            ),
          ),
        ],
      ),
    ],
  );
}

// Hypothesis above the conclusion for non-started states (the started layout
// carries its own, larger hypothesis inside the body).
function hypothesisEl(exp: ExperimentCardData): El | null {
  if (exp.state === "started" || !exp.hypothesis) return null;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      padding: "14px 24px 13px",
      borderBottom: `1px solid ${P.borderSub}`,
    },
    [
      txt("Hypothesis", {
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: P.subtle,
        marginBottom: 6,
      }),
      renderMarkdown(exp.hypothesis, PROSE_STYLE),
    ],
  );
}

// The main learning, featured near the top: soft status-hue background, a caps
// CONCLUSION label, then the text. Body matches the hypothesis (same size/color)
// since they're of similar importance; the tint + colored label carry emphasis.
function conclusionEl(exp: ExperimentCardData): El | null {
  if (!exp.conclusion?.text) return null;
  const hue = HUE[exp.state];
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      padding: "18px 24px 16px",
      backgroundColor: SOFT[hue],
      borderBottom: `1px solid ${P.border}`,
    },
    [
      txt("Conclusion", {
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: P.st[hue],
        marginBottom: 7,
      }),
      renderMarkdown(exp.conclusion.text, PROSE_STYLE),
    ],
  );
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
    const healthy = !exp.health || exp.health.status !== "unhealthy";
    footerItems = [
      exp.days,
      exp.users ? `${exp.users} users` : undefined,
      exp.dates,
      exp.ds,
      healthy ? "Health: healthy" : "Health: needs attention",
    ];
  }

  const column = [
    headerEl(exp),
    healthBannerEl(exp),
    hypothesisEl(exp),
    conclusionEl(exp),
    body,
    footerEl(footerItems),
  ].filter(Boolean) as El[];

  return cardShell(hue, column);
}

// The rounded panel + full-height status rail shared by every card style.
function cardShell(hue: Hue, column: El[], width: number = CARD_WIDTH): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      width,
      backgroundColor: P.panel,
      border: `1px solid ${P.border}`,
      borderRadius: 14,
      overflow: "hidden",
    },
    [
      el("div", { display: "flex", width: RAIL, backgroundColor: SOLID[hue] }),
      el(
        "div",
        { display: "flex", flexDirection: "column", flexGrow: 1 },
        column,
      ),
    ],
  );
}

// Compact card — a glanceable single-hero-stat card for per-event Slack
// notifications. Reuses the detailed card's violin, badge, and tokens, condensed
// to banner + name + one hero row + slim footer (no full metrics table).

// Markdown -> plain text, collapsed and clamped to one line for compact prose.
function plainClamp(md: string, max: number): string {
  const plain = parseInlineMd(md)
    .map((r) => r.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= max ? plain : plain.slice(0, max - 1).trimEnd() + "…";
}

type EventIconKind = "play" | "check" | "trophy" | "x" | "stop" | "warn";

// Event catalog: label, hue, the experiment status the event implies, and icon.
const COMPACT_EVENT: Record<
  CompactEvent,
  {
    label: string;
    hue: Hue;
    status: "running" | "stopped";
    icon: EventIconKind;
  }
> = {
  started: {
    label: "Experiment started",
    hue: "violet",
    status: "running",
    icon: "play",
  },
  significance: {
    label: "Reached significance",
    hue: "green",
    status: "running",
    icon: "check",
  },
  won: {
    label: "Declared a winner",
    hue: "green",
    status: "stopped",
    icon: "trophy",
  },
  lost: { label: "Rolled back", hue: "red", status: "stopped", icon: "x" },
  stopped: {
    label: "Experiment stopped",
    hue: "slate",
    status: "stopped",
    icon: "stop",
  },
  warning: {
    label: "Health alert",
    hue: "amber",
    status: "running",
    icon: "warn",
  },
  // Decision Framework recommendations — the experiment is still running, so
  // these read like significance (running status, metric lift + chance) rather
  // than the stopped "won"/"lost" outcome cards.
  decisionShip: {
    label: "Ship recommended",
    hue: "green",
    status: "running",
    icon: "check",
  },
  decisionRollback: {
    label: "Rollback recommended",
    hue: "amber",
    status: "running",
    icon: "warn",
  },
};

// Icons drawn in a 24x24 viewBox (svgImg scales to the requested px).
function eventIconSvg(kind: EventIconKind, color: string): string {
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`;
  switch (kind) {
    case "play":
      return wrap(`<path d="M6 4 L20 12 L6 20 Z" fill="${color}"/>`);
    case "check":
      return wrap(
        `<path d="M4 12.5 L10 18 L20 5" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    case "trophy":
      return wrap(
        `<path d="M7 3 H17 V8 A5 5 0 0 1 7 8 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><path d="M7 5 H3 V7 A3 3 0 0 0 7 9 M17 5 H21 V7 A3 3 0 0 1 17 9" fill="none" stroke="${color}" stroke-width="2"/><line x1="12" y1="13" x2="12" y2="18" stroke="${color}" stroke-width="2"/><line x1="8" y1="20" x2="16" y2="20" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
      );
    case "x":
      return wrap(
        `<line x1="5" y1="5" x2="19" y2="19" stroke="${color}" stroke-width="3" stroke-linecap="round"/><line x1="19" y1="5" x2="5" y2="19" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`,
      );
    case "stop":
      return wrap(
        `<rect x="5" y="5" width="14" height="14" rx="2" fill="${color}"/>`,
      );
    case "warn":
    default:
      return wrap(
        `<path d="M12 3 L22 20 H2 Z" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><line x1="12" y1="9.5" x2="12" y2="14.5" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.2" fill="${color}"/>`,
      );
  }
}

// Translucent-white status pill that sits on the solid event banner.
function statusPillEl(status: "running" | "stopped"): El {
  const running = status === "running";
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px",
      borderRadius: 9999,
      backgroundColor: "rgba(255,255,255,0.22)",
    },
    [
      el("div", {
        width: 6,
        height: 6,
        borderRadius: 9999,
        backgroundColor: "#ffffff",
      }),
      txt(running ? "Running" : "Stopped", {
        fontSize: 11,
        fontWeight: 500,
        color: "#ffffff",
      }),
    ],
  );
}

// Derive the event when the caller didn't set one (samples / assistant path).
function compactEventFor(exp: ExperimentCardData): CompactEvent {
  if (exp.event) return exp.event;
  switch (exp.state) {
    case "started":
      return "started";
    case "running":
      return "significance";
    case "winner":
      return "won";
    case "loser":
      return "lost";
    case "warning":
      return "warning";
    case "stopped":
    default:
      return "stopped";
  }
}

function capLabel(
  text: string,
  marginBottom = 6,
  color: string = P.subtle,
): El {
  return txt(text, {
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color,
    marginBottom,
  });
}

// Full-width solid event banner: a rounded icon chip + the event label in white
// on the event color, with a translucent-white status pill on the right.
// Carries the status color (the compact card has no left rail).
function compactBannerEl(
  ev: (typeof COMPACT_EVENT)[CompactEvent],
  hue: Hue,
): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 14,
      padding: "13px 22px",
      backgroundColor: SOLID[hue],
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        [
          el(
            "div",
            {
              display: "flex",
              width: 28,
              height: 28,
              borderRadius: 7,
              backgroundColor: "rgba(255,255,255,0.22)",
              alignItems: "center",
              justifyContent: "center",
            },
            svgImg(eventIconSvg(ev.icon, "#ffffff"), 15, 15),
          ),
          txt(ev.label, {
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.01em",
            color: "#ffffff",
          }),
        ],
      ),
      statusPillEl(ev.status),
    ],
  );
}

// Name row on the white body, directly under the banner.
function compactNameRowEl(exp: ExperimentCardData): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
      padding: "14px 22px 0",
    },
    [
      txt(exp.name, {
        fontSize: 18,
        fontWeight: 600,
        color: P.text,
        letterSpacing: "-0.01em",
      }),
      txt(exp.key, { fontSize: 11.5, color: P.subtle }, true),
      ...(exp.tags?.length ? tagBadges(exp.tags) : []),
    ],
  );
}

// A mini violin + axis labels + CI caption (compact significance hero).
function compactViolin(r: CardGoalRow, width: number): El {
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: 2 },
    [
      r.vio
        ? svgImg(
            violinSvg(width, 46, VIOLIN_DOMAIN, r.vio, { ci: r.ci }),
            width,
            46,
          )
        : null,
      el("div", { display: "flex", justifyContent: "space-between", width }, [
        txt(fmtPct(VIOLIN_DOMAIN[0]), { fontSize: 8.5, color: P.subtle }, true),
        txt("0", { fontSize: 8.5, color: P.subtle }, true),
        txt(fmtPct(VIOLIN_DOMAIN[1]), { fontSize: 8.5, color: P.subtle }, true),
      ]),
      r.ci
        ? txt(
            `95% CI [${fmtPct(r.ci.lo)}, ${fmtPct(r.ci.hi)}]`,
            {
              fontSize: 10.5,
              color: P.subtle,
              width,
              justifyContent: "center",
            },
            true,
          )
        : null,
    ].filter(Boolean) as El[],
  );
}

function compactHero(
  exp: ExperimentCardData,
  event: CompactEvent,
  hue: Hue,
): El {
  const accentText = P.st[hue];
  const r = exp.rows[0];

  if (event === "started") {
    const days = exp.daysToPower ?? 14;
    return el(
      "div",
      { display: "flex", flexDirection: "column", gap: 14, width: "100%" },
      [
        el("div", { display: "flex", flexDirection: "column" }, [
          capLabel("Hypothesis"),
          renderMarkdown(
            exp.hypothesis ? plainClamp(exp.hypothesis, 220) : "",
            { fontSize: 14, lineHeight: 1.5, color: P.text, weight: 400 },
          ),
        ]),
        el(
          "div",
          {
            display: "flex",
            flexDirection: "row",
            gap: 34,
            paddingTop: 14,
            borderTop: `1px solid ${P.borderSub}`,
          },
          [
            el("div", { display: "flex", flexDirection: "column" }, [
              capLabel("Goal metric", 4),
              txt(exp.goal, { fontSize: 14.5, fontWeight: 500, color: P.text }),
            ]),
            el("div", { display: "flex", flexDirection: "column" }, [
              capLabel("Target", 4),
              txt(
                `~${exp.target ? exp.target.toLocaleString() : "—"}`,
                { fontSize: 14, fontWeight: 500, color: P.text },
                true,
              ),
            ]),
            el("div", { display: "flex", flexDirection: "column" }, [
              capLabel("To power", 4),
              txt(
                `~${days} days`,
                { fontSize: 14, fontWeight: 500, color: accentText },
                true,
              ),
            ]),
          ],
        ),
      ],
    );
  }

  if (event === "warning") {
    // Describe the actual health issue rather than assuming SRM. SRM is carried
    // on exp.srm/exp.p; other data-quality issues (multiple exposures, unknown
    // variations) live in exp.health.issues; operational alerts (guardrail
    // failed / no data / query failed) have neither, so fall back to a generic
    // line — the accompanying text message carries the specifics.
    const issues = exp.health?.issues ?? [];
    const bodyStyle = {
      fontSize: 13,
      lineHeight: 1.5,
      color: P.text,
      weight: 400,
    } as const;
    const lines: El[] = [];
    if (exp.srm) {
      lines.push(
        renderMarkdown(
          `Traffic isn't splitting as configured; fix the assignment before trusting results. (${exp.srm}${
            exp.p ? ` · ${exp.p}` : ""
          })`,
          bodyStyle,
        ),
      );
    }
    issues.forEach(([label, detail]) =>
      lines.push(renderMarkdown(`**${label}** — ${detail}`, bodyStyle)),
    );
    if (lines.length === 0) {
      lines.push(
        renderMarkdown(
          "A health check flagged this experiment — review it before trusting results.",
          bodyStyle,
        ),
      );
    }
    const title = exp.srm
      ? "Sample Ratio Mismatch — results paused"
      : issues.length === 1
        ? issues[0][0]
        : issues.length > 1
          ? "Health warnings"
          : "Health alert";
    return el(
      "div",
      {
        display: "flex",
        flexDirection: "row",
        gap: 13,
        alignItems: "flex-start",
        padding: "14px 16px",
        backgroundColor: SOFT.amber,
        borderRadius: 8,
        width: "100%",
      },
      [
        svgImg(triAlertSvg(P.st.amber, 20), 20, 20),
        el(
          "div",
          {
            display: "flex",
            flexDirection: "column",
            gap: 4,
            flexGrow: 1,
            minWidth: 0,
          },
          [
            txt(title, {
              fontSize: 14,
              fontWeight: 700,
              color: P.st.amber,
            }),
            ...lines,
          ],
        ),
      ],
    );
  }

  if (
    (event === "significance" ||
      event === "decisionShip" ||
      event === "decisionRollback") &&
    r
  ) {
    return el(
      "div",
      { display: "flex", flexDirection: "column", gap: 10, width: "100%" },
      [
        capLabel(exp.goal, 6, P.text),
        el(
          "div",
          {
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 6,
          },
          [
            r.dir ? arrowImg(r.dir, accentText, 20) : null,
            txt((r.chg ?? "").replace(/^[+-]/, ""), {
              fontSize: 44,
              fontWeight: 700,
              color: accentText,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }),
            txt(r.v, {
              fontSize: 14,
              fontWeight: 500,
              color: P.muted,
              marginLeft: 6,
              alignSelf: "flex-end",
              marginBottom: 6,
            }),
          ].filter(Boolean) as El[],
        ),
        el(
          "div",
          {
            display: "flex",
            flexDirection: "row",
            alignItems: "baseline",
            gap: 7,
          },
          [
            txt(
              r.ctw ?? "—",
              { fontSize: 16, fontWeight: 600, color: ctwColor(r.ctw) },
              true,
            ),
            txt("chance to beat control", {
              fontSize: 12.5,
              fontWeight: 500,
              color: P.subtle,
            }),
          ],
        ),
        compactViolin(r, COMPACT_WIDTH - 44),
      ],
    );
  }

  // won / lost / stopped — outcome-forward.
  const line = exp.conclusion?.text
    ? plainClamp(exp.conclusion.text, 200)
    : exp.compactLine
      ? plainClamp(exp.compactLine, 200)
      : "";
  // A won test shows the variation that shipped, matched by index (names can
  // collide). If the winner is control or has no goal row, outcomeRow is
  // undefined and the hero shows just the word. lost/stopped use the first row.
  const outcomeRow =
    event === "won"
      ? exp.winningVariationIndex != null
        ? exp.rows.find((row) => row.i === exp.winningVariationIndex)
        : r
      : r;
  const word =
    event === "won"
      ? exp.winningVariation
        ? `${exp.winningVariation} won`
        : "Winner"
      : event === "lost"
        ? "No lift"
        : "Inconclusive";
  const dirColor = outcomeRow?.dir === "up" ? P.st.green : P.st.red;
  // Big-number layout mirroring the significance hero: metric eyebrow, then the
  // change with a direction arrow (sign dropped — the arrow carries it), then
  // the outcome word.
  const heroChildren: (El | null)[] = [
    capLabel(exp.goal, 6, P.text),
    outcomeRow?.chg && outcomeRow.dir
      ? el(
          "div",
          {
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 6,
            flexWrap: "wrap",
          },
          [
            arrowImg(outcomeRow.dir, dirColor, 20),
            txt((outcomeRow.chg ?? "").replace(/^[+-]/, ""), {
              fontSize: 44,
              fontWeight: 700,
              color: dirColor,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }),
            txt(word, {
              fontSize: 15,
              fontWeight: 600,
              color: accentText,
              marginLeft: 8,
              alignSelf: "flex-end",
              marginBottom: 6,
            }),
          ],
        )
      : txt(word, {
          fontSize: 26,
          fontWeight: 700,
          color: accentText,
          letterSpacing: "-0.02em",
        }),
  ];
  // Confidence for the winning/decided variation (chance to beat control).
  if (outcomeRow?.ctw) {
    heroChildren.push(
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          gap: 7,
        },
        [
          txt(
            outcomeRow.ctw,
            { fontSize: 16, fontWeight: 600, color: ctwColor(outcomeRow.ctw) },
            true,
          ),
          txt("chance to beat control", {
            fontSize: 12.5,
            fontWeight: 500,
            color: P.subtle,
          }),
        ],
      ),
    );
  }
  if (line) {
    heroChildren.push(
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          paddingTop: 12,
          borderTop: `1px solid ${P.borderSub}`,
        },
        [
          capLabel("Conclusion"),
          renderMarkdown(line, {
            fontSize: 14,
            lineHeight: 1.5,
            color: P.text,
            weight: 400,
          }),
        ],
      ),
    );
  }
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: 10, width: "100%" },
    heroChildren.filter(Boolean) as El[],
  );
}

function buildCompactCard(exp: ExperimentCardData): El {
  const event = compactEventFor(exp);
  const ev = COMPACT_EVENT[event];
  const r0 = exp.rows[0];
  // Event hue drives the rail + eyebrow; win/significance/ship tint by
  // direction (a "ship recommended" with a down metric goes red).
  let hue = ev.hue;
  if (
    (event === "significance" || event === "won" || event === "decisionShip") &&
    r0?.dir === "down"
  ) {
    hue = "red";
  }

  // Running-state events (no end date) share the significance-style footer.
  const runningEvent =
    event === "warning" ||
    event === "significance" ||
    event === "decisionShip" ||
    event === "decisionRollback";
  const footerItems =
    event === "started"
      ? [exp.variants.join(" · "), exp.dates, exp.ds]
      : runningEvent
        ? [exp.days, exp.users ? `${exp.users} users` : undefined, exp.ds]
        : [
            exp.days,
            exp.users ? `${exp.users} users` : undefined,
            exp.dates,
            exp.ds,
          ];

  // Rail-less panel: the solid banner carries the status color. The hero wrapper
  // flex-grows and centers its content so short cards sit at min-height without
  // looking wide-and-short; tall ones grow.
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: COMPACT_WIDTH,
      minHeight: COMPACT_MIN_HEIGHT,
      backgroundColor: P.panel,
      border: `1px solid ${P.border}`,
      borderRadius: 14,
      overflow: "hidden",
    },
    [
      compactBannerEl(ev, hue),
      compactNameRowEl(exp),
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
          padding: "16px 22px 18px",
        },
        [compactHero(exp, event, hue)],
      ),
      compactFooterEl(footerItems),
    ],
  );
}

// Compact-card footer: metadata on the left, GrowthBook logo bottom-right.
function compactFooterEl(items: (string | undefined)[]): El {
  const fitems = items.filter((x): x is string => !!x);
  const logoH = 16;
  const logoW = Math.round(logoH * LOGO_ASPECT);
  const gap = 12;
  // Fixed metadata width so a long row wraps instead of pushing the logo off the
  // right edge (Satori doesn't wrap flexGrow text — fixed widths do).
  const metaW = COMPACT_WIDTH - 44 - gap - logoW;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap,
      padding: "11px 22px",
      borderTop: `1px solid ${P.border}`,
      marginTop: "auto",
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          width: metaW,
        },
        fitems.map((t, i) =>
          el(
            "div",
            { display: "flex", flexDirection: "row", alignItems: "center" },
            [
              i > 0
                ? txt("·", {
                    fontSize: 11.5,
                    color: P.subtle,
                    margin: "0 9px",
                    opacity: 0.55,
                  })
                : null,
              txt(t, { fontSize: 11.5, color: P.subtle }),
            ].filter(Boolean) as El[],
          ),
        ),
      ),
      {
        type: "img",
        props: {
          src: getLogoDataUri(),
          width: logoW,
          height: logoH,
          // flexShrink:0 so a long metadata row can't squeeze/clip the logo.
          style: { display: "flex", flexShrink: 0 },
        },
      } as El,
    ],
  );
}

// Weekly scorecard — a once-a-week program digest. Distinct from the
// per-experiment cards: a stat strip, a biggest-win highlight, and a notable
// list. Reuses the same tokens, logo, and arrow marks.

export interface ScorecardNotable {
  name: string;
  state: CardState;
  lift?: string | null; // "+6.1%" or null (then `note` shows)
  dir?: "up" | "down";
  note?: string;
}

export interface ScorecardData {
  week: string; // "Jul 1 – Jul 7, 2026"
  stats: {
    running: number;
    significant: number;
    shipped: number;
    rolledback: number;
  };
  highlight?: { name: string; metric: string; lift: string };
  cumWins?: number;
  notable: ScorecardNotable[];
}

const SCORECARD_STATUS_LABEL: Record<CardState, string> = {
  winner: "Won",
  loser: "Lost",
  running: "Running",
  stopped: "Stopped",
  warning: "Needs attention",
  started: "Started",
};

// Notable-list column widths (fixed; the card is a fixed 1000px). Panel content
// 998 − 56px row padding − 28px gaps − 150 − 150 = 614 for the name column.
const SC_NAME_W = 614;
const SC_COL_W = 150;

function dot(color: string, size = 8): El {
  return el("div", {
    display: "flex",
    width: size,
    height: size,
    borderRadius: 9999,
    backgroundColor: color,
  });
}

function scLabel(text: string, extra: Record<string, unknown> = {}): El {
  return txt(text, {
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: P.subtle,
    ...extra,
  });
}

function buildScorecard(data: ScorecardData): El {
  const divider = `1px solid ${P.borderSub}`;
  const logoH = 17;

  const header = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      padding: "22px 28px 18px",
      borderBottom: `1px solid ${P.border}`,
    },
    [
      el("div", { display: "flex", flexDirection: "column" }, [
        txt("Experimentation", {
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: P.st.violet,
          marginBottom: 6,
        }),
        txt(`Week of ${data.week}`, {
          fontSize: 25,
          fontWeight: 700,
          color: P.text,
          letterSpacing: "-0.02em",
        }),
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
  );

  const stats: [string, number, Hue][] = [
    ["Running", data.stats.running, "blue"],
    ["Reached significance", data.stats.significant, "violet"],
    ["Shipped", data.stats.shipped, "green"],
    ["Rolled back", data.stats.rolledback, "red"],
  ];
  const statStrip = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      borderBottom: `1px solid ${P.border}`,
    },
    stats.map(([label, count, hue], i) =>
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexBasis: 0,
          padding: "18px 20px",
          ...(i > 0 ? { borderLeft: divider } : {}),
        },
        [
          el(
            "div",
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              marginBottom: 8,
            },
            [
              dot(SOLID[hue], 8),
              txt(label, { fontSize: 12, fontWeight: 500, color: P.muted }),
            ],
          ),
          txt(String(count), {
            fontSize: 34,
            fontWeight: 700,
            color: P.text,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }),
        ],
      ),
    ),
  );

  const highlight = data.highlight
    ? el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
          padding: "18px 28px",
          backgroundColor: SOFT.green,
          borderBottom: `1px solid ${P.border}`,
        },
        [
          el("div", { display: "flex", flexDirection: "column", gap: 3 }, [
            scLabel("Biggest win", {
              letterSpacing: "0.1em",
              color: P.st.green,
            }),
            txt(data.highlight.name, {
              fontSize: 17,
              fontWeight: 600,
              color: P.text,
              letterSpacing: "-0.01em",
            }),
          ]),
          el(
            "div",
            {
              display: "flex",
              flexDirection: "row",
              flexGrow: 1,
              justifyContent: "flex-end",
              alignItems: "baseline",
              gap: 8,
            },
            [
              el(
                "div",
                {
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                },
                [
                  arrowImg("up", P.st.green, 16),
                  txt(
                    data.highlight.lift,
                    {
                      fontSize: 30,
                      fontWeight: 700,
                      color: P.st.green,
                      letterSpacing: "-0.01em",
                    },
                    true,
                  ),
                ],
              ),
              txt(`on ${data.highlight.metric}`, {
                fontSize: 13,
                fontWeight: 500,
                color: P.muted,
              }),
            ],
          ),
        ],
      )
    : null;

  const listHead = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      gap: 14,
      padding: "10px 28px 4px",
    },
    [
      el("div", { display: "flex", width: SC_NAME_W }, [scLabel("This week")]),
      el("div", { display: "flex", width: SC_COL_W }, [scLabel("Status")]),
      el(
        "div",
        { display: "flex", width: SC_COL_W, justifyContent: "flex-end" },
        [scLabel("Headline metric")],
      ),
    ],
  );

  const listRows = data.notable.map((n, i) => {
    const hue = HUE[n.state];
    const dir = n.dir || (n.state === "loser" ? "down" : "up");
    const showMetric = n.lift !== null && n.lift !== undefined;
    const metricColor = dir === "up" ? P.st.green : P.st.red;
    return el(
      "div",
      {
        display: "flex",
        flexDirection: "row",
        gap: 14,
        alignItems: "center",
        padding: "13px 28px",
        ...(i > 0 ? { borderTop: divider } : {}),
      },
      [
        el(
          "div",
          {
            display: "flex",
            flexDirection: "row",
            width: SC_NAME_W,
            alignItems: "center",
            gap: 10,
          },
          [
            dot(SOLID[hue], 8),
            txt(n.name, {
              fontSize: 14,
              fontWeight: 500,
              color: P.text,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }),
          ],
        ),
        el("div", { display: "flex", width: SC_COL_W }, [
          txt(SCORECARD_STATUS_LABEL[n.state], {
            fontSize: 12.5,
            fontWeight: 500,
            color: P.st[hue],
          }),
        ]),
        el(
          "div",
          {
            display: "flex",
            width: SC_COL_W,
            justifyContent: "flex-end",
            alignItems: "center",
          },
          [
            showMetric
              ? el(
                  "div",
                  {
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                  },
                  [
                    arrowImg(dir, metricColor, 10),
                    txt(
                      n.lift as string,
                      { fontSize: 14, fontWeight: 600, color: metricColor },
                      true,
                    ),
                  ],
                )
              : txt(n.note || "—", { fontSize: 12.5, color: P.subtle }),
          ],
        ),
      ],
    );
  });

  const footer = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 28px",
      borderTop: `1px solid ${P.border}`,
    },
    [
      txt(`${data.cumWins ?? 0} wins shipped year to date`, {
        fontSize: 11.5,
        color: P.subtle,
      }),
      txt('Reply "details <name>" for a full card', {
        fontSize: 11.5,
        color: P.subtle,
      }),
    ],
  );

  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: CARD_WIDTH,
      backgroundColor: P.panel,
      border: `1px solid ${P.border}`,
      borderRadius: 14,
      overflow: "hidden",
    },
    [header, statStrip, highlight, listHead, ...listRows, footer].filter(
      Boolean,
    ) as El[],
  );
}

// satori (flexbox tree -> SVG) -> resvg-wasm (SVG -> PNG @ 2x width).
async function rasterize(
  root: El,
  width: number = CARD_WIDTH,
): Promise<Buffer> {
  await ensureWasmInitialized();
  const svg = await satori(root as unknown as Parameters<typeof satori>[0], {
    width,
    fonts: getFonts(),
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width * 2 },
  });
  return Buffer.from(resvg.render().asPng());
}

/**
 * Render the "detailed" experiment card to a PNG buffer — the full results
 * table with violin plots, CI pills, and health signals. Rendered at 2x width;
 * height auto-fits. Callers should go through `renderExperimentCard` in
 * `./cards` rather than calling this directly.
 */
export async function renderDetailedCard(
  exp: ExperimentCardData,
): Promise<Buffer> {
  return rasterize(buildCard(exp));
}

/**
 * Render the "compact" experiment card — a glanceable single-hero-stat card for
 * per-event Slack notifications. Go through `renderExperimentCard` in `./cards`.
 */
export async function renderCompactCard(
  exp: ExperimentCardData,
): Promise<Buffer> {
  return rasterize(buildCompactCard(exp), COMPACT_WIDTH);
}

/** Render the weekly program scorecard to a PNG buffer. */
export async function renderWeeklyScorecard(
  data: ScorecardData,
): Promise<Buffer> {
  return rasterize(buildScorecard(data));
}

// Feature-flag digest — the sibling of the weekly scorecard. Same visual system
// (header · stat strip · secondary band · lists · footer), for flag activity.

export type FeatureDigestReason =
  | "rollback"
  | "unhealthy"
  | "changes"
  | "review"
  | "stale";

export interface FeatureDigestData {
  period: string; // "Jun 8 – Jul 8, 2026"
  total: number;
  counts: {
    published: number;
    reverted: number;
    safeRolloutShipped: number;
    safeRolloutRolledBack: number;
    safeRolloutUnhealthy: number;
    stale: number;
    reviewRequested: number;
    reviewApproved: number;
    changesRequested: number;
  };
  publishedFlags: string[]; // keys, most-recent first (capped)
  revertedFlags: string[];
  needsAttentionFlags: { key: string; reason?: FeatureDigestReason }[];
}

const FEATURE_REASON: Record<
  FeatureDigestReason,
  { label: string; hue: Hue; glyph: "warn" | "review" | "clock" }
> = {
  rollback: { label: "rolled back", hue: "red", glyph: "warn" },
  unhealthy: { label: "unhealthy", hue: "red", glyph: "warn" },
  changes: { label: "changes requested", hue: "amber", glyph: "warn" },
  review: { label: "awaiting approval", hue: "violet", glyph: "review" },
  stale: { label: "stale · cleanup", hue: "slate", glyph: "clock" },
};

function reasonGlyphSvg(
  glyph: "warn" | "review" | "clock",
  color: string,
): string {
  if (glyph === "review") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="2.2"/><path d="M8 12.5 L11 15.5 L16.5 9" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (glyph === "clock") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="2.2"/><path d="M12 7 V12 L15.5 14" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return triAlertSvg(color, 11);
}

function featureInlineStat(value: number, label: string, color: string): El {
  return el(
    "div",
    { display: "flex", flexDirection: "row", alignItems: "baseline", gap: 6 },
    [
      txt(String(value), { fontSize: 15, fontWeight: 600, color }, true),
      txt(label, { fontSize: 12.5, fontWeight: 400, color: P.muted }),
    ],
  );
}

function featureStatSep(): El {
  return el("div", {
    display: "flex",
    width: 1,
    height: 13,
    backgroundColor: P.border,
    margin: "0 4px",
  });
}

function featureKeyList(
  title: string,
  items: { key: string; reason?: FeatureDigestReason }[],
  kind: "published" | "reverted" | "attention",
): El {
  const headColor =
    kind === "attention"
      ? P.st.red
      : kind === "published"
        ? P.st.blue
        : P.subtle;
  const dotColor =
    kind === "attention"
      ? SOLID.red
      : kind === "published"
        ? SOLID.blue
        : SOLID.slate;

  const rows = items.length
    ? el(
        "div",
        { display: "flex", flexDirection: "column", gap: 2 },
        items.map((item) => {
          const r = item.reason ? FEATURE_REASON[item.reason] : null;
          const leading =
            kind === "attention"
              ? svgImg(
                  reasonGlyphSvg(
                    r ? r.glyph : "warn",
                    r ? P.st[r.hue] : P.st.red,
                  ),
                  11,
                  11,
                )
              : dot(dotColor, 6);
          return el(
            "div",
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              padding: "5px 22px",
            },
            [
              leading,
              txt(
                item.key,
                {
                  fontSize: 13,
                  fontWeight: 500,
                  color: P.text,
                  flexGrow: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
                true,
              ),
              r
                ? txt(r.label, {
                    fontSize: 10,
                    fontWeight: 500,
                    color: P.st[r.hue],
                    backgroundColor: SOFT[r.hue],
                    padding: "2px 7px",
                    borderRadius: 3,
                    flexShrink: 0,
                  })
                : null,
            ].filter(Boolean) as El[],
          );
        }),
      )
    : txt("None this period", {
        fontSize: 12.5,
        color: P.subtle,
        padding: "2px 22px 6px",
      });

  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 0,
      padding: "16px 0 6px",
      ...(kind === "published"
        ? {}
        : { borderLeft: `1px solid ${P.borderSub}` }),
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          padding: "0 22px",
          marginBottom: 11,
        },
        [
          scLabel(title, { color: headColor }),
          txt(
            `${items.length}`,
            { fontSize: 10, fontWeight: 600, color: P.subtle },
            true,
          ),
        ],
      ),
      rows,
    ],
  );
}

function buildFeatureDigest(data: FeatureDigestData): El {
  const c = data.counts;
  const logoH = 24;

  const header = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      padding: "22px 28px 18px",
      borderBottom: `1px solid ${P.border}`,
    },
    [
      el("div", { display: "flex", flexDirection: "column" }, [
        txt("Feature flags", {
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: P.st.violet,
          marginBottom: 6,
        }),
        txt(`Digest · ${data.period}`, {
          fontSize: 25,
          fontWeight: 700,
          color: P.text,
          letterSpacing: "-0.02em",
        }),
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
  );

  const stats: [string, number, Hue][] = [
    ["Published", c.published, "blue"],
    ["Safe rollouts shipped", c.safeRolloutShipped, "green"],
    ["Reverted", c.reverted, "amber"],
    ["Stale · cleanup", c.stale, "slate"],
  ];
  const statStrip = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      borderBottom: `1px solid ${P.border}`,
    },
    stats.map(([label, count, hue], i) =>
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          flexBasis: 0,
          padding: "18px 20px",
          ...(i > 0 ? { borderLeft: `1px solid ${P.borderSub}` } : {}),
        },
        [
          el(
            "div",
            {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              marginBottom: 8,
            },
            [
              dot(SOLID[hue], 8),
              txt(label, { fontSize: 12, fontWeight: 500, color: P.muted }),
            ],
          ),
          txt(String(count), {
            fontSize: 34,
            fontWeight: 700,
            color: P.text,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }),
        ],
      ),
    ),
  );

  const subBand = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 14,
      padding: "13px 28px",
      borderBottom: `1px solid ${P.border}`,
      backgroundColor: P.zebra,
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        },
        [
          scLabel("Safe rollouts", { marginBottom: 0 }),
          featureInlineStat(c.safeRolloutShipped, "shipped", P.st.green),
          featureStatSep(),
          featureInlineStat(c.safeRolloutRolledBack, "rolled back", P.st.red),
          featureStatSep(),
          featureInlineStat(c.safeRolloutUnhealthy, "unhealthy", P.st.amber),
        ],
      ),
      el("div", { display: "flex", flexGrow: 1 }),
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        },
        [
          scLabel("Reviews", { marginBottom: 0 }),
          featureInlineStat(c.reviewRequested, "requested", P.text),
          featureStatSep(),
          featureInlineStat(c.reviewApproved, "approved", P.st.green),
          featureStatSep(),
          featureInlineStat(
            c.changesRequested,
            "changes requested",
            P.st.amber,
          ),
        ],
      ),
    ],
  );

  const lists = el(
    "div",
    { display: "flex", flexDirection: "row", alignItems: "stretch" },
    [
      featureKeyList(
        "Most recent published",
        data.publishedFlags.map((key) => ({ key })),
        "published",
      ),
      featureKeyList(
        "Reverted",
        data.revertedFlags.map((key) => ({ key })),
        "reverted",
      ),
      featureKeyList("Needs attention", data.needsAttentionFlags, "attention"),
    ],
  );

  const footer = el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 28px",
      borderTop: `1px solid ${P.border}`,
    },
    [
      txt(`${data.total} flag events this period`, {
        fontSize: 11.5,
        color: P.subtle,
      }),
      txt('Reply "details <flag-key>" for a full history', {
        fontSize: 11.5,
        color: P.subtle,
      }),
    ],
  );

  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: CARD_WIDTH,
      backgroundColor: P.panel,
      border: `1px solid ${P.border}`,
      borderRadius: 14,
      overflow: "hidden",
    },
    [header, statStrip, subBand, lists, footer],
  );
}

/** Render the feature-flag digest to a PNG buffer. */
export async function renderFeatureDigest(
  data: FeatureDigestData,
): Promise<Buffer> {
  return rasterize(buildFeatureDigest(data));
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
        health: {
          status: "unhealthy",
          issues: [
            ["Multiple exposures", "1.9k users saw more than one variation"],
            [
              "Sample Ratio Mismatch",
              "observed traffic split deviates from the configured split",
            ],
          ],
        },
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
        hypothesis:
          "Regrouping plans by use case on the pricing page will reduce decision friction and increase purchases.",
        conclusion: {
          text: "No clear winner. Neither layout produced a significant change in purchase rate over 30 days, so the experiment was stopped and traffic returned to control.",
        },
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
        winningVariation: "Hero B",
        tags: ["acquisition"],
        users: "162,400",
        days: "Day 26 · stopped",
        dates: "May 12 – Jun 7, 2026",
        ds: "Snowflake · Prod",
        hypothesis:
          "A benefit-led hero that leads with the core value proposition will reduce confusion and drive more visitors to sign up.",
        conclusion: {
          text: "The winning variation is Hero B. It drove a significant improvement in signup conversion without hurting revenue or page-load guardrails. Rolling out to 100%.",
        },
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

/** Sample weekly scorecard (from the design prototype) for eyeballing. */
export function sampleScorecard(): ScorecardData {
  return {
    week: "Jul 1 – Jul 7, 2026",
    stats: { running: 8, significant: 3, shipped: 2, rolledback: 1 },
    highlight: {
      name: "Homepage hero test",
      metric: "signup conversion",
      lift: "+6.1%",
    },
    cumWins: 24,
    notable: [
      { name: "Homepage hero test", state: "winner", lift: "+6.1%", dir: "up" },
      {
        name: "Checkout v2 flow",
        state: "running",
        lift: null,
        note: "Day 1 · collecting",
      },
      { name: "Signup CTA copy", state: "loser", lift: "-1.2%", dir: "down" },
      {
        name: "Pricing page layout",
        state: "stopped",
        lift: null,
        note: "Inconclusive",
      },
      {
        name: "Mobile nav redesign",
        state: "warning",
        lift: null,
        note: "SRM detected",
      },
      {
        name: "Email digest cadence",
        state: "winner",
        lift: "+4.4%",
        dir: "up",
      },
    ],
  };
}

export function sampleFeatureDigest(): FeatureDigestData {
  return {
    period: "Jun 8 – Jul 8, 2026",
    total: 19,
    counts: {
      published: 7,
      reverted: 1,
      safeRolloutShipped: 2,
      safeRolloutRolledBack: 1,
      safeRolloutUnhealthy: 1,
      stale: 3,
      reviewRequested: 2,
      reviewApproved: 1,
      changesRequested: 1,
    },
    publishedFlags: [
      "checkout-banner",
      "new-nav",
      "pricing-v2",
      "signup-cta",
      "referral-widget",
    ],
    revertedFlags: ["legacy-search"],
    needsAttentionFlags: [
      { key: "promo-banner", reason: "unhealthy" },
      { key: "cart-upsell", reason: "rollback" },
      { key: "beta-dashboard", reason: "changes" },
      { key: "onboarding-tour", reason: "review" },
      { key: "old-experiment-flag", reason: "stale" },
    ],
  };
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
