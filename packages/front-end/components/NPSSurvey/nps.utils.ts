export type Category = "detractor" | "passive" | "promoter";

const RESURVEY_DAYS = 90;
const RESURVEY_MS = RESURVEY_DAYS * 24 * 60 * 60 * 1000;

// Standard NPS bands: 0-6 detractor, 7-8 passive, 9-10 promoter.
export function categoryOf(score: number): Category {
  return score <= 6 ? "detractor" : score <= 8 ? "passive" : "promoter";
}

// NPS contribution of a score: +1 promoter, -1 detractor, 0 passive.
export function npsValue(score: number): number {
  return score >= 9 ? 1 : score <= 6 ? -1 : 0;
}

// True while a user is inside the re-survey cooldown window after their last
// prompt. A missing or unparseable date is treated as "not in cooldown".
export function withinCooldown(dateIso?: string | null): boolean {
  if (!dateIso) return false;
  const t = new Date(dateIso).getTime();
  return !Number.isNaN(t) && Date.now() - t < RESURVEY_MS;
}
