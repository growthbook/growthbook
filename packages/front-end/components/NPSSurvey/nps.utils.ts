const DAY_MS = 24 * 60 * 60 * 1000;

const RESURVEY_DAYS = 90;
const RESURVEY_MS = RESURVEY_DAYS * 24 * 60 * 60 * 1000;

// True while a user is inside the re-survey window after their last prompt.
// A missing or unparseable date is treated as "not in the window".
export function withinCooldown(date?: string | Date | null): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  return !Number.isNaN(t) && Date.now() - t < RESURVEY_MS;
}

// Don't ask users who haven't used GrowthBook long enough to have an opinion.
const MIN_TENURE_DAYS = 14;
const MIN_TENURE_MS = MIN_TENURE_DAYS * 24 * 60 * 60 * 1000;

// True once the user has been around long enough to be worth surveying. Takes
// a Date or an ISO string (the field is typed Date but crosses JSON as a
// string). An unknown or unparseable date fails closed, so we never survey on
// missing data — and never throw on it either.
export function meetsMinimumTenure(joined?: string | Date | null): boolean {
  if (!joined) return false;
  const t = new Date(joined).getTime();
  return !Number.isNaN(t) && Date.now() - t >= MIN_TENURE_MS;
}

// The `nps-survey` feature holds the percentage (0-100) of eligible users to
// sample per cycle, so volume is tunable in GrowthBook without a deploy.
// Returns a 0-1 fraction. Percent-only on purpose: accepting fractions too
// would make `1` ambiguous between 1% and 100%, where guessing wrong surveys
// everybody. Anything unexpected — including the flag's original boolean
// shape — fails closed at 0, so a misconfigured flag never blasts everyone.
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

// Selection runs in cycles matching the re-survey window, so a user is picked
// at most once per cycle and the cohort re-rolls afterwards rather than being a
// permanent panel.
const SAMPLE_CYCLE_DAYS = RESURVEY_DAYS;

export function dayIndex(now: Date = new Date()): number {
  return Math.floor(now.getTime() / DAY_MS);
}

// True when this user is in the current cycle's sampled cohort AND their
// staggered start day has arrived.
//
// Selection is keyed on the user and the cycle — deliberately NOT on the
// current day. Re-drawing daily would make the rate behave as a share of
// user-*days* rather than users, so someone visiting daily would be far more
// likely to be picked than someone visiting monthly, biasing the score toward
// power users. Here a visit is only the delivery occasion, not part of the
// draw, which is how dedicated NPS tools sample.
//
// Each selected user then gets a start day spread across the cycle, so prompts
// (and the Slack traffic they generate) trickle out evenly instead of arriving
// as one launch-day burst. Eligibility runs from that day to the end of the
// cycle, giving infrequent visitors a wide window to actually catch it.
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
