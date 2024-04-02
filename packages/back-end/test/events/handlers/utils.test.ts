import { filterFeatureUpdatedNotificationEventForEnvironments } from "@back-end/src/events/handlers/utils";

describe("filterFeatureUpdatedNotificationEventForEnvironments", () => {
  it("returns true when environments is empty", () => {
    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        environments: [],
      })
    ).toBe(true);
  });
});
