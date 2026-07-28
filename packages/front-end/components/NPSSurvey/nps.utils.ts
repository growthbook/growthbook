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

// Don't ask users who haven't used GrowthBook long enough to have an opinion.
const MIN_ORG_AGE_DAYS = 14;
const MIN_ORG_AGE_MS = MIN_ORG_AGE_DAYS * 24 * 60 * 60 * 1000;

// True once the org is old enough to be worth surveying. An unknown creation
// date fails closed (not eligible) so we never survey on missing data.
export function meetsMinimumTenure(orgCreatedIso?: string | null): boolean {
  if (!orgCreatedIso) return false;
  const t = new Date(orgCreatedIso).getTime();
  return !Number.isNaN(t) && Date.now() - t >= MIN_ORG_AGE_MS;
}

// The `nps-survey` feature holds the percentage (0-100) of eligible users to
// sample, so volume is tunable in GrowthBook without a deploy. Returns a 0-1
// fraction. Percent-only on purpose: accepting fractions too would make `1`
// ambiguous between 1% and 100%, where guessing wrong surveys everybody.
// Anything unexpected — including the flag's original boolean shape — fails
// closed at 0, so a misconfigured flag never blasts the whole user base.
export function parseSampleRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(value / 100, 1);
}

// FNV-1a, matching the GrowthBook SDK's v2 hashing so sampling buckets behave
// the same way feature rollouts do (the SDK doesn't export its hash).
function fnv32a(str: string): number {
  let hval = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i);
    hval +=
      (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  return hval >>> 0;
}

function hashToUnitInterval(seed: string, value: string): number {
  return (fnv32a(fnv32a(seed + value) + "") % 10000) / 10000;
}

// Day index used to rotate the sampled cohort. Rotating daily spreads responses
// into a steady trickle instead of one burst, the way dedicated NPS tools do.
export function sampleWindow(now: Date = new Date()): number {
  return Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
}

// True when this user falls in today's sampled cohort. The window is folded
// into the hash input so a different slice of users is eligible each day, and
// everyone rotates through over time rather than a fixed panel being asked
// repeatedly. Combined with the 90-day cooldown, nobody is asked twice.
export function inSampledCohort(
  userId: string | undefined,
  rate: number,
  now: Date = new Date(),
): boolean {
  if (!userId || rate <= 0) return false;
  if (rate >= 1) return true;
  return (
    hashToUnitInterval("nps-survey", `${userId}:${sampleWindow(now)}`) < rate
  );
}
