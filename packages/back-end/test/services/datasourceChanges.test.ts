import { withDefaultEventSettings } from "back-end/src/services/datasourceChanges";

const defaults = {
  experimentEvent: "$experiment_started",
  experimentIdProperty: "Experiment name",
  variationIdProperty: "Variant name",
};

describe("withDefaultEventSettings", () => {
  it("fills Mixpanel's standard event names into empty settings", () => {
    expect(withDefaultEventSettings({})).toEqual({ events: defaults });
  });

  it("keeps custom event names over the defaults", () => {
    expect(
      withDefaultEventSettings({
        events: { experimentEvent: "Viewed", extraUserIdProperty: "uid" },
      }).events,
    ).toEqual({
      ...defaults,
      experimentEvent: "Viewed",
      extraUserIdProperty: "uid",
    });
  });

  it("leaves other settings and the input unchanged", () => {
    const settings = { schemaFormat: "custom" as const, userIdTypes: [] };
    expect(withDefaultEventSettings(settings)).toEqual({
      ...settings,
      events: defaults,
    });
    expect(settings).not.toHaveProperty("events");
  });
});
