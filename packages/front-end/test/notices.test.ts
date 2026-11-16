import { AppNotice, rankNotices } from "@/components/Notices/notices";

const notice = (
  id: string,
  severity: AppNotice["severity"],
  priority?: number,
): AppNotice => ({ id, severity, priority, title: id });

describe("rankNotices", () => {
  it("puts errors first, then higher priority, then the given order", () => {
    expect(
      rankNotices([
        notice("usage", "warning"),
        notice("tokens", "error"),
        notice("trial", "warning", 1),
        notice("payload", "error"),
        notice("license", "error", 1),
      ]).map((n) => n.id),
    ).toEqual(["license", "tokens", "payload", "trial", "usage"]);
  });
});
