import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureAttribution } from "@/services/attribution-capture";

const ORIGIN = "https://app.growthbook.io";

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
const originalCookie = Object.getOwnPropertyDescriptor(document, "cookie");
const originalReferrer = Object.getOwnPropertyDescriptor(document, "referrer");

// jsdom can't navigate, and window.history.replaceState is banned in front-end
// code, so swap in a URL — captureAttribution only reads origin/pathname/search.
function visit(path: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(`${ORIGIN}${path}`),
  });
}

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value,
  });
}

function installCookieJar() {
  let jar: string[] = [];
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => jar.join("; "),
    set: (value: string) => {
      const pair = value.split(";")[0];
      const name = pair.split("=")[0];
      jar = jar.filter((c) => !c.startsWith(`${name}=`));
      jar.push(pair);
    },
  });
}

function readGbAttr(): Record<string, string> | null {
  const m = document.cookie.match(/(?:^|; )gb_attr=([^;]*)/);
  if (!m) return null;
  return JSON.parse(decodeURIComponent(m[1])) as Record<string, string>;
}

describe("captureAttribution", () => {
  beforeEach(() => {
    installCookieJar();
    setReferrer("");
    visit("/");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalLocation) {
      Object.defineProperty(window, "location", originalLocation);
    }
    if (originalCookie) {
      Object.defineProperty(document, "cookie", originalCookie);
    }
    if (originalReferrer) {
      Object.defineProperty(document, "referrer", originalReferrer);
    }
  });

  it("stores UTMs and click IDs, including li_fat_id, and strips the query from landing_page", () => {
    setReferrer("https://www.linkedin.com/");
    visit(
      "/signup?utm_source=linkedin&utm_medium=cpc&li_fat_id=abc123&token=secret",
    );

    captureAttribution();

    expect(readGbAttr()).toEqual({
      utm_source: "linkedin",
      utm_medium: "cpc",
      li_fat_id: "abc123",
      referrer: "https://www.linkedin.com/",
      landing_page: `${ORIGIN}/signup`,
      touch_at: "2026-09-16T14:00:00.000Z",
    });
  });

  it("overwrites the cookie on a new paid-touch visit (last-touch)", () => {
    visit("/signup?utm_source=first");
    captureAttribution();
    expect(readGbAttr()?.utm_source).toBe("first");

    visit("/signup?utm_source=second&gclid=click");
    captureAttribution();

    const cookie = readGbAttr();
    expect(cookie?.utm_source).toBe("second");
    expect(cookie?.gclid).toBe("click");
    expect(cookie).not.toHaveProperty("li_fat_id");
  });

  it("keeps the existing cookie on a direct visit with no attribution params (first-touch)", () => {
    visit("/signup?utm_source=ads");
    captureAttribution();

    visit("/getstarted");
    captureAttribution();

    expect(readGbAttr()?.utm_source).toBe("ads");
    expect(readGbAttr()?.landing_page).toBe(`${ORIGIN}/signup`);
  });

  it("records a first visit even when there are no attribution params", () => {
    setReferrer("https://news.ycombinator.com/");
    visit("/getstarted");

    captureAttribution();

    expect(readGbAttr()).toEqual({
      referrer: "https://news.ycombinator.com/",
      landing_page: `${ORIGIN}/getstarted`,
      touch_at: "2026-09-16T14:00:00.000Z",
    });
  });
});
