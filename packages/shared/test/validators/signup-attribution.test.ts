import {
  attributionCookieSchema,
  signupAttributionPayloadSchema,
} from "../../src/validators/signup-attribution";

describe("attributionCookieSchema", () => {
  it("accepts known click IDs including Google and LinkedIn tags", () => {
    const parsed = attributionCookieSchema.parse({
      utm_source: "linkedin",
      li_fat_id: "abc123",
      gclid: "g",
      gbraid: "gb",
      wbraid: "wb",
      fbclid: "f",
      msclkid: "m",
    });
    expect(parsed.li_fat_id).toBe("abc123");
    expect(parsed.gbraid).toBe("gb");
    expect(parsed.wbraid).toBe("wb");
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
