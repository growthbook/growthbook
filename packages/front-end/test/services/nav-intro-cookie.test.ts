import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissNavIntro,
  hasDismissedNavIntro,
  NAV_INTRO_COOKIE,
} from "@/services/nav-intro-cookie";

const originalCookie = Object.getOwnPropertyDescriptor(document, "cookie");

function installCookieJar(): string[] {
  const writes: string[] = [];
  let jar: string[] = [];
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => jar.join("; "),
    set: (value: string) => {
      writes.push(value);
      const pair = value.split(";")[0];
      const name = pair.split("=")[0];
      jar = jar.filter((c) => !c.startsWith(`${name}=`));
      jar.push(pair);
    },
  });
  return writes;
}

describe("nav intro cookie", () => {
  let writes: string[];

  beforeEach(() => {
    writes = installCookieJar();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalCookie) {
      Object.defineProperty(document, "cookie", originalCookie);
    }
  });

  it("is not dismissed in a browser without the cookie", () => {
    expect(hasDismissedNavIntro()).toBe(false);
  });

  it("stays dismissed after it is dismissed once", () => {
    dismissNavIntro();
    expect(hasDismissedNavIntro()).toBe(true);
  });

  it("counts a cookie set by a test script as dismissed", () => {
    document.cookie = `${NAV_INTRO_COOKIE}=1; path=/`;
    expect(hasDismissedNavIntro()).toBe(true);
  });

  it("writes a site-wide, lax cookie that lasts the 400 days Chrome allows", () => {
    dismissNavIntro();
    expect(writes).toHaveLength(1);
    const attrs = writes[0].split("; ");
    expect(attrs[0]).toBe("gb_nav_intro_dismissed=1");
    expect(attrs).toContain("path=/");
    expect(attrs).toContain("sameSite=lax");
    expect(attrs).toContain("expires=Thu, 23 Dec 2027 12:00:00 GMT");
  });
});
