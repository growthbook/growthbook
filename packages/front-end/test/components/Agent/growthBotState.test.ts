import {
  formatResetsIn,
  getGrowthBotState,
} from "@/components/Agent/growthBotState";

describe("getGrowthBotState", () => {
  it("is default without usage, or under the daily limit", () => {
    expect(getGrowthBotState({})).toBe("default");
    expect(getGrowthBotState({ tokenUsage: null })).toBe("default");
    expect(
      getGrowthBotState({
        tokenUsage: { numTokensUsed: 10, dailyLimit: 1_000_000 },
      }),
    ).toBe("default");
  });

  it("is limit when today's usage reaches the daily limit", () => {
    expect(
      getGrowthBotState({
        tokenUsage: { numTokensUsed: 1_000_000, dailyLimit: 1_000_000 },
      }),
    ).toBe("limit");
  });

  it("has no limit without a daily limit", () => {
    expect(
      getGrowthBotState({
        tokenUsage: { numTokensUsed: 5_000_000, dailyLimit: null },
      }),
    ).toBe("default");
  });
});

describe("formatResetsIn", () => {
  const now = 1_000_000_000;
  const minute = 60_000;

  it("counts hours", () => {
    expect(formatResetsIn(now + 5 * 60 * minute, now)).toBe("in 5 hours");
    expect(formatResetsIn(now + 60 * minute, now)).toBe("in 1 hour");
  });

  it("counts minutes under an hour", () => {
    expect(formatResetsIn(now + 40 * minute, now)).toBe("in 40 minutes");
    expect(formatResetsIn(now + 30_000, now)).toBe("in 1 minute");
  });

  it("is less than a minute once due", () => {
    expect(formatResetsIn(now - 1000, now)).toBe("in less than a minute");
  });
});
