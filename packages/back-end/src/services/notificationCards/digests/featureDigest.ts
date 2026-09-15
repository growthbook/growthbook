import {
  CARD_WIDTH,
  El,
  el,
  getLogoDataUri,
  Hue,
  LOGO_ASPECT,
  P,
  rasterize,
  SOFT,
  SOLID,
  svgImg,
  triAlertSvg,
  txt,
} from "back-end/src/services/notificationCards/cardImages";
import { dot, scLabel } from "./layout";

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
  rollback: { label: "rollback recommended", hue: "red", glyph: "warn" },
  unhealthy: { label: "unhealthy", hue: "red", glyph: "warn" },
  changes: { label: "changes requested", hue: "amber", glyph: "warn" },
  review: { label: "review requested", hue: "violet", glyph: "review" },
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
    ["Ready to ship", c.safeRolloutShipped, "green"],
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
          featureInlineStat(c.safeRolloutShipped, "ready to ship", P.st.green),
          featureStatSep(),
          featureInlineStat(
            c.safeRolloutRolledBack,
            "rollback recommended",
            P.st.red,
          ),
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
      featureKeyList("Attention events", data.needsAttentionFlags, "attention"),
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
      txt("View flags in GrowthBook", {
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
