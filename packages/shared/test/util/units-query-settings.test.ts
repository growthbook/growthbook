import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

describe("buildUnitsQuerySettingsFromSnapshot", () => {
  it("uses the exposure query exactly as given, ignoring the snapshot's stored identifier", () => {
    const exposureQuery = {
      query: "SELECT user_id, anonymous_id FROM experiment_viewed",
      identifierType: "user_id",
    };
    expect(
      buildUnitsQuerySettingsFromSnapshot(
        {
          experimentId: "experiment",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-01-02"),
          skipPartialData: false,
          attributionModel: "firstExposure",
          queryFilter: "",
          variations: [],
          metricSettings: [],
          exposureQueryIdentifierType: "anonymous_id",
        } as ExperimentSnapshotSettings,
        exposureQuery,
      ).exposureQuery,
    ).toEqual(exposureQuery);
  });
});
