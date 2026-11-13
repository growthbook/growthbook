import { resolvePremiumSdkSetting } from "back-end/src/util/sdkConnectionPremiumSettings";

describe("resolvePremiumSdkSetting", () => {
  describe("with the feature", () => {
    it("uses the requested value", () => {
      expect(
        resolvePremiumSdkSetting({
          requested: true,
          existing: false,
          hasFeature: true,
        }),
      ).toBe(true);
      expect(
        resolvePremiumSdkSetting({
          requested: false,
          existing: true,
          hasFeature: true,
        }),
      ).toBe(false);
    });

    it("keeps the existing value when the request leaves it out", () => {
      expect(
        resolvePremiumSdkSetting({
          requested: undefined,
          existing: true,
          hasFeature: true,
        }),
      ).toBe(true);
    });
  });

  describe("without the feature", () => {
    it("keeps a setting that is already on", () => {
      expect(
        resolvePremiumSdkSetting({
          requested: true,
          existing: true,
          hasFeature: false,
        }),
      ).toBe(true);
    });

    it("keeps a setting that is already on when the request leaves it out", () => {
      expect(
        resolvePremiumSdkSetting({
          requested: undefined,
          existing: true,
          hasFeature: false,
        }),
      ).toBe(true);
    });

    it("lets a setting be turned off", () => {
      expect(
        resolvePremiumSdkSetting({
          requested: false,
          existing: true,
          hasFeature: false,
        }),
      ).toBe(false);
    });

    it("does not let a setting be turned on", () => {
      expect(
        resolvePremiumSdkSetting({
          requested: true,
          existing: false,
          hasFeature: false,
        }),
      ).toBe(false);
      expect(
        resolvePremiumSdkSetting({
          requested: true,
          existing: undefined,
          hasFeature: false,
        }),
      ).toBe(false);
    });
  });
});
