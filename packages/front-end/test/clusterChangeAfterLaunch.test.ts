import { getClusterChangeAfterLaunch } from "@/components/Experiment/AssignmentQueryFields";

const clusterExperiment = {
  isClusterExperiment: true,
  clusterSubUnitIdentifier: "user_id",
};

describe("getClusterChangeAfterLaunch", () => {
  const running = { status: "running" as const, ...clusterExperiment };
  const next = {
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
  };

  it("says nothing for drafts or unchanged settings", () => {
    expect(
      getClusterChangeAfterLaunch(
        { ...running, status: "draft" },
        { ...next, isClusterExperiment: false },
      ),
    ).toBeNull();
    expect(getClusterChangeAfterLaunch(running, next)).toBeNull();
  });

  it("names whether cluster mode or the subunit changed", () => {
    expect(
      getClusterChangeAfterLaunch(running, {
        ...next,
        isClusterExperiment: false,
      }),
    ).toBe("mode");
    expect(
      getClusterChangeAfterLaunch(running, {
        ...next,
        clusterSubUnitIdentifier: "device_id",
      }),
    ).toBe("subunit");
  });
});
