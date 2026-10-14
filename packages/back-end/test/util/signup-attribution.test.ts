import {
  classifyEmail,
  getOrgSignupAttribution,
  parseAttributionCookie,
  reissueAttributionCookie,
} from "back-end/src/util/signup-attribution";

describe("classifyEmail", () => {
  it("classifies known free domains as free", () => {
    expect(classifyEmail("person@gmail.com")).toBe("free");
    expect(classifyEmail("Person@Gmail.COM")).toBe("free");
  });

  it("classifies other domains as business", () => {
    expect(classifyEmail("a@growthbook.io")).toBe("business");
  });
});

describe("parseAttributionCookie", () => {
  it("returns an empty object when the cookie is missing", () => {
    expect(parseAttributionCookie({ cookies: {} })).toEqual({});
    expect(parseAttributionCookie({})).toEqual({});
  });

  it("returns an empty object for invalid JSON", () => {
    expect(
      parseAttributionCookie({ cookies: { gb_attr: "not-json" } }),
    ).toEqual({});
  });

  it("parses known fields including li_fat_id and passes through extras", () => {
    const raw = JSON.stringify({
      utm_source: "linkedin",
      li_fat_id: "abc123",
      extra: "kept",
    });
    expect(parseAttributionCookie({ cookies: { gb_attr: raw } })).toEqual({
      utm_source: "linkedin",
      li_fat_id: "abc123",
      extra: "kept",
    });
  });
});

describe("getOrgSignupAttribution", () => {
  it("returns undefined when there is nothing to store", () => {
    expect(getOrgSignupAttribution({})).toBeUndefined();
    expect(getOrgSignupAttribution({ utm_source: "" })).toBeUndefined();
  });

  it("keeps known fields and drops unknown passthrough keys", () => {
    expect(
      getOrgSignupAttribution({
        utm_source: "docs",
        utm_medium: "navbar",
        utm_content: "start-for-free",
        referrer: "https://docs.growthbook.io/",
        landing_page: "https://app.growthbook.io/",
        extra: "dropped",
      }),
    ).toEqual({
      utm_source: "docs",
      utm_medium: "navbar",
      utm_content: "start-for-free",
      referrer: "https://docs.growthbook.io/",
      landing_page: "https://app.growthbook.io/",
    });
  });
});

describe("reissueAttributionCookie", () => {
  it("does nothing when the cookie is missing", () => {
    const cookie = jest.fn();
    reissueAttributionCookie({ cookies: {} }, { cookie });
    expect(cookie).not.toHaveBeenCalled();
  });

  it("reissues the raw cookie with the shared Domain and 30-day maxAge", () => {
    const cookie = jest.fn();
    const raw = JSON.stringify({ utm_source: "linkedin", li_fat_id: "abc" });
    reissueAttributionCookie({ cookies: { gb_attr: raw } }, { cookie });

    expect(cookie).toHaveBeenCalledWith("gb_attr", raw, {
      domain: ".growthbook.io",
      path: "/",
      maxAge: 30 * 86400 * 1000,
      sameSite: "lax",
      secure: true,
      httpOnly: false,
    });
  });
});
