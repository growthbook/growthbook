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

type GbAttr = Record<string, string> & {
  first_touch?: Record<string, string>;
};

function readGbAttr(): GbAttr | null {
  const m = document.cookie.match(/(?:^|; )gb_attr=([^;]*)/);
  if (!m) return null;
  return JSON.parse(decodeURIComponent(m[1])) as GbAttr;
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

    const touch = {
      utm_source: "linkedin",
      utm_medium: "cpc",
      li_fat_id: "abc123",
      referrer: "https://www.linkedin.com/",
      landing_page: `${ORIGIN}/signup`,
      touch_at: "2026-09-16T14:00:00.000Z",
    };
    // On the first visit, the first and last touch are the same
    expect(readGbAttr()).toEqual({ ...touch, first_touch: touch });
  });

  it("replaces the last touch on a new UTM visit but keeps the first touch", () => {
    visit("/signup?utm_source=first&gclid=click");
    captureAttribution();

    vi.setSystemTime(new Date("2026-09-20T09:00:00.000Z"));
    visit("/?utm_source=docs&utm_medium=navbar");
    captureAttribution();

    const cookie = readGbAttr();
    expect(cookie).toMatchObject({
      utm_source: "docs",
      utm_medium: "navbar",
      touch_at: "2026-09-20T09:00:00.000Z",
    });
    expect(cookie).not.toHaveProperty("gclid");
    expect(cookie?.first_touch).toMatchObject({
      utm_source: "first",
      gclid: "click",
      touch_at: "2026-09-16T14:00:00.000Z",
    });
  });

  it("keeps the first touch across several UTM visits", () => {
    visit("/?utm_source=newsletter");
    captureAttribution();
    visit("/?utm_source=google");
    captureAttribution();
    visit("/?utm_source=docs");
    captureAttribution();

    const cookie = readGbAttr();
    expect(cookie?.utm_source).toBe("docs");
    expect(cookie?.first_touch).toMatchObject({ utm_source: "newsletter" });
  });

  it("leaves the cookie alone on a direct visit with no attribution params", () => {
    visit("/signup?utm_source=ads");
    captureAttribution();
    const before = readGbAttr();

    visit("/getstarted");
    captureAttribution();

    expect(readGbAttr()).toEqual(before);
  });

  it("records a first visit even when there are no attribution params", () => {
    setReferrer("https://news.ycombinator.com/");
    visit("/getstarted");

    captureAttribution();

    const touch = {
      referrer: "https://news.ycombinator.com/",
      landing_page: `${ORIGIN}/getstarted`,
      touch_at: "2026-09-16T14:00:00.000Z",
    };
    expect(readGbAttr()).toEqual({ ...touch, first_touch: touch });
  });

  it("treats a cookie written before first_touch existed as the first touch", () => {
    const legacy = {
      utm_source: "linkedin",
      li_fat_id: "abc",
      touch_at: "2026-08-01T00:00:00.000Z",
    };
    document.cookie = `gb_attr=${encodeURIComponent(JSON.stringify(legacy))}`;

    visit("/?utm_source=docs");
    captureAttribution();

    const cookie = readGbAttr();
    expect(cookie?.utm_source).toBe("docs");
    expect(cookie?.first_touch).toEqual(legacy);
  });

  it("replaces a cookie that isn't valid JSON", () => {
    document.cookie = "gb_attr=not-json";

    visit("/?utm_source=docs");
    captureAttribution();

    const cookie = readGbAttr();
    expect(cookie?.utm_source).toBe("docs");
    expect(cookie?.first_touch).toMatchObject({ utm_source: "docs" });
  });
});
