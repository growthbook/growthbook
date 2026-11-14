import { getTrackingPageUrl, maskClaimToken } from "@/services/track";

vi.mock("@/services/UserContext", () => ({
  getCurrentUser: () => ({ org: "org_1" }),
}));

const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

describe("maskClaimToken", () => {
  it("takes the token out of a claim link's path", () => {
    expect(maskClaimToken(`/claim/${token}`)).toBe("/claim/[token]");
  });

  it("keeps the rest of a full URL", () => {
    expect(
      maskClaimToken(`https://app.growthbook.io/claim/${token}?org=org_1#top`),
    ).toBe("https://app.growthbook.io/claim/[token]?org=org_1#top");
  });

  it("leaves every other page alone", () => {
    expect(maskClaimToken("/features/newCheckout")).toBe(
      "/features/newCheckout",
    );
    expect(maskClaimToken("/claim")).toBe("/claim");
  });
});

describe("getTrackingPageUrl", () => {
  const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

  afterEach(() => {
    if (originalLocation) {
      Object.defineProperty(window, "location", originalLocation);
    }
  });

  it("reports the claim page without the link's token", () => {
    // jsdom can't navigate, so swap in a URL, as the other tracking tests do.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL(`https://app.growthbook.io/claim/${token}`),
    });
    expect(getTrackingPageUrl()).not.toContain(token);
    expect(getTrackingPageUrl().endsWith("/claim/[token]")).toBe(true);
  });
});
