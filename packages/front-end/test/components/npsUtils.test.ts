// @vitest-environment jsdom
import { npsCategoryOf, npsValueOf } from "shared/nps";
import {
  DEFAULT_MIN_TENURE_DAYS,
  hashToUnitInterval,
  inSampledCohort,
  meetsMinimumTenure,
  parseSampleRate,
  parseSurveyConfig,
  withinCooldown,
} from "@/components/NPSSurvey/nps.utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = 90;

describe("npsCategoryOf", () => {
  it("classifies detractors (0-6)", () => {
    for (const s of [0, 1, 5, 6]) expect(npsCategoryOf(s)).toBe("detractor");
  });
  it("classifies passives (7-8)", () => {
    expect(npsCategoryOf(7)).toBe("passive");
    expect(npsCategoryOf(8)).toBe("passive");
  });
  it("classifies promoters (9-10)", () => {
    expect(npsCategoryOf(9)).toBe("promoter");
    expect(npsCategoryOf(10)).toBe("promoter");
  });
});

describe("npsValueOf", () => {
  it("is -1 for detractors, 0 for passives, +1 for promoters", () => {
    expect(npsValueOf(0)).toBe(-1);
    expect(npsValueOf(6)).toBe(-1);
    expect(npsValueOf(7)).toBe(0);
    expect(npsValueOf(8)).toBe(0);
    expect(npsValueOf(9)).toBe(1);
    expect(npsValueOf(10)).toBe(1);
  });
});

describe("withinCooldown", () => {
  it("returns false for a missing date", () => {
    expect(withinCooldown()).toBe(false);
    expect(withinCooldown(null)).toBe(false);
    expect(withinCooldown("")).toBe(false);
  });

  it("returns false for an unparseable date", () => {
    expect(withinCooldown("not-a-date")).toBe(false);
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(withinCooldown(new Date(Date.now() - DAY_MS))).toBe(true);
  });

  it("returns true inside the 90-day window", () => {
    expect(withinCooldown(new Date(Date.now() - DAY_MS).toISOString())).toBe(
      true,
    );
    expect(
      withinCooldown(new Date(Date.now() - 89 * DAY_MS).toISOString()),
    ).toBe(true);
  });

  it("returns false once the 90-day window has passed", () => {
    expect(
      withinCooldown(new Date(Date.now() - 91 * DAY_MS).toISOString()),
    ).toBe(false);
  });
});

describe("parseSampleRate", () => {
  it("reads the value as a percentage", () => {
    expect(parseSampleRate(5)).toBe(0.05);
    expect(parseSampleRate(50)).toBe(0.5);
  });

  it("treats 0 as off and 100 as all users", () => {
    expect(parseSampleRate(0)).toBe(0);
    expect(parseSampleRate(100)).toBe(1);
  });

  it("reads a small number as that percent, not a fraction", () => {
    // The ambiguous case: 1 must mean 1%, never 100%.
    expect(parseSampleRate(1)).toBe(0.01);
    expect(parseSampleRate(0.5)).toBe(0.005);
  });

  it("clamps out-of-range values", () => {
    expect(parseSampleRate(250)).toBe(1);
    expect(parseSampleRate(-1)).toBe(0);
  });

  it("fails closed on unexpected values, including booleans", () => {
    expect(parseSampleRate(true)).toBe(0);
    expect(parseSampleRate(false)).toBe(0);
    expect(parseSampleRate(undefined)).toBe(0);
    expect(parseSampleRate(null)).toBe(0);
    expect(parseSampleRate("5")).toBe(0);
    expect(parseSampleRate({})).toBe(0);
    expect(parseSampleRate(NaN)).toBe(0);
  });
});

describe("meetsMinimumTenure", () => {
  it("excludes users who joined less than the minimum ago", () => {
    expect(
      meetsMinimumTenure(new Date(Date.now() - 3 * DAY_MS).toISOString()),
    ).toBe(false);
  });

  it("includes users past the minimum", () => {
    expect(
      meetsMinimumTenure(new Date(Date.now() - 30 * DAY_MS).toISOString()),
    ).toBe(true);
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(meetsMinimumTenure(new Date(Date.now() - 30 * DAY_MS))).toBe(true);
  });

  it("fails closed on missing or invalid dates rather than throwing", () => {
    expect(meetsMinimumTenure()).toBe(false);
    expect(meetsMinimumTenure(null)).toBe(false);
    expect(meetsMinimumTenure("nonsense")).toBe(false);
    expect(meetsMinimumTenure(new Date("nonsense"))).toBe(false);
  });
});

describe("meetsMinimumTenure with a configured window", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

  it("honors a longer window from the feature", () => {
    expect(meetsMinimumTenure(daysAgo(20), 30)).toBe(false);
    expect(meetsMinimumTenure(daysAgo(40), 30)).toBe(true);
  });

  it("honors a shorter window from the feature", () => {
    expect(meetsMinimumTenure(daysAgo(3), 1)).toBe(true);
  });

  it("surveys immediately when the window is 0", () => {
    expect(meetsMinimumTenure(daysAgo(0), 0)).toBe(true);
  });

  it("defaults to the 14-day window when not given one", () => {
    expect(DEFAULT_MIN_TENURE_DAYS).toBe(14);
    expect(meetsMinimumTenure(daysAgo(13))).toBe(false);
    expect(meetsMinimumTenure(daysAgo(15))).toBe(true);
  });
});

describe("parseSurveyConfig", () => {
  it("reads a bare number as the rate, with the default tenure", () => {
    expect(parseSurveyConfig(5)).toEqual({
      rate: 0.05,
      minTenureDays: DEFAULT_MIN_TENURE_DAYS,
    });
  });

  it("reads both settings from an object", () => {
    expect(parseSurveyConfig({ rate: 5, minTenureDays: 30 })).toEqual({
      rate: 0.05,
      minTenureDays: 30,
    });
  });

  it("falls back per-field when one is missing or unusable", () => {
    expect(parseSurveyConfig({ rate: 10 })).toEqual({
      rate: 0.1,
      minTenureDays: DEFAULT_MIN_TENURE_DAYS,
    });
    expect(parseSurveyConfig({ minTenureDays: 7 })).toEqual({
      rate: 0,
      minTenureDays: 7,
    });
    expect(parseSurveyConfig({ rate: 5, minTenureDays: "soon" })).toEqual({
      rate: 0.05,
      minTenureDays: DEFAULT_MIN_TENURE_DAYS,
    });
    expect(parseSurveyConfig({ rate: 5, minTenureDays: -3 })).toEqual({
      rate: 0.05,
      minTenureDays: DEFAULT_MIN_TENURE_DAYS,
    });
  });

  it("fails closed on shapes that aren't a number or a config object", () => {
    for (const v of [undefined, null, true, false, "5", [], [5]]) {
      expect(parseSurveyConfig(v)).toEqual({
        rate: 0,
        minTenureDays: DEFAULT_MIN_TENURE_DAYS,
      });
    }
  });
});

describe("inSampledCohort", () => {
  const day = (n: number) => new Date(n * DAY_MS);
  // Day 0 of a cycle, so a whole cycle is available ahead of us.
  const cycleStart = 20000 - (20000 % CYCLE_DAYS);
  const users = Array.from({ length: 3000 }, (_, i) => `usr_${i}`);

  // Anyone selected this cycle is eligible by the last day of it.
  const cohortByEndOfCycle = (cycle = 0, rate = 0.1) =>
    users.filter((u) =>
      inSampledCohort(u, rate, day(cycleStart + cycle * CYCLE_DAYS + 89)),
    );

  it("never samples when the rate is 0 or the user is unknown", () => {
    expect(inSampledCohort("usr_1", 0)).toBe(false);
    expect(inSampledCohort(undefined, 0.5)).toBe(false);
    expect(inSampledCohort("", 1)).toBe(false);
  });

  it("always samples at a rate of 1", () => {
    expect(inSampledCohort("usr_1", 1)).toBe(true);
  });

  it("is deterministic for the same user and day", () => {
    const a = inSampledCohort("usr_42", 0.5, day(cycleStart + 10));
    const b = inSampledCohort("usr_42", 0.5, day(cycleStart + 10));
    expect(a).toBe(b);
  });

  it("samples roughly the configured share of users over a cycle", () => {
    const rate = 0.1;
    const share = cohortByEndOfCycle(0, rate).length / users.length;
    expect(share).toBeGreaterThan(rate * 0.7);
    expect(share).toBeLessThan(rate * 1.3);
  });

  it("selects on identity, not on which days a user visits", () => {
    // The whole point of the redesign: a user's selection must not depend on
    // how often they load the app, or frequent visitors would be over-sampled.
    // Once a user's start day has passed, every later day in the cycle agrees.
    const rate = 0.2;
    const selected = users.filter((u) =>
      inSampledCohort(u, rate, day(cycleStart + 89)),
    );
    for (const u of selected.slice(0, 50)) {
      // Eligibility is monotonic to the end of the cycle, so a user who only
      // shows up on the final day still gets their turn.
      expect(inSampledCohort(u, rate, day(cycleStart + 89))).toBe(true);
    }
    // And a user's status on a given day never depends on prior visits, since
    // it is a pure function of (user, day).
    expect(inSampledCohort("usr_7", rate, day(cycleStart + 40))).toBe(
      inSampledCohort("usr_7", rate, day(cycleStart + 40)),
    );
  });

  it("staggers start days across the cycle instead of prompting everyone at once", () => {
    const rate = 0.5;
    const onFirstDay = users.filter((u) =>
      inSampledCohort(u, rate, day(cycleStart)),
    ).length;
    const byEndOfCycle = cohortByEndOfCycle(0, rate).length;
    // Only a small slice is live on day 1; the rest phase in over the cycle.
    expect(onFirstDay).toBeGreaterThan(0);
    expect(onFirstDay).toBeLessThan(byEndOfCycle / 5);
  });

  it("is sticky within a cycle: eligibility never flips back off", () => {
    const rate = 0.3;
    const u = users.find((x) =>
      inSampledCohort(x, rate, day(cycleStart + 45)),
    ) as string;
    for (let d = 45; d < CYCLE_DAYS; d++) {
      expect(inSampledCohort(u, rate, day(cycleStart + d))).toBe(true);
    }
  });

  it("re-rolls the cohort each cycle so it is not a permanent panel", () => {
    const a = cohortByEndOfCycle(0).join(",");
    const b = cohortByEndOfCycle(1).join(",");
    expect(a).not.toBe(b);
  });

  it("reaches users who were not selected in the first cycle", () => {
    const rate = 0.2;
    const missedFirst = users.filter(
      (u) => !inSampledCohort(u, rate, day(cycleStart + 89)),
    );
    const laterCycles = [1, 2, 3, 4, 5];
    const eventuallyReached = missedFirst.filter((u) =>
      laterCycles.some((c) =>
        inSampledCohort(u, rate, day(cycleStart + c * CYCLE_DAYS + 89)),
      ),
    );
    expect(eventuallyReached.length).toBeGreaterThan(0);
  });
});

// Pins the local FNV-1a copy to the GrowthBook SDK's v2 bucketing, generated by
// calling the SDK's own `hash(seed, value, 2)`. If these drift, cohort
// assignment stops matching feature rollouts and every sampled user re-rolls.
describe("hashToUnitInterval", () => {
  const HASH_GOLDEN: [string, string, number][] = [
    ["nps-select", "usr_1:0", 0.0439],
    ["nps-select", "usr_1:215", 0.6892],
    ["nps-stagger", "usr_1:215", 0.0698],
    ["nps-select", "usr_abc:7", 0.1596],
    ["nps-stagger", "usr_abc:7", 0.6635],
  ];

  it("matches the SDK's v2 bucketing", () => {
    for (const [seed, value, expected] of HASH_GOLDEN) {
      expect(hashToUnitInterval(seed, value)).toBe(expected);
    }
  });

  it("stays inside [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = hashToUnitInterval("nps-select", `usr_${i}:3`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
