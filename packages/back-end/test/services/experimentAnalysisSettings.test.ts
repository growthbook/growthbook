import { ExperimentInterface } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import { getDefaultExperimentAnalysisSettings } from "back-end/src/services/experiments";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  ...jest.requireActual("back-end/src/enterprise/licenseUtil"),
  orgHasPremiumFeature: () => true,
}));

describe("getDefaultExperimentAnalysisSettings", () => {
  const postStratificationFor = (experiment: Partial<ExperimentInterface>) =>
    getDefaultExperimentAnalysisSettings({
      statsEngine: "bayesian",
      experiment: experiment as ExperimentInterface,
      organization: { settings: {} } as OrganizationInterface,
      postStratificationEnabled: true,
    }).postStratificationEnabled;

  it("stores post-stratification as off for cluster experiments", () => {
    expect(postStratificationFor({})).toBe(true);
    expect(
      postStratificationFor({
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
      }),
    ).toBe(false);
  });

  it("keeps post-stratification when cluster mode has no sub-unit", () => {
    expect(postStratificationFor({ isClusterExperiment: true })).toBe(true);
  });

  describe("p-value correction", () => {
    const correctionFor = (
      args: Partial<Parameters<typeof getDefaultExperimentAnalysisSettings>[0]>,
    ) =>
      getDefaultExperimentAnalysisSettings({
        statsEngine: "frequentist",
        experiment: {} as ExperimentInterface,
        organization: {
          settings: { pValueCorrection: "holm-bonferroni" },
        } as OrganizationInterface,
        ...args,
      }).pValueCorrection;

    it("records the correction it is given", () => {
      expect(correctionFor({ pValueCorrection: "benjamini-hochberg" })).toBe(
        "benjamini-hochberg",
      );
    });

    it("records none as null, which an analysis saved before corrections were stored does not have", () => {
      expect(correctionFor({ pValueCorrection: null })).toBeNull();
      expect(
        correctionFor({
          organization: { settings: {} } as OrganizationInterface,
        }),
      ).toBeNull();
    });

    it("falls back to the organization's setting", () => {
      expect(correctionFor({})).toBe("holm-bonferroni");
    });

    it("records none for the Bayesian engine", () => {
      expect(correctionFor({ statsEngine: "bayesian" })).toBeNull();
    });
  });
});
