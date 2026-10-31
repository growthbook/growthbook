import { pageLoadValidator } from "../src/validators/page-load";

const valid = {
  route: "/features/[fid]",
  navigationType: "navigate",
  build: "abc1234",
  responseStart: 120,
  domContentLoaded: 450,
  pageMounted: 1200,
  pageReady: 1500,
  requests: {
    init: { start: 300, end: 340, bytes: 900 },
    organization: { start: 500, end: 800, bytes: 0 },
    feature: { start: 520, end: 1100 },
  },
};

describe("pageLoadValidator", () => {
  it("accepts a full report", () => {
    expect(pageLoadValidator.safeParse(valid).success).toBe(true);
  });

  it("accepts a minimal report", () => {
    const minimal = {
      route: "/",
      navigationType: "reload",
      build: "",
      responseStart: 0,
      domContentLoaded: 0,
      pageMounted: 0,
      requests: {},
    };
    expect(pageLoadValidator.safeParse(minimal).success).toBe(true);
  });

  it("refuses unknown fields at any level", () => {
    expect(pageLoadValidator.safeParse({ ...valid, extra: 1 }).success).toBe(
      false,
    );
    expect(
      pageLoadValidator.safeParse({
        ...valid,
        requests: { ...valid.requests, other: { start: 1, end: 2 } },
      }).success,
    ).toBe(false);
    expect(
      pageLoadValidator.safeParse({
        ...valid,
        requests: { user: { start: 1, end: 2, extra: true } },
      }).success,
    ).toBe(false);
  });

  it("refuses times that are negative, fractional or over ten minutes", () => {
    for (const pageMounted of [-1, 1.5, 600_001]) {
      expect(
        pageLoadValidator.safeParse({ ...valid, pageMounted }).success,
      ).toBe(false);
    }
    expect(
      pageLoadValidator.safeParse({ ...valid, pageMounted: 600_000 }).success,
    ).toBe(true);
    expect(
      pageLoadValidator.safeParse({
        ...valid,
        requests: { user: { start: 1, end: 700_000 } },
      }).success,
    ).toBe(false);
  });

  it("checks bytes", () => {
    for (const bytes of [-1, 0.5, 1_000_000_001]) {
      expect(
        pageLoadValidator.safeParse({
          ...valid,
          requests: { user: { start: 1, end: 2, bytes } },
        }).success,
      ).toBe(false);
    }
  });

  it("checks the route pattern", () => {
    for (const route of ["features", "/a b", "/x?y=1", "/" + "a".repeat(100)]) {
      expect(pageLoadValidator.safeParse({ ...valid, route }).success).toBe(
        false,
      );
    }
    expect(
      pageLoadValidator.safeParse({ ...valid, route: "/[...slug]" }).success,
    ).toBe(true);
  });

  it("checks the build and navigation type", () => {
    expect(
      pageLoadValidator.safeParse({ ...valid, build: "a".repeat(41) }).success,
    ).toBe(false);
    expect(
      pageLoadValidator.safeParse({ ...valid, build: "abc/123" }).success,
    ).toBe(false);
    expect(
      pageLoadValidator.safeParse({ ...valid, navigationType: "other" })
        .success,
    ).toBe(false);
  });
});
