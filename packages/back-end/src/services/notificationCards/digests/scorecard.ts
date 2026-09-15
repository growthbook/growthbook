import type { CardState } from "back-end/src/services/notificationCards/types";
import {
  arrowImg,
  CARD_WIDTH,
  El,
  el,
  getLogoDataUri,
  HUE,
  Hue,
  LOGO_ASPECT,
  P,
  rasterize,
  SOFT,
  SOLID,
  txt,
} from "back-end/src/services/notificationCards/cardImages";
import { dot, scLabel } from "./layout";

export interface ScorecardNotable {
  name: string;
  label?: string;
  state: CardState;
  lift?: string | null; // "+6.1%" or null (then `note` shows)
  dir?: "up" | "down";
  note?: string;
}

export interface ScorecardData {
  week: string; // "Jul 1 – Jul 7, 2026"
  stats: {
    started: number;
    significant: number;
    stopped: number;
    warnings: number;
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
        txt(data.week, {
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
    ["Started", data.stats.started, "blue"],
    ["Reached significance", data.stats.significant, "violet"],
    ["Stopped", data.stats.stopped, "slate"],
    ["Warnings", data.stats.warnings, "amber"],
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
      el("div", { display: "flex", width: SC_NAME_W }, [
        scLabel("This period"),
      ]),
      el("div", { display: "flex", width: SC_COL_W }, [scLabel("Status")]),
      el(
        "div",
        { display: "flex", width: SC_COL_W, justifyContent: "flex-end" },
        [scLabel("Detail")],
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
          txt(n.label || SCORECARD_STATUS_LABEL[n.state], {
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
      txt("Activity in this channel’s selected scope", {
        fontSize: 11.5,
        color: P.subtle,
      }),
      txt("View experiments in GrowthBook", {
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

export async function renderWeeklyScorecard(
  data: ScorecardData,
): Promise<Buffer> {
  return rasterize(buildScorecard(data));
}
