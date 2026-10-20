import { AppNotice } from "@/components/Notices/notices";
import {
  asHeading,
  asSentence,
  isDismissible,
  noticeSignature,
  routeHeaderNotices,
} from "@/components/Notices/headerNotices";

const notice = (
  id: string,
  severity: AppNotice["severity"],
  extra: Partial<AppNotice> = {},
): AppNotice => ({ id, severity, title: id, ...extra });

describe("routeHeaderNotices", () => {
  it("gives the banner the top error, the others behind it, and lists only warnings", () => {
    const routed = routeHeaderNotices([
      notice("cdn-usage", "warning"),
      notice("api-key-expiry", "error"),
      notice("sdk-payload-size", "error"),
      notice("license", "warning", {
        priority: 1,
        trial: { plan: "pro", daysLeft: 5 },
      }),
      notice("managed-warehouse-usage", "error"),
    ]);
    expect(routed.banner?.id).toEqual("sdk-payload-size");
    expect(routed.bannerMore.map((n) => n.id)).toEqual([
      "managed-warehouse-usage",
      "api-key-expiry",
    ]);
    expect(routed.list.map((n) => n.id)).toEqual(["cdn-usage"]);
    expect(routed.trial?.id).toEqual("license");
  });

  it("puts account-wide errors first, then SDK updates, then seat quota", () => {
    const seats = notice("license", "error", { kind: "seat-quota" });
    expect(
      routeHeaderNotices([notice("cdn-usage", "error"), seats]).banner?.id,
    ).toEqual("cdn-usage");
    expect(
      routeHeaderNotices([
        notice("cdn-usage", "error"),
        notice("license", "error", { priority: 1 }),
      ]).banner?.id,
    ).toEqual("license");
    expect(routeHeaderNotices([seats]).banner).toBe(seats);
  });

  it("within a level, prefers an error the viewer can act on", () => {
    const notices = [
      notice("cdn-usage", "error"),
      notice("sdk-payload-size", "error", { href: "/sdks" }),
    ];
    expect(routeHeaderNotices(notices).banner?.id).toEqual("cdn-usage");
    expect(routeHeaderNotices(notices, (n) => !!n.href).banner?.id).toEqual(
      "sdk-payload-size",
    );
  });

  it("has no banner with only warnings", () => {
    expect(
      routeHeaderNotices([
        notice("cdn-usage", "warning"),
        notice("api-key-expiry", "warning"),
      ]).banner,
    ).toBeNull();
  });

  it("puts expired keys below the SDK errors and above seat quota", () => {
    const keys = notice("api-key-expiry", "error");
    const seats = notice("license", "error", { kind: "seat-quota" });
    const cdn = notice("cdn-usage", "error");
    expect(routeHeaderNotices([seats, keys]).banner).toBe(keys);
    expect(routeHeaderNotices([keys, cdn]).banner).toBe(cdn);
  });
});

describe("closing the banner", () => {
  const cdn = notice("cdn-usage", "error");
  const warehouse = notice("managed-warehouse-usage", "error");
  const payload = notice("sdk-payload-size", "error", { href: "/sdks" });
  const license = notice("license", "error", { priority: 1 });
  const canAct = (n: AppNotice) => !!n.href;

  it("is offered only to people who can't act, and never for the license", () => {
    expect(routeHeaderNotices([cdn], canAct).bannerDismissible).toBe(true);
    expect(routeHeaderNotices([payload], canAct).bannerDismissible).toBe(false);
    expect(routeHeaderNotices([license], canAct).bannerDismissible).toBe(false);
  });

  it("lists the other errors behind the banner, and offers closing only when it's alone", () => {
    const both = routeHeaderNotices([cdn, warehouse], canAct);
    expect(both.banner).toBe(cdn);
    expect(both.bannerMore).toEqual([warehouse]);
    expect(both.bannerDismissible).toBe(false);
    // Closed while alone: gone; another error joining brings it back.
    expect(
      routeHeaderNotices([cdn], canAct, noticeSignature(cdn)).banner,
    ).toBeNull();
    expect(
      routeHeaderNotices([cdn, warehouse], canAct, noticeSignature(cdn)).banner,
    ).toBe(cdn);
  });

  it("comes back when the error changes", () => {
    const over = notice("cdn-usage", "error", { title: "CDN over" });
    expect(
      routeHeaderNotices([over], canAct, noticeSignature(cdn)).banner,
    ).toBe(over);
  });
});

describe("the trial", () => {
  it("stays out of the banner and the list, for its own pill", () => {
    const trial = notice("license", "warning", {
      priority: 1,
      trial: { plan: "pro", daysLeft: 5 },
    });
    const routed = routeHeaderNotices([trial]);
    expect(routed.banner).toBeNull();
    expect(routed.list).toEqual([]);
    expect(routed.trial).toBe(trial);
  });
});

describe("dismissal", () => {
  it("only lets warnings be dismissed, keyed by their state", () => {
    expect(isDismissible(notice("a", "warning"))).toBe(true);
    expect(isDismissible(notice("a", "error"))).toBe(false);
    expect(noticeSignature(notice("a", "warning"))).not.toEqual(
      noticeSignature(notice("a", "warning", { title: "2 expiring keys" })),
    );
  });
});

describe("asSentence", () => {
  it("capitalizes the first letter and ends with a full stop", () => {
    expect(asSentence("license server unreachable")).toBe(
      "License server unreachable.",
    );
    expect(asSentence("Pro trial ends in 12 days")).toBe(
      "Pro trial ends in 12 days.",
    );
    expect(asSentence("Contact sales@growthbook.io to renew.")).toBe(
      "Contact sales@growthbook.io to renew.",
    );
    expect(asSentence("Fix within 4 days!")).toBe("Fix within 4 days!");
  });
});

describe("asHeading", () => {
  it("capitalizes the first letter, with no full stop added", () => {
    expect(asHeading("license server unreachable")).toBe(
      "License server unreachable",
    );
  });
});
