import fs from "fs";
import path from "path";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { formatInteger, formatPercentChange } from "shared/util";
import { logger } from "back-end/src/util/logger";
import {
  type MdRun,
  parseInlineMarkdown,
} from "back-end/src/services/notificationCards/markdown";
import { confidenceLabel } from "back-end/src/services/notificationCards/statLabel";
import type {
  CardState,
  CardGoalRow,
  CardField,
  CardTable,
  CardIdentity,
  EventCardData,
  ExperimentCardData,
  CardData,
  CardEvent,
} from "back-end/src/services/notificationCards/types";

// Server-side notification-card rendering. The renderer is platform-neutral:
// delivery adapters can send the resulting PNG to Slack, Teams, Discord, or
// another service. The pure-WASM pipeline has no native binaries or external
// service, so it works in the Docker image and keeps experiment data on-box:
//
//   card model -> satori (JS, flexbox) -> SVG -> @resvg/resvg-wasm -> PNG
//
// Two Satori constraints shape the code: (1) no CSS grid, so the results table is
// built from fixed-width flex rows; (2) charts are generated as standalone
// SVG strings embedded as <img> data-URIs. Those embedded SVGs are pure shapes
// (no <text>) so resvg needs no fonts of its own — all text goes through Satori
// and is emitted as vector paths.

// ---------------------------------------------------------------------------
// Assets: fonts (Inter upright + italic, Roboto Mono) and the GrowthBook logo. All vendored in
// ./assets and copied to dist by the notification-card build step; resolve from
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
      "notificationCards",
      "assets",
      file,
    ),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Notification card asset not found: ${file} (looked in ${candidates.join(", ")})`,
    );
  }
  return found;
}

type FontStyle = "normal" | "italic";
type FontSpec = {
  name: string;
  weight: 400 | 500 | 600;
  style: FontStyle;
  file: string;
};
const inter = (weight: 400 | 500 | 600, style: FontStyle): FontSpec => ({
  name: "Inter",
  weight,
  style,
  file: `inter-latin-${weight}-${style}.woff`,
});
const FONT_SPECS: FontSpec[] = [
  inter(400, "normal"),
  inter(500, "normal"),
  inter(600, "normal"),
  inter(400, "italic"),
  inter(500, "italic"),
  inter(600, "italic"),
  {
    name: "Roboto Mono",
    weight: 400,
    style: "normal",
    file: "roboto-mono-latin-400-normal.woff",
  },
  {
    name: "Roboto Mono",
    weight: 500,
    style: "normal",
    file: "roboto-mono-latin-500-normal.woff",
  },
];

type LoadedFont = {
  name: string;
  weight: 400 | 500 | 600;
  style: FontStyle;
  data: Buffer;
};
let loadedFonts: LoadedFont[] | null = null;
function getFonts(): LoadedFont[] {
  if (!loadedFonts) {
    loadedFonts = FONT_SPECS.map((f) => ({
      name: f.name,
      weight: f.weight,
      style: f.style,
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
// prototype's palette.
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

const HUE: Record<CardState, Hue> = {
  // Started shares the app's Running badge color (indigo).
  started: "blue",
  winner: "green",
  loser: "red",
  stopped: "slate",
  warning: "amber",
};
// Variation number-circle palette (index 0 = control).
const VC = ["#3E63DD", "#12A594", "#F76808", "#E93D82"];

const CARD_WIDTH = 1000;
const VIOLIN_DOMAIN: [number, number] = [-20, 20];
// Results rows: [circle, name, stat, interval, change].
const RESULT_LAYOUT = {
  cols: [36, 200, 120, "flex", 120] as const,
  gap: 14,
  pad: "16px 28px",
  headPad: "9px 28px",
  circle: 24,
  name: 18,
  stat: 20,
  chg: 20,
  head: 12,
  vioW: 380,
  vioH: 56,
  axis: 11,
  ci: 12.5,
} as const;

const isResultsCard = (card: CardData): card is ExperimentCardData =>
  "rows" in card;

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

// ---------------------------------------------------------------------------
// Lightweight markdown for user-authored prose (conclusions, fields). These
// fields come from GrowthBook's markdown editor, so a raw string would show
// literal `**`, `-`, `[label](url)` etc. Satori has no HTML/markdown support and
// only the vendored font weights (Inter 400/500/600, no bold-700 / italic), so
// the inline runs from the shared parser render as: bold -> weight 600, inline
// code -> mono, links -> their label, italic -> the vendored Inter italic
// faces; bullet lists become real bullets here.
// ---------------------------------------------------------------------------

type MdBlock = { type: "p" | "li"; runs: MdRun[] };

function parseMarkdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({
        type: "p",
        runs: parseInlineMarkdown(paragraph.join(" ")),
      });
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
      blocks.push({ type: "li", runs: parseInlineMarkdown(bullet[1]!) });
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
      ...(r.italic ? { fontStyle: "italic" } : {}),
      // Preserve the spaces at run boundaries — Satori trims each flex child's
      // edge whitespace otherwise, gluing adjacent runs together.
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

// Render markdown prose into a stacked block RESULT_LAYOUT. Paragraphs and list items
// are `flexWrap` rows of styled runs so text still wraps within the card.
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
        // One span per word so a styled run wraps within a line instead of
        // moving to the next line as a block. Code chips stay whole.
        b.runs.flatMap((r) =>
          r.code
            ? [runSpan(r, base)]
            : r.text
                .split(/(?<=\s)/)
                .filter((word) => word.length > 0)
                .map((word) => runSpan({ ...r, text: word }, base)),
        ),
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

// Rows carry percents; the shared formatter takes fractions.
const fmtPct = (percent: number): string => formatPercentChange(percent / 100);

// ---------------------------------------------------------------------------
// Charts — pure-shape SVG strings (no <text>; labels are drawn in Satori).
// ---------------------------------------------------------------------------

function violinSvg(
  w: number,
  ht: number,
  domain: [number, number],
  vio: { c: number; s: number },
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

function pctCell(
  chg: string,
  dir: "up" | "down",
  size = 13,
  color?: string,
): El {
  const col = color ?? (dir === "up" ? P.st.green : P.st.red);
  return el("div", { display: "flex", alignItems: "center", gap: 5 }, [
    arrowImg(dir, col, Math.round(size * 0.62)),
    txt(chg, { fontSize: size, fontWeight: 600, color: col }, true),
  ]);
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
      gap: RESULT_LAYOUT.gap,
      padding: opts.padding ?? RESULT_LAYOUT.pad,
      ...(opts.borderBottom ? { borderBottom: opts.borderBottom } : {}),
      ...(opts.backgroundColor
        ? { backgroundColor: opts.backgroundColor }
        : {}),
      ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    },
    RESULT_LAYOUT.cols.map((w, i) => {
      // name + interval left-aligned; stat + change right-aligned.
      const align = i === 2 || i === 4 ? "flex-end" : "flex-start";
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

// The metric's display name on its own line, above the column header. (The
// name is intentionally NOT in the column header — see the design handoff.)
function metricNameEl(name: string): El {
  return txt(name, {
    fontSize: 20,
    fontWeight: 500,
    color: P.text,
    padding: "0 28px 10px",
  });
}

function colHeader(statLabel: string): El {
  // The number-circle and interval cells are intentionally label-less.
  const labels = ["", "", statLabel, "", "Lift"];
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: RESULT_LAYOUT.gap,
      padding: RESULT_LAYOUT.headPad,
      backgroundColor: P.zebra,
    },
    RESULT_LAYOUT.cols.map((w, i) => {
      const align = i === 2 || i === 4 ? "flex-end" : "flex-start";
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
                fontSize: RESULT_LAYOUT.head,
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

// Whether a row's change is in the metric's desired direction. Rows from a
// payload say so via `good` (which accounts for inverse metrics); samples fall
// back to the arrow.
const isGoodOutcome = (r: Pick<CardGoalRow, "dir" | "good">): boolean =>
  r.good ?? r.dir !== "down";

const outcomeColor = (r: Pick<CardGoalRow, "dir" | "good">): string =>
  isGoodOutcome(r) ? P.st.green : P.st.red;

// Color for the stat cell. Rows that know their significance (frequentist
// p-values, or bayesian rows the producer already judged) color by outcome
// direction; otherwise fall back to the chance-to-win thresholds.
function statColor(r: CardGoalRow): string {
  return r.sig ? outcomeColor(r) : P.muted;
}

// One variation's result. Means are intentionally omitted: the row is the
// stat, the interval, and the change.
function goalRowEl(r: CardGoalRow): El {
  const intervalCell = el(
    "div",
    { display: "flex", flexDirection: "column", gap: 2 },
    [
      r.vio
        ? svgImg(
            violinSvg(
              RESULT_LAYOUT.vioW,
              RESULT_LAYOUT.vioH,
              VIOLIN_DOMAIN,
              r.vio,
            ),
            RESULT_LAYOUT.vioW,
            RESULT_LAYOUT.vioH,
          )
        : null,
      // Axis labels (moved out of the SVG so resvg needs no fonts).
      el(
        "div",
        {
          display: "flex",
          justifyContent: "space-between",
          width: RESULT_LAYOUT.vioW,
        },
        [
          txt(
            fmtPct(VIOLIN_DOMAIN[0]),
            { fontSize: RESULT_LAYOUT.axis, color: P.subtle },
            true,
          ),
          txt("0", { fontSize: RESULT_LAYOUT.axis, color: P.subtle }, true),
          txt(
            fmtPct(VIOLIN_DOMAIN[1]),
            { fontSize: RESULT_LAYOUT.axis, color: P.subtle },
            true,
          ),
        ],
      ),
      r.ci
        ? txt(
            `95% CI [${fmtPct(r.ci.lo)}, ${fmtPct(r.ci.hi)}]`,
            {
              fontSize: RESULT_LAYOUT.ci,
              color: P.subtle,
              width: RESULT_LAYOUT.vioW,
              justifyContent: "center",
            },
            true,
          )
        : null,
    ],
  );

  return gridRow(
    [
      RESULT_LAYOUT.circle ? vnumCircle(r.i, RESULT_LAYOUT.circle) : null,
      txt(r.v, {
        fontSize: RESULT_LAYOUT.name,
        fontWeight: 500,
        color: P.text,
      }),
      txt(
        r.ctw ?? "—",
        { fontSize: RESULT_LAYOUT.stat, fontWeight: 600, color: statColor(r) },
        true,
      ),
      intervalCell,
      // Same significance rule as the stat cell: muted unless significant.
      r.chg && r.dir
        ? pctCell(r.chg, r.dir, RESULT_LAYOUT.chg, statColor(r))
        : txt("—", { fontSize: RESULT_LAYOUT.chg, color: P.subtle }, true),
    ],
    { borderBottom: `1px solid ${P.borderSub}`, opacity: r.muted ? 0.55 : 1 },
  );
}

function sectionLabel(t: string): El {
  return txt(t, {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: P.subtle,
    padding: "14px 28px 6px",
  });
}

const statLabelFor = (exp: ExperimentCardData): string =>
  confidenceLabel(exp.statsEngine ?? "bayesian");

// ---------------------------------------------------------------------------
// Card sections.
// ---------------------------------------------------------------------------

// "{units} units - {days} days", with whichever parts the card knows.
function footerText(card: CardIdentity): string {
  return [
    card.units !== undefined ? `${formatInteger(card.units)} units` : undefined,
    card.durationDays !== undefined
      ? `${card.durationDays} day${card.durationDays === 1 ? "" : "s"}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" - ");
}

// Every card ends the same way: units and duration on the left, the
// GrowthBook logo on the right. Rendered even when nothing is known so the
// logo always sits in the same place.
function standardFooterEl(card: CardIdentity): El {
  const logoH = 20;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 16,
      padding: "14px 28px",
      borderTop: `1px solid ${P.border}`,
      marginTop: "auto",
    },
    [
      txt(footerText(card), { fontSize: 14, color: P.subtle }),
      {
        type: "img",
        props: {
          src: getLogoDataUri(),
          width: Math.round(logoH * LOGO_ASPECT),
          height: logoH,
          style: { display: "flex", flexShrink: 0 },
        },
      } as El,
    ],
  );
}

// Metric name above the header, one numbered row per variation.
function goalSectionEls(exp: ExperimentCardData): El[] {
  return [
    sectionLabel("Goal metric"),
    metricNameEl(exp.goal),
    colHeader(statLabelFor(exp)),
    ...exp.rows.map((r) => goalRowEl(r)),
  ];
}

function standardBody(exp: ExperimentCardData): El {
  return el(
    "div",
    { display: "flex", flexDirection: "column", flexGrow: 1 },
    goalSectionEls(exp),
  );
}

// The main learning, featured near the top: soft status-hue background, a caps
// CONCLUSION label, then the conclusion text.
function conclusionEl(exp: ExperimentCardData): El | null {
  const { text, rollout } = exp.conclusion ?? {};
  if (!text && !rollout) return null;
  const hue = HUE[exp.state];
  const section = (label: string, markdown: string, first: boolean) => [
    txt(label, {
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: P.st[hue],
      marginBottom: 6,
      ...(first ? {} : { marginTop: 16 }),
    }),
    renderMarkdown(markdown, { ...PROSE_STYLE, fontSize: 20, lineHeight: 1.4 }),
  ];
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      padding: "18px 28px 20px",
      backgroundColor: SOFT[hue],
      borderBottom: `1px solid ${P.border}`,
    },
    [
      ...(text ? section("Conclusion", text, true) : []),
      ...(rollout ? section("Temporary Rollout", rollout, !text) : []),
    ],
  );
}

const TABLE = {
  colW: 200,
  gap: 18,
  pad: "18px 24px",
  head: 14,
  cell: 22,
  note: 17,
} as const;

// Plain text table: first column flexes and is left-aligned, the rest are
// fixed-width and right-aligned.
function tableEl(table: CardTable): El {
  const sz = TABLE;
  const cell = (s: string, i: number, style: Record<string, unknown>) =>
    el(
      "div",
      {
        display: "flex",
        justifyContent: i === 0 ? "flex-start" : "flex-end",
        ...(i === 0 ? { flexGrow: 1, minWidth: 0 } : { width: sz.colW }),
      },
      [txt(s, style, i !== 0)],
    );
  const row = (cells: El[], style: Record<string, unknown>) =>
    el(
      "div",
      {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: sz.gap,
        padding: sz.pad,
        ...style,
      },
      cells,
    );
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      border: `1px solid ${P.border}`,
      borderRadius: 10,
      overflow: "hidden",
    },
    [
      row(
        table.columns.map((c, i) =>
          cell(c, i, {
            fontSize: sz.head,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: P.subtle,
          }),
        ),
        { backgroundColor: P.zebra },
      ),
      ...table.rows.map((r, ri) =>
        row(
          r.map((s, i) =>
            cell(s, i, {
              fontSize: sz.cell,
              fontWeight: i === 0 ? 500 : 400,
              color: P.text,
            }),
          ),
          ri > 0 ? { borderTop: `1px solid ${P.borderSub}` } : {},
        ),
      ),
      ...(table.note
        ? [
            row([txt(table.note, { fontSize: sz.note, color: P.muted })], {
              borderTop: `1px solid ${P.borderSub}`,
            }),
          ]
        : []),
    ],
  );
}

// Label above, value below — matching the column headers and section labels
// used elsewhere on the cards.
function fieldEl(field: CardField): El {
  return el("div", { display: "flex", flexDirection: "column", gap: 6 }, [
    txt(field.label, {
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: P.subtle,
    }),
    renderMarkdown(field.value, {
      fontSize: 20,
      lineHeight: 1.4,
      color: P.text,
      weight: 400,
    }),
  ]);
}

function eventSummaryBody(card: EventCardData): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      gap: 22,
      padding: "0 28px 26px",
    },
    [
      ...(card.fields ?? []).map(fieldEl),
      ...(card.table ? [tableEl(card.table)] : []),
    ],
  );
}

// Full-width headline bar in the card's state color, e.g. "Health Alert - SRM
// Detected", with the event's icon. Amber is too light for white text, so it
// gets the dark text color; the other hues take white.
function eventBannerEl(card: CardIdentity, hue: Hue): El {
  const event = eventFor(card);
  const color = hue === "amber" ? P.text : "#ffffff";
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      padding: "16px 28px",
      backgroundColor: SOLID[hue],
    },
    [
      txt(card.banner, {
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        color,
      }),
      svgImg(eventIconSvg(EVENT_ICON[event], color), 26, 26),
    ],
  );
}

// Header for banner cards: the banner carries the state and the footer the
// logo, so this is just the large experiment name (plus tags).
function eventHeaderEl(card: CardIdentity): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "baseline",
      gap: 14,
      flexWrap: "wrap",
      padding: "22px 28px 18px",
    },
    [
      txt(card.name, {
        fontSize: 28,
        fontWeight: 600,
        color: P.text,
        letterSpacing: "-0.01em",
      }),
    ],
  );
}

function buildCard(card: CardData): El {
  const hue = HUE[card.state];
  return cardShell([
    eventBannerEl(card, hue),
    eventHeaderEl(card),
    ...(isResultsCard(card)
      ? [conclusionEl(card), standardBody(card)]
      : [eventSummaryBody(card)]),
    standardFooterEl(card),
  ]);
}

// The rounded panel shared by every card. Status color comes from the badge or
// banner, not a rail.
function cardShell(column: (El | null)[]): El {
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
    column.filter(Boolean) as El[],
  );
}

// ---------------------------------------------------------------------------
// Event banner icons.
// ---------------------------------------------------------------------------

type EventIconKind = "play" | "check" | "trophy" | "x" | "stop" | "warn";

const EVENT_ICON: Record<CardEvent, EventIconKind> = {
  started: "play",
  won: "trophy",
  lost: "x",
  stopped: "stop",
  warning: "warn",
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

// The event a card announces follows from its state.
function eventFor(exp: CardIdentity): CardEvent {
  switch (exp.state) {
    case "started":
      return "started";
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

async function rasterize(root: El): Promise<Buffer> {
  await ensureWasmInitialized();
  const svg = await satori(root as unknown as Parameters<typeof satori>[0], {
    width: CARD_WIDTH,
    fonts: getFonts(),
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_WIDTH * 2 },
  });
  return Buffer.from(resvg.render().asPng());
}

/**
 * Render a card to a PNG buffer: the full results table with posterior violin
 * plots, CI pills, and health signals, at 2x width for crisp display in
 * messaging clients; height auto-fits. Callers go through `renderCard` in
 * `./cardStyles`, which picks the theme.
 */
export async function renderLightCard(exp: CardData): Promise<Buffer> {
  return rasterize(buildCard(exp));
}

export async function renderDarkCard(exp: CardData): Promise<Buffer> {
  return rasterize(darkTheme(buildCard(exp)));
}

// Light palette -> dark palette. The tree is local to one render, so
// concurrent light and dark requests cannot mix.
const DARK_COLORS: Record<string, string> = {
  "#ffffff": "#1D202A",
  "#faf8ff": "#242833",
  "#1f2d5c": "#EDEEF0",
  "#60646c": "#B0B4BE",
  "#80838d": "#989EAB",
  "#dddee3": "#454B59",
  "#edeef0": "#353B48",
  "#fbfbfd": "#242833",
  "#f1f2f4": "#303644",
  "#5746af": "#B8A5FF",
  "#006dcb": "#70B8FF",
  "#00713f": "#6AD5A5",
  "#c40006": "#FF8F95",
  "#ab6400": "#FFD078",
  "#c1c4cd": "#727B8F",
};

// Solid banners keep their event color and white text on either theme.
const FIXED_BACKGROUNDS = new Set(Object.values(SOLID));

function darkTheme(node: El): El {
  if (FIXED_BACKGROUNDS.has(String(node.props.style?.backgroundColor))) {
    return node;
  }
  const recolor = (value: string) =>
    value.replace(
      /#[0-9a-f]{6}/gi,
      (color) => DARK_COLORS[color.toLowerCase()] ?? color,
    );
  const child = (value: El | string | null): El | string | null =>
    value && typeof value === "object" ? darkTheme(value) : value;
  const children = node.props.children;
  const src = node.props.src;
  const prefix = "data:image/svg+xml;base64,";
  return {
    ...node,
    props: {
      ...node.props,
      style: Object.fromEntries(
        Object.entries(node.props.style ?? {}).map(([key, value]) => [
          key,
          typeof value === "string" ? recolor(value) : value,
        ]),
      ),
      // Embedded charts carry their own colors; the logo keeps its brand colors.
      ...(src?.startsWith(prefix) && src !== getLogoDataUri()
        ? {
            src:
              prefix +
              Buffer.from(
                recolor(
                  Buffer.from(src.slice(prefix.length), "base64").toString(
                    "utf8",
                  ),
                ),
              ).toString("base64"),
          }
        : {}),
      children: Array.isArray(children)
        ? children.map(child)
        : children === undefined
          ? undefined
          : (child(children) ?? undefined),
    },
  };
}

/** Sample cards (from the design prototype) for eyeballing each state. */
/** Warm the renderer (font + wasm) at startup rather than on first use. */
export async function warmNotificationCardRenderer(): Promise<void> {
  try {
    await ensureWasmInitialized();
    getFonts();
    getLogoDataUri();
  } catch (err) {
    logger.warn(err, "Notification card image renderer failed to warm up");
  }
}
