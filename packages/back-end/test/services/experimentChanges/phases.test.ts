import { getScopedSettings } from "shared/settings";
import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { ReqContext } from "back-end/types/request";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { updateSnapshotsOnPhaseDelete } from "back-end/src/models/ExperimentSnapshotModel";
import {
  assertCanRunExperimentInAffectedEnvironments,
  assertValidExperimentPhases,
  phaseWeightsFromTrafficSplit,
  resetExperimentBanditSettings,
} from "back-end/src/services/experiments";
import { assertRegisteredAttributesScoped } from "back-end/src/services/attributes";
import { assertValidExperimentPrerequisites } from "back-end/src/services/prerequisiteParents";
import { validateChangedPhaseReferences } from "back-end/src/api/features/validations";
import {
  loadAndValidateExperimentForStatusChange,
  validateExperimentChange,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";
import {
  BadRequestError,
  ConflictError,
  InvalidStatusError,
  NotFoundError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  deleteExperimentPhase,
  startNewExperimentPhase,
} from "back-end/src/services/experimentChanges/phases";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  updateExperiment: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  updateSnapshotsOnPhaseDelete: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  assertCanRunExperimentInAffectedEnvironments: jest.fn(),
  assertValidExperimentPhases: jest.fn(),
  getExperimentAttributeScopeProjects: jest.fn(),
  phaseWeightsFromTrafficSplit: jest.fn(),
  resetExperimentBanditSettings: jest.fn(),
  toPhaseNamespaceValue: jest.fn(),
}));
jest.mock("back-end/src/services/attributes", () => ({
  assertRegisteredAttributesScoped: jest.fn(),
}));
jest.mock("back-end/src/services/prerequisiteParents", () => ({
  assertValidExperimentPrerequisites: jest.fn(),
}));
jest.mock("back-end/src/api/features/validations", () => ({
  validateChangedPhaseReferences: jest.fn(),
}));
jest.mock(
  "back-end/src/services/experimentChanges/changeExperimentStatus",
  () => ({
    loadAndValidateExperimentForStatusChange: jest.fn(),
    validateExperimentChange: jest.fn(),
  }),
);
jest.mock("shared/settings", () => ({
  getScopedSettings: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

type Targeting = Parameters<typeof startNewExperimentPhase>[0]["targeting"];

const LAST_CONDITION = '{"country":"US"}';

function makePhase(overrides: Partial<ExperimentPhase> = {}): ExperimentPhase {
  return {
    name: "Main",
    dateStarted: new Date("2026-01-01T00:00:00Z"),
    reason: "",
    coverage: 1,
    condition: LAST_CONDITION,
    savedGroups: [{ match: "all", ids: ["grp_1"] }],
    prerequisites: [],
    namespace: { enabled: false, name: "", range: [0, 1] },
    seed: "seed_1",
    variationWeights: [0.5, 0.5],
    variations: [
      { id: "v0", status: "active" },
      { id: "v1", status: "active" },
    ],
    ...overrides,
  };
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    status: "running",
    type: "standard",
    linkedFeatures: [],
    phases: [makePhase()],
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeContext({
  canUpdate = true,
  useStickyBucketing = false,
}: { canUpdate?: boolean; useStickyBucketing?: boolean } = {}) {
  const incrementalRefresh = {
    acquirePhaseSlotForMutation: jest.fn<
      Promise<boolean>,
      [string, number, string]
    >(),
    deleteByExperimentIdAndPhase: jest.fn<Promise<void>, [string, number]>(),
    shiftPhasesDownAfterDelete: jest.fn<Promise<void>, [string, number]>(),
    releaseLock: jest.fn<Promise<void>, [string, string]>(),
  };
  incrementalRefresh.acquirePhaseSlotForMutation.mockResolvedValue(true);
  incrementalRefresh.deleteByExperimentIdAndPhase.mockResolvedValue();
  incrementalRefresh.shiftPhasesDownAfterDelete.mockResolvedValue();
  incrementalRefresh.releaseLock.mockResolvedValue();

  const permissions = {
    canUpdateExperiment: jest.fn(() => canUpdate),
    throwPermissionError: jest.fn(() => {
      throw new Error("You do not have access to perform this action");
    }),
  };
  const context = {
    org: { id: "org_1", settings: { useStickyBucketing } },
    permissions,
    models: { incrementalRefresh },
  } as unknown as ReqContext;
  return { context, incrementalRefresh, permissions };
}

function lastUpdateChanges() {
  const calls = jest.mocked(updateExperiment).mock.calls;
  return calls[calls.length - 1][0].changes;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(updateExperiment)
    .mockImplementation(async ({ experiment, changes }) => ({
      ...experiment,
      ...changes,
    }));
  jest.mocked(getFeaturesByIds).mockResolvedValue([]);
  jest.mocked(getScopedSettings).mockReturnValue({
    settings: {},
  } as unknown as ReturnType<typeof getScopedSettings>);
  jest
    .mocked(phaseWeightsFromTrafficSplit)
    .mockImplementation((split) => split?.map((s) => s.weight));
});

describe("startNewExperimentPhase", () => {
  async function start(
    experiment: ExperimentInterface,
    targeting: Targeting = {},
    {
      releasePlan = "new-phase",
      reason,
      useStickyBucketing,
    }: {
      releasePlan?:
        | "new-phase"
        | "new-phase-same-seed"
        | "new-phase-block-sticky";
      reason?: string;
      useStickyBucketing?: boolean;
    } = {},
  ) {
    jest
      .mocked(loadAndValidateExperimentForStatusChange)
      .mockResolvedValue(experiment);
    const { context } = makeContext({ useStickyBucketing });
    const result = await startNewExperimentPhase({
      context,
      experimentId: experiment.id,
      releasePlan,
      reason,
      targeting,
    });
    return { context, result };
  }

  it.each(["draft", "stopped"] as const)(
    "refuses a %s experiment",
    async (status) => {
      await expect(start(makeExperiment({ status }))).rejects.toBeInstanceOf(
        InvalidStatusError,
      );
      expect(updateExperiment).not.toHaveBeenCalled();
    },
  );

  it("refuses a running experiment with no phases", async () => {
    await expect(start(makeExperiment({ phases: [] }))).rejects.toBeInstanceOf(
      InvalidStatusError,
    );
    expect(updateExperiment).not.toHaveBeenCalled();
  });

  it("refuses new-phase-same-seed for a bandit", async () => {
    await expect(
      start(
        makeExperiment({ type: "multi-armed-bandit" }),
        {},
        { releasePlan: "new-phase-same-seed" },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(updateExperiment).not.toHaveBeenCalled();
  });

  it("keeps the last phase's condition when none is sent", async () => {
    await start(makeExperiment());
    const phases = lastUpdateChanges().phases ?? [];
    expect(phases[1].condition).toBe(LAST_CONDITION);
  });

  it.each([
    { field: "condition", targeting: { condition: "" } },
    { field: "targetingCondition", targeting: { targetingCondition: "" } },
  ])(
    "clears the condition to {} when $field is an explicit empty string",
    async ({ targeting }) => {
      await start(makeExperiment(), targeting);
      const phases = lastUpdateChanges().phases ?? [];
      expect(phases[1].condition).toBe("{}");
    },
  );

  it("uses an explicit targetingCondition", async () => {
    await start(makeExperiment(), { targetingCondition: '{"beta":true}' });
    const phases = lastUpdateChanges().phases ?? [];
    expect(phases[1].condition).toBe('{"beta":true}');
  });

  it("leaves a carried-over Saved Group condition to the group-aware check", async () => {
    const condition = '{"$savedGroups":["grp_1"]}';
    await start(makeExperiment({ phases: [makePhase({ condition })] }), {
      coverage: 0.5,
    });
    expect(lastUpdateChanges().phases?.[1].condition).toBe(condition);
    expect(validateChangedPhaseReferences).toHaveBeenCalled();
  });

  it("rejects an invalid prerequisite condition with a 400", async () => {
    await expect(
      start(makeExperiment(), {
        prerequisites: [{ id: "feat_1", condition: "not json" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(updateExperiment).not.toHaveBeenCalled();
  });

  it("prefers variationWeights over trafficSplit", async () => {
    await start(makeExperiment(), {
      variationWeights: [0.2, 0.8],
      trafficSplit: [
        { variationId: "v0", weight: 0.9 },
        { variationId: "v1", weight: 0.1 },
      ],
    });
    const phases = lastUpdateChanges().phases ?? [];
    expect(phases[1].variationWeights).toEqual([0.2, 0.8]);
    expect(phaseWeightsFromTrafficSplit).not.toHaveBeenCalled();
  });

  it("maps trafficSplit onto the last phase's variations", async () => {
    const trafficSplit = [
      { variationId: "v0", weight: 0.9 },
      { variationId: "v1", weight: 0.1 },
    ];
    await start(makeExperiment(), { trafficSplit });
    expect(phaseWeightsFromTrafficSplit).toHaveBeenCalledWith(trafficSplit, [
      "v0",
      "v1",
    ]);
    const phases = lastUpdateChanges().phases ?? [];
    expect(phases[1].variationWeights).toEqual([0.9, 0.1]);
  });

  it("inherits the last phase's weights when neither is sent", async () => {
    await start(
      makeExperiment({ phases: [makePhase({ variationWeights: [0.3, 0.7] })] }),
    );
    const phases = lastUpdateChanges().phases ?? [];
    expect(phases[1].variationWeights).toEqual([0.3, 0.7]);
  });

  it("rejects weights that don't match the variation count with a 400", async () => {
    await expect(
      start(makeExperiment(), { variationWeights: [0.2, 0.3, 0.5] }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(updateExperiment).not.toHaveBeenCalled();
  });

  it("ends the previous phase and appends a new Main phase with a new seed", async () => {
    const experiment = makeExperiment();
    await start(experiment, { coverage: 0.5 }, { reason: "Ramp to 50%" });

    const phases = lastUpdateChanges().phases ?? [];
    expect(phases).toHaveLength(2);
    expect(phases[0].dateEnded).toBeInstanceOf(Date);
    expect(phases[0].reason).toBe("Ramp to 50%");
    expect(phases[1]).toMatchObject({
      name: "Main",
      reason: "",
      coverage: 0.5,
      condition: LAST_CONDITION,
      savedGroups: [{ match: "all", ids: ["grp_1"] }],
      variations: experiment.phases[0].variations,
    });
    expect(phases[1].dateStarted).toEqual(phases[0].dateEnded);
    expect(phases[1].seed).toEqual(expect.any(String));
    expect(phases[1].seed).not.toBe("seed_1");
    // The stored experiment isn't mutated
    expect(experiment.phases[0].dateEnded).toBeUndefined();
    expect(assertValidExperimentPhases).toHaveBeenCalledWith(
      phases,
      experiment.phases,
    );
  });

  it("keeps the seed for new-phase-same-seed", async () => {
    await start(makeExperiment(), {}, { releasePlan: "new-phase-same-seed" });
    const phases = lastUpdateChanges().phases ?? [];
    expect(phases[1].seed).toBe("seed_1");
  });

  it("bumps the bucket version when sticky bucketing is on", async () => {
    await start(
      makeExperiment({ bucketVersion: 2, minBucketVersion: 1 }),
      {},
      { releasePlan: "new-phase-block-sticky", useStickyBucketing: true },
    );
    expect(lastUpdateChanges()).toMatchObject({
      bucketVersion: 3,
      minBucketVersion: 3,
    });
  });

  it("merges the bandit reset into the changes for a bandit", async () => {
    jest
      .mocked(resetExperimentBanditSettings)
      .mockReturnValueOnce({ statsEngine: "bayesian", goalMetrics: ["met_1"] });
    await start(makeExperiment({ type: "multi-armed-bandit" }));

    expect(resetExperimentBanditSettings).toHaveBeenCalledTimes(1);
    expect(lastUpdateChanges()).toMatchObject({
      statsEngine: "bayesian",
      goalMetrics: ["met_1"],
    });
    expect(lastUpdateChanges().phases).toHaveLength(2);
  });

  it("doesn't reset bandit settings for a standard experiment", async () => {
    await start(makeExperiment());
    expect(resetExperimentBanditSettings).not.toHaveBeenCalled();
  });

  it("validates and writes the built changes", async () => {
    const experiment = makeExperiment();
    const { context, result } = await start(experiment, { coverage: 0.4 });

    expect(assertRegisteredAttributesScoped).toHaveBeenCalledWith(
      context,
      { condition: LAST_CONDITION },
      "experiment phase",
      { condition: LAST_CONDITION },
      expect.any(Function),
    );
    expect(validateChangedPhaseReferences).toHaveBeenCalledWith(
      [expect.objectContaining({ coverage: 0.4 })],
      [experiment.phases[0]],
      context,
    );
    expect(assertValidExperimentPrerequisites).toHaveBeenCalledWith(
      context,
      [],
      [],
    );
    const changes = lastUpdateChanges();
    expect(validateExperimentChange).toHaveBeenCalledWith({
      context,
      experiment,
      changes,
    });
    expect(updateExperiment).toHaveBeenCalledWith({
      context,
      experiment,
      changes,
    });
    expect(result.experiment).toBe(experiment);
    expect(result.updated.phases).toHaveLength(2);
  });
});

describe("deleteExperimentPhase", () => {
  function twoPhaseExperiment(overrides: Partial<ExperimentInterface> = {}) {
    return makeExperiment({
      phases: [makePhase({ name: "First" }), makePhase({ name: "Second" })],
      ...overrides,
    });
  }

  function del(
    experiment: ExperimentInterface | null,
    phaseIndex: number,
    contextOptions: { canUpdate?: boolean } = {},
  ) {
    jest.mocked(getExperimentById).mockResolvedValue(experiment);
    const ctx = makeContext(contextOptions);
    const promise = deleteExperimentPhase({
      context: ctx.context,
      experimentId: "exp_1",
      phaseIndex,
    });
    return { ...ctx, promise };
  }

  function expectNothingWritten() {
    expect(updateExperiment).not.toHaveBeenCalled();
    expect(updateSnapshotsOnPhaseDelete).not.toHaveBeenCalled();
  }

  it("404s for a missing experiment", async () => {
    const { promise } = del(null, 0);
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    expectNothingWritten();
  });

  it("404s for another org's experiment", async () => {
    const { promise } = del(
      twoPhaseExperiment({ organization: "org_other" }),
      0,
    );
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    expectNothingWritten();
  });

  it("refuses a holdout", async () => {
    const { promise } = del(twoPhaseExperiment({ type: "holdout" }), 0);
    await expect(promise).rejects.toBeInstanceOf(BadRequestError);
    expectNothingWritten();
  });

  it("throws a permission error when the user can't update the experiment", async () => {
    const { promise, permissions } = del(twoPhaseExperiment(), 0, {
      canUpdate: false,
    });
    await expect(promise).rejects.toThrow("You do not have access");
    expect(permissions.throwPermissionError).toHaveBeenCalled();
    expectNothingWritten();
  });

  it("refuses to delete the only phase", async () => {
    const { promise } = del(makeExperiment(), 0);
    await expect(promise).rejects.toThrow("Cannot delete the only phase");
    expectNothingWritten();
  });

  it.each([-1, 2, 0.5, NaN])("refuses phase index %p", async (phaseIndex) => {
    const { promise, incrementalRefresh } = del(
      twoPhaseExperiment(),
      phaseIndex,
    );
    await expect(promise).rejects.toThrow("Invalid phase id");
    expect(
      incrementalRefresh.acquirePhaseSlotForMutation,
    ).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("conflicts without writing when the phase slot can't be claimed", async () => {
    const experiment = twoPhaseExperiment();
    jest.mocked(getExperimentById).mockResolvedValue(experiment);
    const { context, incrementalRefresh } = makeContext();
    incrementalRefresh.acquirePhaseSlotForMutation.mockResolvedValue(false);

    await expect(
      deleteExperimentPhase({ context, experimentId: "exp_1", phaseIndex: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expectNothingWritten();
    expect(
      incrementalRefresh.deleteByExperimentIdAndPhase,
    ).not.toHaveBeenCalled();
    expect(
      incrementalRefresh.shiftPhasesDownAfterDelete,
    ).not.toHaveBeenCalled();
    expect(incrementalRefresh.releaseLock).not.toHaveBeenCalled();
  });

  it("removes the phase, cleans up its data, and releases the claim", async () => {
    const experiment = twoPhaseExperiment();
    const { promise, context, incrementalRefresh } = del(experiment, 0);
    const result = await promise;

    expect(assertCanRunExperimentInAffectedEnvironments).toHaveBeenCalledWith(
      context,
      experiment,
    );
    const changes = { phases: [experiment.phases[1]] };
    expect(validateExperimentChange).toHaveBeenCalledWith({
      context,
      experiment,
      changes,
    });
    expect(updateExperiment).toHaveBeenCalledWith({
      context,
      experiment,
      changes,
    });
    expect(updateSnapshotsOnPhaseDelete).toHaveBeenCalledWith(
      context,
      "exp_1",
      0,
    );
    expect(
      incrementalRefresh.deleteByExperimentIdAndPhase,
    ).toHaveBeenCalledWith("exp_1", 0);
    expect(incrementalRefresh.shiftPhasesDownAfterDelete).toHaveBeenCalledWith(
      "exp_1",
      0,
    );
    const token =
      incrementalRefresh.acquirePhaseSlotForMutation.mock.calls[0][2];
    expect(incrementalRefresh.releaseLock).toHaveBeenCalledWith("exp_1", token);
    expect(result.experiment).toBe(experiment);
    expect(result.updated.phases).toEqual([experiment.phases[1]]);
  });

  it("releases the claim when a cleanup step throws", async () => {
    jest
      .mocked(updateSnapshotsOnPhaseDelete)
      .mockRejectedValueOnce(new Error("snapshot update failed"));
    const { promise, incrementalRefresh } = del(twoPhaseExperiment(), 1);

    await expect(promise).rejects.toThrow("snapshot update failed");
    expect(updateExperiment).toHaveBeenCalled();
    expect(
      incrementalRefresh.deleteByExperimentIdAndPhase,
    ).not.toHaveBeenCalled();
    const token =
      incrementalRefresh.acquirePhaseSlotForMutation.mock.calls[0][2];
    expect(incrementalRefresh.releaseLock).toHaveBeenCalledWith("exp_1", token);
  });

  it("only logs a failure to release the claim", async () => {
    const experiment = twoPhaseExperiment();
    jest.mocked(getExperimentById).mockResolvedValue(experiment);
    const { context, incrementalRefresh } = makeContext();
    const releaseError = new Error("release failed");
    incrementalRefresh.releaseLock.mockRejectedValue(releaseError);

    const result = await deleteExperimentPhase({
      context,
      experimentId: "exp_1",
      phaseIndex: 1,
    });

    expect(result.updated.phases).toEqual([experiment.phases[0]]);
    expect(logger.warn).toHaveBeenCalledWith(releaseError, expect.any(String));
  });
});
