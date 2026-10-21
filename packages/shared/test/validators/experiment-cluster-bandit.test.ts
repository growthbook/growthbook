import {
  CLUSTER_BANDIT_NOT_SUPPORTED_MESSAGE,
  isClusterModeChangeLocked,
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

describe("isClusterModeChangeLocked", () => {
  it("locks turning cluster mode on or off once the experiment left draft", () => {
    expect(
      isClusterModeChangeLocked({
        status: "running",
        isClusterExperiment: false,
        nextIsClusterExperiment: true,
      }),
    ).toBe(true);
    expect(
      isClusterModeChangeLocked({
        status: "stopped",
        isClusterExperiment: true,
        nextIsClusterExperiment: false,
      }),
    ).toBe(true);
  });

  it.each([
    {
      status: "draft",
      isClusterExperiment: false,
      nextIsClusterExperiment: true,
    },
    {
      status: "running",
      nextStatus: "draft",
      isClusterExperiment: true,
      nextIsClusterExperiment: false,
    },
    {
      status: "running",
      isClusterExperiment: true,
      nextIsClusterExperiment: true,
    },
    {
      status: "running",
      isClusterExperiment: undefined,
      nextIsClusterExperiment: false,
    },
    {
      status: "running",
      isClusterExperiment: true,
      nextIsClusterExperiment: undefined,
    },
  ])("allows %p", (args) => {
    expect(isClusterModeChangeLocked(args)).toBe(false);
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
