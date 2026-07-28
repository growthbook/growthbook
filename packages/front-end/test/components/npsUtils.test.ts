import {
  categoryOf,
  inSampledCohort,
  meetsMinimumTenure,
  npsValue,
  parseSampleRate,
  withinCooldown,
} from "@/components/NPSSurvey/nps.utils";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("categoryOf", () => {
  it("classifies detractors (0-6)", () => {
    for (const s of [0, 1, 5, 6]) expect(categoryOf(s)).toBe("detractor");
  });
  it("classifies passives (7-8)", () => {
    expect(categoryOf(7)).toBe("passive");
    expect(categoryOf(8)).toBe("passive");
  });
  it("classifies promoters (9-10)", () => {
    expect(categoryOf(9)).toBe("promoter");
    expect(categoryOf(10)).toBe("promoter");
  });
});

describe("npsValue", () => {
  it("is -1 for detractors, 0 for passives, +1 for promoters", () => {
    expect(npsValue(6)).toBe(-1);
    expect(npsValue(0)).toBe(-1);
    expect(npsValue(7)).toBe(0);
    expect(npsValue(8)).toBe(0);
    expect(npsValue(9)).toBe(1);
    expect(npsValue(10)).toBe(1);
  });

  it("agrees with categoryOf at every score boundary", () => {
    for (let s = 0; s <= 10; s++) {
      const cat = categoryOf(s);
      const expected = cat === "promoter" ? 1 : cat === "detractor" ? -1 : 0;
      expect(npsValue(s)).toBe(expected);
    }
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

  it("returns true inside the 90-day window", () => {
    const recent = new Date(Date.now() - 1 * DAY_MS).toISOString();
    expect(withinCooldown(recent)).toBe(true);
    const almostExpired = new Date(Date.now() - 89 * DAY_MS).toISOString();
    expect(withinCooldown(almostExpired)).toBe(true);
  });

  it("returns false once the 90-day window has passed", () => {
    const expired = new Date(Date.now() - 91 * DAY_MS).toISOString();
    expect(withinCooldown(expired)).toBe(false);
  });
});

describe("parseSampleRate", () => {
  it("treats a 0-1 value as a fraction", () => {
    expect(parseSampleRate(0.05)).toBe(0.05);
    expect(parseSampleRate(1)).toBe(1);
  });

  it("treats a value above 1 as a percentage", () => {
    expect(parseSampleRate(5)).toBe(0.05);
    expect(parseSampleRate(100)).toBe(1);
  });

  it("clamps out-of-range values", () => {
    expect(parseSampleRate(250)).toBe(1);
    expect(parseSampleRate(-1)).toBe(0);
  });

  it("honors the flag's original boolean shape", () => {
    expect(parseSampleRate(true)).toBe(1);
    expect(parseSampleRate(false)).toBe(0);
  });

  it("fails closed on unexpected values", () => {
    expect(parseSampleRate(undefined)).toBe(0);
    expect(parseSampleRate(null)).toBe(0);
    expect(parseSampleRate("5")).toBe(0);
    expect(parseSampleRate({})).toBe(0);
    expect(parseSampleRate(NaN)).toBe(0);
  });
});

describe("meetsMinimumTenure", () => {
  it("excludes orgs younger than the minimum", () => {
    expect(
      meetsMinimumTenure(new Date(Date.now() - 3 * DAY_MS).toISOString()),
    ).toBe(false);
  });

  it("includes orgs older than the minimum", () => {
    expect(
      meetsMinimumTenure(new Date(Date.now() - 30 * DAY_MS).toISOString()),
    ).toBe(true);
  });

  it("fails closed on missing or invalid dates", () => {
    expect(meetsMinimumTenure()).toBe(false);
    expect(meetsMinimumTenure(null)).toBe(false);
    expect(meetsMinimumTenure("nonsense")).toBe(false);
  });
});

describe("inSampledCohort", () => {
  const day = (n: number) => new Date(n * DAY_MS);

  it("never samples when the rate is 0 or the user is unknown", () => {
    expect(inSampledCohort("usr_1", 0)).toBe(false);
    expect(inSampledCohort(undefined, 0.5)).toBe(false);
    expect(inSampledCohort("", 1)).toBe(false);
  });

  it("always samples at a rate of 1", () => {
    expect(inSampledCohort("usr_1", 1)).toBe(true);
  });

  it("is deterministic for the same user and day", () => {
    const a = inSampledCohort("usr_42", 0.5, day(20000));
    const b = inSampledCohort("usr_42", 0.5, day(20000));
    expect(a).toBe(b);
  });

  it("samples roughly the configured share of users", () => {
    const rate = 0.1;
    const n = 4000;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      if (inSampledCohort(`usr_${i}`, rate, day(20000))) hits++;
    }
    // Allow generous slack; this asserts the ballpark, not exact distribution.
    expect(hits / n).toBeGreaterThan(rate * 0.5);
    expect(hits / n).toBeLessThan(rate * 1.5);
  });

  it("rotates the cohort across days so it is not a fixed panel", () => {
    const rate = 0.2;
    const users = Array.from({ length: 500 }, (_, i) => `usr_${i}`);
    const cohortFor = (d: number) =>
      users.filter((u) => inSampledCohort(u, rate, day(d))).join(",");
    const dayA = cohortFor(20000);
    const dayB = cohortFor(20001);
    expect(dayA).not.toBe(dayB);
  });

  it("eventually reaches users who were not sampled on day one", () => {
    const rate = 0.2;
    const user = "usr_rotation";
    const days = Array.from({ length: 60 }, (_, i) =>
      inSampledCohort(user, rate, day(20000 + i)),
    );
    // Over a couple of months a given user should come up at least once.
    expect(days.some(Boolean)).toBe(true);
  });
});
