import fs from "fs";
import path from "path";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { logger } from "back-end/src/util/logger";

// Server-side chart-image rendering for Slack (Phase 2). Pure WASM pipeline —
// no native binaries (sharp/node-canvas) and no external service, so it works
// in the Docker image and keeps experiment data on-box:
//
//   card data -> satori (JS) -> SVG -> @resvg/resvg-wasm -> PNG
//
// Satori lays out a flexbox/CSS subset and emits glyphs as vector paths, so the
// resulting SVG is self-contained (resvg needs no fonts of its own).

// --- assets ----------------------------------------------------------------

// Bundled font (Geist, SIL OFL). Copied to dist/services/slack/assets by the
// `build:slack-assets` script; resolves from src when running via ts/tests.
function resolveFontPath(): string {
  const candidates = [
    path.join(__dirname, "assets", "Geist-Regular.ttf"),
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "services",
      "slack",
      "assets",
      "Geist-Regular.ttf",
    ),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Slack chart font not found. Looked in: ${candidates.join(", ")}`,
    );
  }
  return found;
}

let fontData: Buffer | null = null;
function getFontData(): Buffer {
  if (!fontData) fontData = fs.readFileSync(resolveFontPath());
  return fontData;
}

// resvg's wasm ships inside its npm package; node_modules is always deployed,
// so resolve it there rather than copying it into dist.
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
      // Reset so a later call can retry rather than being stuck on a rejected
      // promise (e.g. a transient read error).
      wasmReady = null;
      throw err;
    });
  }
  return wasmReady;
}

// --- card model ------------------------------------------------------------

export interface ResultsCardVariation {
  name: string;
  isBaseline?: boolean;
  users: number;
  /** Pre-formatted primary metric value, e.g. "12.4%". */
  valueFormatted: string;
  /** Pre-formatted change vs baseline, e.g. "+4.2%". */
  changeFormatted?: string;
  /** Chance to win, 0..1 (bayesian). */
  chanceToWin?: number;
  status?: "won" | "lost" | "draw";
}

export interface ResultsCardData {
  experimentName: string;
  metricName: string;
  status: string;
  variations: ResultsCardVariation[];
}

// --- layout ----------------------------------------------------------------

// Satori accepts plain element objects ({ type, props }) without JSX. We type
// them locally and cast to satori's node param to avoid pulling React types
// into the back-end.
type El = {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: El | string | (El | string)[];
  };
};

const COLORS = {
  bg: "#ffffff",
  panel: "#f7f8fa",
  border: "#e5e7eb",
  text: "#1f2937",
  muted: "#6b7280",
  won: "#16a34a",
  lost: "#dc2626",
  draw: "#6b7280",
  accent: "#7c3aed",
};

const el = (
  type: string,
  style: Record<string, unknown>,
  children?: El["props"]["children"],
): El => ({
  type,
  props: { style, ...(children !== undefined ? { children } : {}) },
});

const CARD_WIDTH = 900;
const HEADER_H = 96;
const ROW_H = 52;
const PADDING = 28;

function statusColor(status?: string): string {
  if (status === "won") return COLORS.won;
  if (status === "lost") return COLORS.lost;
  return COLORS.draw;
}

function variationRow(v: ResultsCardVariation): El {
  const ctw =
    typeof v.chanceToWin === "number"
      ? `${Math.round(v.chanceToWin * 100)}%`
      : "—";
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      height: ROW_H,
      borderTop: `1px solid ${COLORS.border}`,
      paddingLeft: 4,
      paddingRight: 4,
    },
    [
      // Variation name (+ baseline tag)
      el("div", { display: "flex", flexDirection: "column", width: 300 }, [
        el("div", { fontSize: 20, color: COLORS.text }, v.name),
        el(
          "div",
          { fontSize: 13, color: COLORS.muted },
          v.isBaseline ? "baseline" : `${v.users.toLocaleString()} users`,
        ),
      ]),
      // Metric value
      el(
        "div",
        { display: "flex", width: 150, fontSize: 20, color: COLORS.text },
        v.valueFormatted,
      ),
      // Change vs baseline
      el(
        "div",
        {
          display: "flex",
          width: 130,
          fontSize: 20,
          color: statusColor(v.status),
        },
        v.changeFormatted ?? "—",
      ),
      // Chance to win
      el(
        "div",
        {
          display: "flex",
          flexGrow: 1,
          justifyContent: "flex-end",
          fontSize: 20,
          color: COLORS.text,
        },
        ctw,
      ),
    ],
  );
}

function buildCard(data: ResultsCardData): El {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: CARD_WIDTH,
      backgroundColor: COLORS.bg,
      padding: PADDING,
      fontFamily: "Geist",
    },
    [
      // Header
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          height: HEADER_H,
          justifyContent: "center",
        },
        [
          el("div", { fontSize: 30, color: COLORS.text }, data.experimentName),
          el(
            "div",
            { fontSize: 16, color: COLORS.muted, marginTop: 4 },
            `${data.metricName} · ${data.status}`,
          ),
        ],
      ),
      // Column labels
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          fontSize: 13,
          color: COLORS.muted,
          paddingLeft: 4,
          paddingRight: 4,
          paddingBottom: 6,
        },
        [
          el("div", { display: "flex", width: 300 }, "Variation"),
          el("div", { display: "flex", width: 150 }, "Value"),
          el("div", { display: "flex", width: 130 }, "Change"),
          el(
            "div",
            { display: "flex", flexGrow: 1, justifyContent: "flex-end" },
            "Chance to win",
          ),
        ],
      ),
      // Rows
      ...data.variations.map(variationRow),
    ],
  );
}

// --- render ----------------------------------------------------------------

/**
 * Render an experiment results card to a PNG buffer. Rendered at 2x for crisp
 * display in Slack.
 */
export async function renderExperimentResultsCard(
  data: ResultsCardData,
): Promise<Buffer> {
  await ensureWasmInitialized();

  const height =
    PADDING * 2 + HEADER_H + 24 + data.variations.length * ROW_H + 8;

  const svg = await satori(
    buildCard(data) as unknown as Parameters<typeof satori>[0],
    {
      width: CARD_WIDTH,
      height,
      fonts: [
        {
          name: "Geist",
          data: getFontData(),
          weight: 400,
          style: "normal",
        },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_WIDTH * 2 },
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

/** Sample card for eyeballing output quality without a real snapshot. */
export function sampleResultsCard(): ResultsCardData {
  return {
    experimentName: "Checkout CTA color",
    metricName: "Purchases",
    status: "running",
    variations: [
      {
        name: "Control",
        isBaseline: true,
        users: 12840,
        valueFormatted: "8.2%",
      },
      {
        name: "Variation 1 (Green)",
        users: 12910,
        valueFormatted: "9.1%",
        changeFormatted: "+11.0%",
        chanceToWin: 0.97,
        status: "won",
      },
      {
        name: "Variation 2 (Orange)",
        users: 12760,
        valueFormatted: "7.9%",
        changeFormatted: "-3.7%",
        chanceToWin: 0.18,
        status: "lost",
      },
    ],
  };
}

/** Log any startup issues early rather than on first Slack use. */
export async function warmChartImageRenderer(): Promise<void> {
  try {
    await ensureWasmInitialized();
    getFontData();
  } catch (err) {
    logger.warn(err, "Slack chart image renderer failed to warm up");
  }
}
