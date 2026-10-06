import { datetime } from "shared/dates";
import { formatCommentTime } from "@/components/Comments/commentTime";

describe("formatCommentTime", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const before = (seconds: number) =>
    new Date(now.getTime() - seconds * 1000).toISOString();

  it("says Just now under a minute", () => {
    expect(formatCommentTime(before(0), now)).toBe("Just now");
    expect(formatCommentTime(before(59), now)).toBe("Just now");
  });

  it("counts minutes under an hour", () => {
    expect(formatCommentTime(before(60), now)).toBe("1 min. ago");
    expect(formatCommentTime(before(15 * 60), now)).toBe("15 min. ago");
    expect(formatCommentTime(before(59 * 60 + 59), now)).toBe("59 min. ago");
  });

  it("counts hours under a day", () => {
    expect(formatCommentTime(before(3600), now)).toBe("1 hr. ago");
    expect(formatCommentTime(before(23 * 3600), now)).toBe("23 hr. ago");
  });

  it("shows the date and time once a day has passed", () => {
    const d = before(86400);
    expect(formatCommentTime(d, now)).toBe(datetime(new Date(d)));
  });

  it("shows the full date for a future time", () => {
    const d = new Date(now.getTime() + 60000).toISOString();
    expect(formatCommentTime(d, now)).toBe(datetime(new Date(d)));
  });
});
