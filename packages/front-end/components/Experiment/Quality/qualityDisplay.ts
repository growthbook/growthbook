import { QualityScoreBand, getQualityScoreBand } from "shared/enterprise";
import { ExperimentQualitySectionKey } from "shared/validators";

// A Radix color scale as a bar/fill color and a readable text color
export const scaleColors = (scale: string) => ({
  bar: `var(--${scale}-9)`,
  text: `var(--${scale}-11)`,
});

export const SECTION_COLORS: Record<
  ExperimentQualitySectionKey,
  { bar: string; text: string }
> = {
  setup: scaleColors("amber"),
  documentation: scaleColors("indigo"),
  process: scaleColors("teal"),
  ai: scaleColors("violet"),
};

// The section shades on the settings page's weight bar, darkest first
const navy = (percent: number) =>
  `color-mix(in srgb, var(--indigo-12) ${percent}%, var(--color-background))`;
export const SECTION_WEIGHT_COLORS: Record<
  ExperimentQualitySectionKey,
  string
> = {
  setup: navy(100),
  process: navy(75),
  documentation: navy(50),
  ai: navy(30),
};

// An AI verdict (0-1) as shown everywhere it appears
export const formatAIScore = (score: number) => `${Math.round(score * 100)}%`;

export const BAND_DISPLAY: Record<
  QualityScoreBand,
  {
    label: string;
    scale: "red" | "amber" | "green";
    arc: string;
    text: string;
    // The ghost arc's color when a fix would land in this band
    ghost: string;
  }
> = {
  weak: {
    label: "Weak",
    scale: "red",
    arc: "var(--red-9)",
    text: "var(--red-11)",
    ghost: "var(--red-5)",
  },
  fair: {
    label: "Fair",
    scale: "amber",
    arc: "var(--amber-9)",
    text: "var(--amber-11)",
    ghost: "var(--amber-5)",
  },
  strong: {
    label: "Strong",
    scale: "green",
    arc: "var(--green-9)",
    text: "var(--green-11)",
    ghost: "var(--green-5)",
  },
};

export const getBandDisplay = (score: number) =>
  BAND_DISPLAY[getQualityScoreBand(score)];

export type ScoreTier = "green" | "amber" | "red";

// Tier for a 0-100 score
export function getScoreTier(score: number): ScoreTier {
  return getBandDisplay(score).scale;
}
