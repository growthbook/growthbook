import {
  CLUSTER_BANDIT_NOT_SUPPORTED_MESSAGE,
  isClusterConfigChangeLocked,
  isUnsupportedClusterBanditCombination,
  postExperimentValidator,
  updateExperimentValidator,
} from "../../src/validators/experiments";

describe("isUnsupportedClusterBanditCombination", () => {
  it("is true only when a cluster experiment is a multi-armed bandit", () => {
    expect(
      isUnsupportedClusterBanditCombination({
        type: "multi-armed-bandit",
        isClusterExperiment: true,
      }),
    ).toBe(true);
  });

  it.each([
    { type: "multi-armed-bandit", isClusterExperiment: false },
    { type: "multi-armed-bandit", isClusterExperiment: undefined },
    { type: "standard", isClusterExperiment: true },
    { type: "holdout", isClusterExperiment: true },
    { type: undefined, isClusterExperiment: true },
    { type: "standard", isClusterExperiment: false },
  ])("is false for %p", (args) => {
    expect(isUnsupportedClusterBanditCombination(args)).toBe(false);
  });
});

describe("isClusterConfigChangeLocked", () => {
  const launched = { status: "running", hasLinkedChanges: true };

  it.each([
    { ...launched, isClusterExperiment: false, nextIsClusterExperiment: true },
    {
      ...launched,
      status: "stopped",
      isClusterExperiment: true,
      nextIsClusterExperiment: false,
    },
    {
      ...launched,
      isClusterExperiment: true,
      subUnitIdentifier: "user_id",
      nextSubUnitIdentifier: "device_id",
    },
  ])("locks %p", (args) => {
    expect(isClusterConfigChangeLocked(args)).toBe(true);
  });

  it.each([
    // Assigned outside GrowthBook, e.g. an imported experiment.
    {
      ...launched,
      hasLinkedChanges: false,
      isClusterExperiment: false,
      nextIsClusterExperiment: true,
    },
    {
      ...launched,
      status: "draft",
      isClusterExperiment: true,
      subUnitIdentifier: "user_id",
      nextSubUnitIdentifier: "device_id",
    },
    {
      ...launched,
      nextStatus: "draft",
      isClusterExperiment: true,
      nextIsClusterExperiment: false,
    },
    {
      ...launched,
      isClusterExperiment: true,
      nextIsClusterExperiment: true,
      subUnitIdentifier: "user_id",
      nextSubUnitIdentifier: "user_id",
    },
    {
      ...launched,
      isClusterExperiment: false,
      subUnitIdentifier: "",
      nextSubUnitIdentifier: "device_id",
    },
  ])("allows %p", (args) => {
    expect(isClusterConfigChangeLocked(args)).toBe(false);
  });
});

const createBody = (fields: Record<string, unknown>) => ({
  datasourceId: "ds_1",
  assignmentQueryId: "user_id",
  trackingKey: "exp-key",
  name: "My experiment",
  variations: [
    { key: "0", name: "Control" },
    { key: "1", name: "Treatment" },
  ],
  ...fields,
});

describe.each([
  [
    "postExperiment body",
    (fields: Record<string, unknown>) =>
      postExperimentValidator.bodySchema.safeParse(createBody(fields)),
  ],
  [
    "updateExperiment body",
    (fields: Record<string, unknown>) =>
      updateExperimentValidator.bodySchema.safeParse(fields),
  ],
] as const)("%s cluster + bandit", (_name, parse) => {
  it("rejects a cluster experiment that is a multi-armed bandit", () => {
    const result = parse({
      type: "multi-armed-bandit",
      isClusterExperiment: true,
      clusterSubUnitIdentifier: "user_id",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        CLUSTER_BANDIT_NOT_SUPPORTED_MESSAGE,
      );
    }
  });

  it.each([
    { type: "multi-armed-bandit", isClusterExperiment: false },
    { type: "standard", isClusterExperiment: true },
    { type: "multi-armed-bandit" },
    { isClusterExperiment: true },
  ])("accepts %p", (fields) => {
    expect(parse(fields).success).toBe(true);
  });
});
