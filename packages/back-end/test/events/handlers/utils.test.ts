import {
  RELEVANT_KEYS_FOR_ALL_ENVS,
  filterFeatureUpdatedNotificationEventForEnvironments,
} from "@back-end/src/events/handlers/utils";

describe("filterFeatureUpdatedNotificationEventForEnvironments", () => {
  it("returns false when feature is archived", () => {
    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: { archived: true },
            current: { archived: true },
          },
        },
        environments: [],
      }),
    ).toBe(false);
  });

  it("returns true for keys relevant for all enviroments", () => {
    const values = RELEVANT_KEYS_FOR_ALL_ENVS.map((key) =>
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: { [key]: key === "achived" ? true : "old-value" },
            current: { [key]: key === "archived" ? false : "new-value" },
          },
        },
        environments: ["foo"],
      }),
    );

    values.forEach((v) => expect(v).toBe(true));
  });

  it("returns true when a filtered environment has changed", () => {
    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: {
              environments: {
                foo: { enabled: true, some_setting: "old-value" },
              },
            },
            current: {
              environments: {
                foo: { enabled: true, some_setting: "new-value" },
              },
            },
          },
        },
        environments: ["foo"],
      }),
    ).toBe(true);

    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: {
              environments: {
                foo: { enabled: true },
              },
            },
            current: {
              environments: {
                foo: { enabled: false },
              },
            },
          },
        },
        environments: ["foo"],
      }),
    ).toBe(true);
  });

  it("returns false when a filtered environment has not changed", () => {
    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: {
              environments: {
                foo: { enabled: true, some_setting: "old-value" },
              },
            },
            current: {
              environments: {
                foo: { enabled: true, some_setting: "old-value" },
              },
            },
          },
        },
        environments: ["foo"],
      }),
    ).toBe(false);
  });

  it("returns true when an environment has changed and no filter is set", () => {
    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: {
              environments: {
                foo: { enabled: true, some_setting: "old-value" },
                bla: { enabled: true, some_setting: "old-value" },
              },
            },
            current: {
              environments: {
                foo: { enabled: true, some_setting: "old-value" },
                bla: { enabled: true, some_setting: "new-value" },
              },
            },
          },
        },
        environments: [],
      }),
    ).toBe(true);
  });

  it("returns false when no environment has changed and no filter is set", () => {
    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: {
              environments: {
                foo: { enabled: true, some_setting: "old-value" },
                bla: { enabled: true, some_setting: "old-value" },
              },
            },
            current: {
              environments: {
                foo: { enabled: true, some_setting: "old-value" },
                bla: { enabled: true, some_setting: "new-value" },
              },
            },
          },
        },
        environments: ["foo"],
      }),
    ).toBe(false);
  });

  it("returns false when a filtered environment is disabled before and after the event", () => {
    expect(
      filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: {
          data: {
            previous: {
              environments: {
                foo: { enabled: false, some_setting: "old-value" },
              },
            },
            current: {
              environments: {
                foo: { enabled: false, some_setting: "new-value" },
              },
            },
          },
        },
        environments: ["foo"],
      }),
    ).toBe(false);
  });
});
