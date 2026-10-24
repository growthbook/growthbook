import {
  formatResetsIn,
  getGrowthBotState,
} from "@/components/Agent/growthBotState";

const usable = {
  hasAISuggestions: true,
  aiSettingEnabled: true,
  aiUsable: true,
};

describe("getGrowthBotState", () => {
  it("is default when AI is usable and under any limit", () => {
    expect(getGrowthBotState(usable)).toBe("default");
    expect(
      getGrowthBotState({
        ...usable,
        tokenUsage: { numTokensUsed: 10, dailyLimit: 1_000_000 },
      }),
    ).toBe("default");
  });

  it("is not-in-plan without the AI feature, whatever the settings", () => {
    expect(getGrowthBotState({ ...usable, hasAISuggestions: false })).toBe(
      "not-in-plan",
    );
  });

  it("is off when the org's AI setting is off", () => {
    expect(
      getGrowthBotState({
        ...usable,
        aiSettingEnabled: false,
        aiUsable: false,
      }),
    ).toBe("off");
  });

  it("is no-key when the setting is on but AI can't be used", () => {
    expect(getGrowthBotState({ ...usable, aiUsable: false })).toBe("no-key");
  });

  it("is limit when today's usage reaches the daily limit", () => {
    expect(
      getGrowthBotState({
        ...usable,
        tokenUsage: { numTokensUsed: 1_000_000, dailyLimit: 1_000_000 },
      }),
    ).toBe("limit");
  });

  it("has no limit without a daily limit", () => {
    expect(
      getGrowthBotState({
        ...usable,
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
