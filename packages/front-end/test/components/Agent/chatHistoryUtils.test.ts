import type { ConversationSummary } from "@/enterprise/hooks/useAIChat";
import {
  getConversationGroupLabel,
  groupConversationsByRecency,
} from "@/components/Agent/chatHistoryUtils";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Local noon so day-boundary math is stable regardless of the test timezone.
const NOW = new Date(2026, 8, 17, 12, 0, 0).getTime();

function conv(id: string, createdAt: number): ConversationSummary {
  return {
    conversationId: id,
    title: id,
    createdAt,
    messageCount: 1,
    isStreaming: false,
    preview: "",
  };
}

describe("getConversationGroupLabel", () => {
  it("uses local calendar days, not rolling 24h windows", () => {
    expect(getConversationGroupLabel(NOW - 11 * HOUR, NOW)).toBe("Today");
    expect(getConversationGroupLabel(NOW - 13 * HOUR, NOW)).toBe("Yesterday");
  });

  it("assigns each bucket boundary", () => {
    expect(getConversationGroupLabel(NOW, NOW)).toBe("Today");
    expect(getConversationGroupLabel(NOW - 1 * DAY, NOW)).toBe("Yesterday");
    expect(getConversationGroupLabel(NOW - 2 * DAY, NOW)).toBe(
      "Previous 7 days",
    );
    expect(getConversationGroupLabel(NOW - 7 * DAY, NOW)).toBe(
      "Previous 7 days",
    );
    expect(getConversationGroupLabel(NOW - 8 * DAY, NOW)).toBe(
      "Previous 30 days",
    );
    expect(getConversationGroupLabel(NOW - 30 * DAY, NOW)).toBe(
      "Previous 30 days",
    );
    expect(getConversationGroupLabel(NOW - 31 * DAY, NOW)).toBe("Older");
  });

  it("uses calendar-day boundaries across daylight-saving changes", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";

    try {
      const afterSpringForward = new Date(2026, 2, 9, 12).getTime();
      const saturdayBefore = new Date(2026, 2, 7, 23, 30).getTime();
      expect(
        getConversationGroupLabel(saturdayBefore, afterSpringForward),
      ).toBe("Previous 7 days");

      const afterFallBack = new Date(2026, 10, 2, 12).getTime();
      const sundayStart = new Date(2026, 10, 1, 0, 30).getTime();
      expect(getConversationGroupLabel(sundayStart, afterFallBack)).toBe(
        "Yesterday",
      );
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});

describe("groupConversationsByRecency", () => {
  it("returns groups in recency order, skipping empty buckets", () => {
    const groups = groupConversationsByRecency(
      [
        conv("older", NOW - 90 * DAY),
        conv("today-a", NOW - HOUR),
        conv("today-b", NOW - 2 * HOUR),
        conv("week", NOW - 3 * DAY),
      ],
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Previous 7 days",
      "Older",
    ]);
    expect(groups[0].conversations.map((c) => c.conversationId)).toEqual([
      "today-a",
      "today-b",
    ]);
  });

  it("returns an empty list for no conversations", () => {
    expect(groupConversationsByRecency([], NOW)).toEqual([]);
  });
});
