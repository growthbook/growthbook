import { isWithinUserAgeWindow } from "@/components/Marketing/MarketingBanner";

const now = new Date("2026-08-24T12:00:00.000Z").getTime();
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000);

describe("isWithinUserAgeWindow", () => {
  it("shows to everyone when no window is configured", () => {
    expect(isWithinUserAgeWindow({ userDateCreated: daysAgo(500), now })).toBe(
      true,
    );
    expect(
      isWithinUserAgeWindow({
        userDateCreated: daysAgo(500),
        maxUserAgeDays: 0,
        now,
      }),
    ).toBe(true);
    expect(
      isWithinUserAgeWindow({
        maxUserAgeDays: -5,
        now,
      }),
    ).toBe(true);
  });

  it("includes users created inside the rolling window", () => {
    expect(
      isWithinUserAgeWindow({
        userDateCreated: daysAgo(3),
        maxUserAgeDays: 30,
        now,
      }),
    ).toBe(true);
  });

  it("includes a user exactly at the window boundary", () => {
    expect(
      isWithinUserAgeWindow({
        userDateCreated: daysAgo(30),
        maxUserAgeDays: 30,
        now,
      }),
    ).toBe(true);
  });

  it("excludes users older than the window", () => {
    expect(
      isWithinUserAgeWindow({
        userDateCreated: daysAgo(31),
        maxUserAgeDays: 30,
        now,
      }),
    ).toBe(false);
  });

  it("excludes users with a missing or unparseable creation date", () => {
    expect(isWithinUserAgeWindow({ maxUserAgeDays: 30, now })).toBe(false);
    expect(
      isWithinUserAgeWindow({
        userDateCreated: new Date("not-a-date"),
        maxUserAgeDays: 30,
        now,
      }),
    ).toBe(false);
  });
});
