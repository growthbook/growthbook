import { getScopedSettings } from "shared/settings";
import { ExperimentInterface } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import { resetExperimentBanditSettings } from "back-end/src/services/experiments";

describe("resetExperimentBanditSettings", () => {
  const { settings } = getScopedSettings({
    organization: { settings: {} } as OrganizationInterface,
  });

  it("weighs the variations a change leaves, without touching the experiment's phases", () => {
    const experiment = {
      datasource: "ds",
      phases: [{ dateStarted: new Date(), variationWeights: [0.5, 0.5] }],
      variations: [{ id: "0" }, { id: "1" }],
    } as ExperimentInterface;
    const before = JSON.stringify(experiment);

    const changes = resetExperimentBanditSettings({
      experiment,
      settings,
      changes: {
        variations: [{ id: "0" }, { id: "1" }, { id: "2" }],
      } as Partial<ExperimentInterface>,
    });

    expect(changes.phases?.[0].variationWeights).toHaveLength(3);
    expect(changes.phases?.[0].banditEvents).toHaveLength(1);
    expect(JSON.stringify(experiment)).toBe(before);
  });
});
