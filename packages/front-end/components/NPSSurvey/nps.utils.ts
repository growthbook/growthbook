const DAY_MS = 24 * 60 * 60 * 1000;

const RESURVEY_DAYS = 90;
const RESURVEY_MS = RESURVEY_DAYS * DAY_MS;

// A missing or unparseable date counts as "not in the window".
export function withinCooldown(date?: string | Date | null): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  return !Number.isNaN(t) && Date.now() - t < RESURVEY_MS;
}

// Don't ask users who haven't been here long enough to have an opinion.
export const DEFAULT_MIN_TENURE_DAYS = 14;

// Takes a Date or an ISO string (typed Date, but crosses JSON as a string).
// Unknown or unparseable fails closed rather than throwing.
export function meetsMinimumTenure(
  joined?: string | Date | null,
  minTenureDays: number = DEFAULT_MIN_TENURE_DAYS,
): boolean {
  if (!joined) return false;
  const t = new Date(joined).getTime();
  return !Number.isNaN(t) && Date.now() - t >= minTenureDays * DAY_MS;
}

// Percent (0-100) in, 0-1 fraction out. Percent-only on purpose: accepting
// fractions too would make `1` ambiguous between 1% and 100%, and guessing wrong
// surveys everybody. Anything else — including a boolean, the shape this feature
// originally had — fails closed at 0 rather than blasting the whole user base.
export function parseSampleRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(value / 100, 1);
}

export type NpsSurveyConfig = {
  // 0-1 fraction, not the percent the feature is configured with.
  rate: number;
  minTenureDays: number;
};

function parseMinTenureDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_MIN_TENURE_DAYS;
  }
  return value;
}

// Tunable from the `nps-survey` feature without a deploy. Two shapes, so the
// feature can gain settings without being recreated (GrowthBook can't change a
// feature's value type):
//
//   Number:  5                            -> 5%, default tenure
//   JSON:    {"rate":5,"minTenureDays":30} -> 5%, 30-day tenure
//
// Fields fall back independently and an unusable value fails closed, so a JSON
// object missing `rate` turns the survey off.
export function parseSurveyConfig(value: unknown): NpsSurveyConfig {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { rate, minTenureDays } = value as Record<string, unknown>;
    return {
      rate: parseSampleRate(rate),
      minTenureDays: parseMinTenureDays(minTenureDays),
    };
  }
  return {
    rate: parseSampleRate(value),
    minTenureDays: DEFAULT_MIN_TENURE_DAYS,
  };
}

// Copy of `hashFnv32a` + v2 bucketing from sdk-js/src/util.ts, so sampling
// buckets match feature rollouts. Copied rather than imported because the SDK
// doesn't export it; safe because the algorithm is frozen. HASH_GOLDEN pins it.
function fnv32a(str: string): number {
  let hval = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i);
    hval +=
      (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  return hval >>> 0;
}

export function hashToUnitInterval(seed: string, value: string): number {
  return (fnv32a(fnv32a(seed + value) + "") % 10000) / 10000;
}

// Cycles match the re-survey window, so the cohort re-rolls rather than becoming
// a permanent panel.
const SAMPLE_CYCLE_DAYS = RESURVEY_DAYS;

export function dayIndex(now: Date = new Date()): number {
  return Math.floor(now.getTime() / DAY_MS);
}

// Keyed on user and cycle, deliberately not on the current day: re-drawing daily
// would make the rate a share of user-*days*, biasing the score toward frequent
// visitors. A visit is the delivery occasion, not part of the draw.
//
// Selected users get a start day spread across the cycle so prompts trickle out
// instead of arriving as one launch-day burst, and stay eligible to the end of
// the cycle so infrequent visitors can still catch it.
export function inSampledCohort(
  userId: string | undefined,
  rate: number,
  now: Date = new Date(),
): boolean {
  if (!userId || rate <= 0) return false;
  if (rate >= 1) return true;

  const day = dayIndex(now);
  const cycle = Math.floor(day / SAMPLE_CYCLE_DAYS);
  const dayInCycle = day - cycle * SAMPLE_CYCLE_DAYS;

  if (hashToUnitInterval("nps-select", `${userId}:${cycle}`) >= rate) {
    return false;
  }

  const startDay = Math.floor(
    hashToUnitInterval("nps-stagger", `${userId}:${cycle}`) * SAMPLE_CYCLE_DAYS,
  );
  return dayInCycle >= startDay;
}
