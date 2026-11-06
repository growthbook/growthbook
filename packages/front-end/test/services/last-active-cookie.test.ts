import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isGrowthBookHost,
  recordLastActive,
} from "@/services/last-active-cookie";

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
const originalCookie = Object.getOwnPropertyDescriptor(document, "cookie");

let writes: string[] = [];

function visit(origin: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(`${origin}/`),
  });
}

describe("isGrowthBookHost", () => {
  it("matches growthbook.io and its subdomains only", () => {
    expect(isGrowthBookHost("growthbook.io")).toBe(true);
    expect(isGrowthBookHost("app.growthbook.io")).toBe(true);
    expect(isGrowthBookHost("localhost")).toBe(false);
    expect(isGrowthBookHost("growthbook.example.com")).toBe(false);
    expect(isGrowthBookHost("evilgrowthbook.io")).toBe(false);
  });
});

describe("recordLastActive", () => {
  beforeEach(() => {
    writes = [];
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: (value: string) => {
        writes.push(value);
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalLocation) {
      Object.defineProperty(window, "location", originalLocation);
    }
    if (originalCookie) {
      Object.defineProperty(document, "cookie", originalCookie);
    }
  });

  it("writes a shared timestamp cookie on growthbook.io", () => {
    visit("https://app.growthbook.io");
    recordLastActive();
    expect(writes).toEqual([
      "gb_last_active=2026-11-06T14%3A00%3A00.000Z; Domain=.growthbook.io; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    ]);
  });

  it("does nothing on self-hosted domains", () => {
    visit("https://growthbook.example.com");
    recordLastActive();
    expect(writes).toEqual([]);
  });
});
