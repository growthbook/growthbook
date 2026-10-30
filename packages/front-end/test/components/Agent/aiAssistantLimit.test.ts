import {
  formatResetsIn,
  isAiAssistantLimitReached,
} from "@/components/Agent/aiAssistantLimit";

describe("isAiAssistantLimitReached", () => {
  it("is false without usage, or under the daily limit", () => {
    expect(isAiAssistantLimitReached(undefined)).toBe(false);
    expect(isAiAssistantLimitReached(null)).toBe(false);
    expect(
      isAiAssistantLimitReached({ numTokensUsed: 10, dailyLimit: 1_000_000 }),
    ).toBe(false);
  });

  it("is true when today's usage reaches the daily limit", () => {
    expect(
      isAiAssistantLimitReached({
        numTokensUsed: 1_000_000,
        dailyLimit: 1_000_000,
      }),
    ).toBe(true);
  });

  it("is false without a daily limit", () => {
    expect(
      isAiAssistantLimitReached({ numTokensUsed: 5_000_000, dailyLimit: null }),
    ).toBe(false);
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
