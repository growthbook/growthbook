import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { getAverageExposureOverLastNDays } from "../src/power";

describe("getAverageExposureOverLastNDays", () => {
  it("should get average exposure over last 3 days", () => {
    const traffic: ExperimentSnapshotTraffic = {
      overall: {
        name: "All",
        srm: 1,
        variationUnits: [],
      },
      dimension: {
        dim_exposure_date: [
          { name: "2024-01-01", srm: 1, variationUnits: [98, 187, 294] },
          { name: "2024-01-02", srm: 1, variationUnits: [103, 212, 289] },
          { name: "2024-01-03", srm: 1, variationUnits: [95, 178, 307] },
        ],
      },
    };
    expect(
      getAverageExposureOverLastNDays(traffic, 3, new Date(2024, 0, 4))
    ).toEqual(587);
  });

  it("should get average exposure over last 3 days with missing dates", () => {
    const traffic: ExperimentSnapshotTraffic = {
      overall: {
        name: "All",
        srm: 1,
        variationUnits: [],
      },
      dimension: {
        dim_exposure_date: [
          { name: "2024-01-01", srm: 1, variationUnits: [98, 187, 294] },
          { name: "2024-01-02", srm: 1, variationUnits: [103, 212, 289] },
          // Jan 3rd will be ignored as it is the date we are running the query on
          { name: "2024-01-03", srm: 1, variationUnits: [95, 178, 307] },
        ],
      },
    };
    expect(
      getAverageExposureOverLastNDays(traffic, 3, new Date(2024, 0, 3))
    ).toEqual(394);
  });
});
