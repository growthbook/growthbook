import {
  _resetPrivacyForTests,
  resolvePrivacySettings,
  sharePrivacySettings,
} from "../../src/plugins/utils/privacy";

describe("shared privacy settings", () => {
  beforeEach(() => _resetPrivacyForTests());

  it("falls back from a plugin's own settings to shared ones to defaults", () => {
    sharePrivacySettings({
      blockSelector: ".shared-block",
      url: { keepFragment: true },
    });

    expect(
      resolvePrivacySettings(
        { maskAllInputs: true, url: { allowQueryParams: ["tab"] } },
        { blockSelector: ".own-block" },
      ),
    ).toEqual({
      maskAllInputs: true,
      blockSelector: ".own-block",
      url: { allowQueryParams: ["tab"], keepFragment: true },
    });
  });

  it("pools partial settings from several plugins", () => {
    sharePrivacySettings({ blockSelector: ".a" });
    sharePrivacySettings(undefined);
    sharePrivacySettings({ maskTextSelector: ".b" });

    expect(resolvePrivacySettings({}, undefined)).toEqual({
      blockSelector: ".a",
      maskTextSelector: ".b",
    });
  });
});
