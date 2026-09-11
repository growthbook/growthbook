import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

const baseSettings = {
  experimentId: "experiment",
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-01-02"),
  skipPartialData: false,
  attributionModel: "firstExposure",
  queryFilter: "",
  variations: [],
  metricSettings: [],
} as ExperimentSnapshotSettings;

describe("buildUnitsQuerySettingsFromSnapshot", () => {
  const exposureQuery = {
    query: "SELECT user_id, anonymous_id FROM experiment_viewed",
    userIdType: "user_id",
  };

  it("keeps the exposure query base identifier when no choice is stored", () => {
    expect(
      buildUnitsQuerySettingsFromSnapshot(baseSettings, exposureQuery)
        .exposureQuery,
    ).toEqual(exposureQuery);
  });

  it("uses the identifier type stored on the snapshot", () => {
    expect(
      buildUnitsQuerySettingsFromSnapshot(
        {
          ...baseSettings,
          exposureQueryIdentifierType: "anonymous_id",
        },
        exposureQuery,
      ).exposureQuery,
    ).toEqual({
      query: exposureQuery.query,
      userIdType: "anonymous_id",
    });
  });

  it("honors an explicit base identifier for non-exposure units", () => {
    expect(
      buildUnitsQuerySettingsFromSnapshot(
        {
          ...baseSettings,
          exposureQueryIdentifierType: "anonymous_id",
        },
        exposureQuery,
        "device_id",
      ).exposureQuery,
    ).toEqual({
      query: exposureQuery.query,
      userIdType: "device_id",
    });
  });
});
