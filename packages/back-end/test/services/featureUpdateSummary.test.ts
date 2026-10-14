import { featureUpdateSummary } from "back-end/src/services/confirmations";

const none = {
  archived: null,
  envEnabled: {},
  defaultValue: false,
  rules: false,
  metadata: [],
  prerequisites: false,
  holdout: false,
};

describe("featureUpdateSummary", () => {
  it("names a lone archive as the action itself", () => {
    expect(featureUpdateSummary("flag", { ...none, archived: true })).toBe(
      "Archive flag",
    );
  });

  it("lists every kind of change otherwise", () => {
    expect(
      featureUpdateSummary("flag", {
        ...none,
        archived: false,
        envEnabled: { staging: true, production: false },
        defaultValue: true,
        rules: true,
        metadata: ["owner", "tags"],
        prerequisites: true,
        holdout: true,
      }),
    ).toBe(
      "Update flag: unarchive, turn on in staging, turn off in production, change the default value, change rules, change owner, tags, change prerequisites, change the holdout",
    );
  });
});
