import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  getExperimentSRMValue,
  getExperimentVariationUnitsFromHealth,
} from "../src/health/health";

const snapshot = (
  overrides: Partial<ExperimentSnapshotInterface>,
): ExperimentSnapshotInterface =>
  ({ type: "standard", ...overrides }) as ExperimentSnapshotInterface;

const standardAnalyses = [
  {
    results: [
      {
        name: "",
        srm: 0.02,
        variations: [{ users: 600 }, { users: 400 }],
      },
    ],
  },
] as unknown as ExperimentSnapshotInterface["analyses"];

describe("getExperimentVariationUnitsFromHealth", () => {
  it("prefers the health traffic query", () => {
    expect(
      getExperimentVariationUnitsFromHealth(
        snapshot({
          health: { traffic: { overall: { variationUnits: [6200, 3800] } } },
          analyses: standardAnalyses,
        } as unknown as Partial<ExperimentSnapshotInterface>),
      ),
    ).toEqual([6200, 3800]);
  });

  it("falls through empty health units to the overall result", () => {
    expect(
      getExperimentVariationUnitsFromHealth(
        snapshot({
          health: { traffic: { overall: { variationUnits: [] } } },
          analyses: standardAnalyses,
        } as unknown as Partial<ExperimentSnapshotInterface>),
      ),
    ).toEqual([600, 400]);
  });

  it("returns undefined for non-standard snapshots without health traffic", () => {
    expect(
      getExperimentVariationUnitsFromHealth(
        snapshot({ type: "holdout", analyses: standardAnalyses }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the analysis is dimension split", () => {
    expect(
      getExperimentVariationUnitsFromHealth(
        snapshot({
          analyses: [
            {
              results: [
                { name: "us", variations: [{ users: 10 }] },
                { name: "ca", variations: [{ users: 20 }] },
              ],
            },
          ] as unknown as ExperimentSnapshotInterface["analyses"],
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined when there is no traffic or analysis data", () => {
    expect(getExperimentVariationUnitsFromHealth(snapshot({}))).toBeUndefined();
  });
});

describe("getExperimentSRMValue", () => {
  it("prefers the health traffic query", () => {
    expect(
      getExperimentSRMValue(
        snapshot({
          health: { traffic: { overall: { srm: 0.0004 } } },
          analyses: standardAnalyses,
        } as unknown as Partial<ExperimentSnapshotInterface>),
      ),
    ).toBe(0.0004);
  });

  it("falls back to the overall result for standard snapshots", () => {
    expect(
      getExperimentSRMValue(snapshot({ analyses: standardAnalyses })),
    ).toBe(0.02);
  });

  it("returns undefined for holdouts without health traffic", () => {
    expect(
      getExperimentSRMValue(
        snapshot({ type: "holdout", analyses: standardAnalyses }),
      ),
    ).toBeUndefined();
  });
});
