import {
  categoryOf,
  npsValue,
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
