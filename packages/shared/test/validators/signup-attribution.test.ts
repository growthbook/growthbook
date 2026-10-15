import {
  attributionCookieSchema,
  signupAttributionPayloadSchema,
} from "../../src/validators/signup-attribution";

describe("attributionCookieSchema", () => {
  it("accepts known click IDs including li_fat_id", () => {
    const parsed = attributionCookieSchema.parse({
      utm_source: "linkedin",
      li_fat_id: "abc123",
      gclid: "g",
      fbclid: "f",
      msclkid: "m",
    });
    expect(parsed.li_fat_id).toBe("abc123");
  });

  it("passes through unknown keys so new cookie fields do not fail parse", () => {
    const parsed = attributionCookieSchema.parse({
      utm_source: "ads",
      future_click_id: "x",
    });
    expect(parsed).toEqual({
      utm_source: "ads",
      future_click_id: "x",
    });
  });
});

describe("attributionCookieSchema first_touch", () => {
  it("parses first_touch alongside the last-touch fields", () => {
    const parsed = attributionCookieSchema.parse({
      utm_source: "docs",
      first_touch: { utm_source: "google", gclid: "g" },
    });
    expect(parsed.first_touch).toEqual({ utm_source: "google", gclid: "g" });
  });

  it("drops a malformed first_touch instead of failing the cookie", () => {
    const result = attributionCookieSchema.safeParse({
      utm_source: "docs",
      first_touch: "not-an-object",
    });
    expect(result.success).toBe(true);
    expect(result.data?.utm_source).toBe("docs");
    expect(result.data?.first_touch).toBeUndefined();
  });
});

describe("signupAttributionPayloadSchema", () => {
  it("accepts a full payload", () => {
    const result = signupAttributionPayloadSchema.safeParse({
      organizationId: "org_1",
      userId: "usr_1",
      email: "a@growthbook.io",
      emailType: "business",
      attribution: { utm_source: "linkedin", li_fat_id: "abc123" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects extra top-level keys", () => {
    const result = signupAttributionPayloadSchema.safeParse({
      organizationId: "org_1",
      userId: "usr_1",
      email: "a@growthbook.io",
      emailType: "free",
      attribution: {},
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});
