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

export type ScoreTier = "green" | "amber" | "red";

// Tier for a 0-100 score
export function getScoreTier(score: number): ScoreTier {
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
}
