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
});
