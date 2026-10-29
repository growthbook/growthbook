// Loaded first, as the app does: the mocks below would otherwise enter the
// ProjectModel / request-context import cycle from the wrong end.
import "back-end/src/services/features";
import { ExperimentInterface } from "shared/types/experiment";
import { getScopedSettings } from "shared/settings";
import { builtInChecklistItemKeyValidator } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { getExperimentLaunchChecklist } from "back-end/src/models/ExperimentLaunchChecklistModel";
import {
  getChangesToStartExperiment,
  getLinkedFeatureInfo,
} from "back-end/src/services/experiments";
import { publishPendingFeatureDraftsForExperiment } from "back-end/src/services/experiment-feature";
import {
  ChecklistIncompleteError,
  isTerminalPublishError,
} from "back-end/src/util/errors";
import {
  assertScheduledStartNotHardBlocked,
  assertStartNotBlocked,
  getExperimentStartChecklistStatus,
  type StartPlan,
  startExperiment,
  startResult,
  statusChangeEffects,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  updateExperiment: jest.fn(),
}));
jest.mock("back-end/src/services/experiment-feature", () => ({
  publishPendingFeatureDraftsForExperiment: jest.fn(),
  formatPendingDraftFailureMessage: jest.fn(),
  getLaunchDrafts: jest.fn(async () => []),
}));
jest.mock("back-end/src/services/experiments", () => ({
  assertCanPublishPendingFeatureDrafts: jest.fn(),
  assertCanRunExperimentInAffectedEnvironments: jest.fn(),
  assertValidExperimentPhases: (...args: unknown[]) =>
    jest
      .requireActual("back-end/src/services/experiments")
      .assertValidExperimentPhases(...args),
  getChangesToStartExperiment: jest.fn(),
  getLinkedFeatureInfo: jest.fn(),
  resetExperimentBanditSettings: jest.fn(() => ({ banditStage: "explore" })),
}));
jest.mock("back-end/src/services/growthbook", () => ({
  trackEventForContext: jest.fn(),
}));
// Import cycle: a lazy Proxy defers requireActual to first property access.
const getFeaturesByIdsMock = jest.fn();
jest.mock(
  "back-end/src/models/FeatureModel",
  () =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "getFeaturesByIds"
            ? getFeaturesByIdsMock
            : jest.requireActual("back-end/src/models/FeatureModel")[prop],
      },
    ),
);
jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionsByOrganization: jest.fn(),
}));
jest.mock("back-end/src/models/VisualChangesetModel", () => ({
  findVisualChangesetsByExperiment: jest.fn(async () => []),
}));
jest.mock("back-end/src/models/ExperimentLaunchChecklistModel", () => ({
  getExperimentLaunchChecklist: jest.fn(),
}));
jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: jest.fn(() => true),
}));

const draft = {
  id: "exp_1",
  organization: "org_1",
  type: "standard",
  status: "draft",
  linkedFeatures: [],
  variations: [
    { id: "v0", screenshots: [] },
    { id: "v1", screenshots: [] },
  ],
  phases: [{ variationWeights: [0.5, 0.5] }],
} as unknown as ExperimentInterface;
const invalidSplit = {
  ...draft,
  phases: [{ variationWeights: [0.53, 0.5] }],
} as unknown as ExperimentInterface;
const context = {
  org: { id: "org_1" },
  userId: "u_1",
  permissions: { canUpdateExperiment: () => true },
  models: { urlRedirects: { findByExperiment: async () => [] } },
} as unknown as ReqContext;
const draftFlag = {
  feature: { id: "flag_1" },
  state: "draft",
  values: [
    { variationId: "v0", value: "a" },
    { variationId: "v1", value: "b" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (getExperimentById as jest.Mock).mockResolvedValue(draft);
  (getLinkedFeatureInfo as jest.Mock).mockResolvedValue([]);
  (findSDKConnectionsByOrganization as jest.Mock).mockResolvedValue([
    { id: "sdk_1", projects: [] },
  ]);
  (getExperimentLaunchChecklist as jest.Mock).mockResolvedValue(null);
  getFeaturesByIdsMock.mockResolvedValue([]);
});

describe("startExperiment", () => {
  it("never lets a skipped checklist or the bypass through a hard block", async () => {
    (getLinkedFeatureInfo as jest.Mock).mockResolvedValue([
      { ...draftFlag, hasUnrelatedDraftChanges: true },
    ]);

    await expect(
      startExperiment({
        context,
        experimentId: "exp_1",
        skipChecklist: true,
        bypassLockdown: true,
      }),
    ).rejects.toMatchObject({
      code: "checklist_incomplete",
      details: {
        remainingChecklistItems: [
          expect.objectContaining({
            key: "unrelatedDraftChanges:flag_1",
            hardBlock: true,
          }),
        ],
      },
    });
    expect(updateExperiment).not.toHaveBeenCalled();
  });

  it("refuses weights that don't add up to 100% before publishing a draft", async () => {
    (getExperimentById as jest.Mock).mockResolvedValue(invalidSplit);

    await expect(
      startExperiment({
        context,
        experimentId: "exp_1",
        skipChecklist: true,
        bypassLockdown: true,
      }),
    ).rejects.toMatchObject({
      code: "checklist_incomplete",
      details: {
        remainingChecklistItems: [
          expect.objectContaining({ key: "variationWeights", hardBlock: true }),
        ],
      },
    });
    expect(publishPendingFeatureDraftsForExperiment).not.toHaveBeenCalled();
  });

  it("refuses a stored invalid coverage before publishing a draft", async () => {
    (getExperimentById as jest.Mock).mockResolvedValue({
      ...draft,
      phases: [{ coverage: 1.5, variationWeights: [0.5, 0.5] }],
    });
    // An experiment with results keeps its phases as they are.
    (getChangesToStartExperiment as jest.Mock).mockResolvedValueOnce({
      status: "running",
    });

    await expect(
      startExperiment({ context, experimentId: "exp_1", skipChecklist: true }),
    ).rejects.toThrow("invalid_coverage");
    expect(publishPendingFeatureDraftsForExperiment).not.toHaveBeenCalled();
  });
});

describe("getExperimentStartChecklistStatus", () => {
  it("asks for what the app's checklist asks for", async () => {
    (findSDKConnectionsByOrganization as jest.Mock).mockResolvedValue([
      { id: "sdk_other", projects: ["prj_other"] },
    ]);

    const statuses = Object.fromEntries(
      (await getExperimentStartChecklistStatus(context, draft)).map((item) => [
        item.key,
        item.status,
      ]),
    );

    expect(statuses).toMatchObject({
      datasource: "incomplete",
      exposureQuery: "incomplete",
      // Only a connection that serves the experiment's Project counts.
      sdkConnection: "incomplete",
    });
  });

  it("leaves a Bandit's weights to its start, which resets them", async () => {
    const keys = (
      await getExperimentStartChecklistStatus(context, {
        ...invalidSplit,
        type: "multi-armed-bandit",
      })
    ).map((item) => item.key);

    expect(keys).not.toContain("variationWeights");
  });
});

describe("statusChangeEffects", () => {
  const { settings } = getScopedSettings({
    organization: { settings: {} } as never,
  });
  const ran = {
    ...draft,
    phases: [{ variationWeights: [0.5, 0.5], dateStarted: new Date(0) }],
  } as unknown as ExperimentInterface;

  it("ends the phase on a stop, and reopens it on a restart", () => {
    const stop = statusChangeEffects({
      experiment: { ...ran, status: "running" },
      status: "stopped",
      settings,
      reason: "Done",
    });
    expect(stop.phases?.[0]).toMatchObject({
      reason: "Done",
      dateEnded: expect.any(Date),
    });

    const restart = statusChangeEffects({
      experiment: { ...ran, status: "stopped", phases: stop.phases ?? [] },
      status: "running",
      settings,
    });
    expect(restart.phases?.[0].dateEnded).toBeUndefined();
  });

  it("restarts a bandit on a fresh phase with fresh buckets", () => {
    const restart = statusChangeEffects({
      experiment: {
        ...ran,
        type: "multi-armed-bandit",
        status: "stopped",
        bucketVersion: 2,
      },
      status: "running",
      settings,
    });
    expect(restart.phases).toHaveLength(2);
    expect(restart.phases?.[0].dateEnded).toEqual(expect.any(Date));
    expect(restart).toMatchObject({
      bucketVersion: 3,
      minBucketVersion: 3,
      banditStage: "explore",
    });
  });
});

describe("custom launch checklist tasks", () => {
  const builtIn = new Set<string>([
    ...builtInChecklistItemKeyValidator.options,
    "banditGoalMetric",
  ]);
  const customStatuses = async (experiment: ExperimentInterface) =>
    Object.fromEntries(
      (await getExperimentStartChecklistStatus(context, experiment))
        .filter((item) => !builtIn.has(item.key))
        .map((item) => [item.key, item.status]),
    );

  it.each([
    {
      type: "standard",
      expected: {
        "Write a hypothesis": "incomplete",
        "Schedule the start": "incomplete",
      },
    },
    { type: "multi-armed-bandit", expected: {} },
  ])(
    "adds the hypothesis and schedule tasks only where they apply ($type)",
    async ({ type, expected }) => {
      (getExperimentLaunchChecklist as jest.Mock).mockResolvedValue({
        tasks: [
          {
            task: "Write a hypothesis",
            completionType: "auto",
            propertyKey: "hypothesis",
          },
          {
            task: "Schedule the start",
            completionType: "auto",
            propertyKey: "schedule",
          },
        ],
      });

      expect(
        await customStatuses({ ...draft, type } as ExperimentInterface),
      ).toEqual(expected);
    },
  );

  it("reads a manual task from its tick alone, even when named like a built-in", async () => {
    (getExperimentLaunchChecklist as jest.Mock).mockResolvedValue({
      tasks: [
        { task: "hypothesis", completionType: "manual" },
        { task: "customField", completionType: "manual" },
      ],
    });

    expect(
      await customStatuses({ ...draft, hypothesis: "Bigger buttons convert" }),
    ).toEqual({ hypothesis: "incomplete", customField: "incomplete" });
    expect(
      await customStatuses({
        ...draft,
        manualLaunchChecklist: [
          { key: "hypothesis", status: "complete" },
          { key: "customField", status: "complete" },
        ],
      }),
    ).toEqual({ hypothesis: "complete", customField: "complete" });
  });
});

describe("assertScheduledStartNotHardBlocked", () => {
  it.each([
    {
      name: "a merge conflict",
      flag: { hasMergeConflict: true },
      key: "mergeConflict:flag_1",
    },
    {
      name: "a removal still in its draft",
      flag: { pendingRemoval: { version: 3, status: "draft" } },
      key: "pendingRemoval:flag_1",
    },
  ])(
    "refuses to fire with $name, as a retryable failure",
    async ({ flag, key }) => {
      (getLinkedFeatureInfo as jest.Mock).mockResolvedValue([
        { ...draftFlag, ...flag },
      ]);

      const error = await assertScheduledStartNotHardBlocked(
        context,
        draft,
      ).catch((e) => e);

      expect(error).toBeInstanceOf(ChecklistIncompleteError);
      expect(isTerminalPublishError(error)).toBe(false);
      expect(error.details.remainingChecklistItems).toEqual([
        expect.objectContaining({ key }),
      ]);
    },
  );

  it("refuses to fire with weights that don't add up to 100%", async () => {
    const error = await assertScheduledStartNotHardBlocked(
      context,
      invalidSplit,
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ChecklistIncompleteError);
    expect(error.details.remainingChecklistItems).toEqual([
      expect.objectContaining({ key: "variationWeights" }),
    ]);
  });
});

describe("assertStartNotBlocked and startResult", () => {
  const gate = (key: string, override: "skipChecklist" | null) => ({
    key,
    type: "checklist-item",
    severity: override ? ("warning" as const) : ("blocker" as const),
    messages: [`${key} is open`],
    override,
    requiresPermission: null,
    resolution: null,
  });
  const plan = (blocking: ReturnType<typeof gate>[]): StartPlan => ({
    checklistItems: blocking.map((g) => ({
      key: g.key,
      required: true,
      status: "incomplete",
      manual: false,
      reason: g.messages[0],
    })),
    gates: blocking,
    blocking,
    bypassed: [],
    skipped: [],
  });
  const message = (p: StartPlan) => {
    try {
      assertStartNotBlocked(p);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  it.each([
    [[], null],
    [[gate("goalMetric", "skipChecklist")], "required checklist items"],
    [[gate("targeting", null)], "targeting is open"],
    [[gate("a", null), gate("b", null)], "cannot be bypassed"],
  ])("refuses with what blocks it (%#)", (blocking, expected) => {
    const refusal = message(plan(blocking));
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });

  it("reports what a start got past and published", () => {
    expect(
      startResult(
        {
          ...plan([]),
          skipped: [
            { ...gate("goalMetric", "skipChecklist"), via: "skipChecklist" },
          ],
        },
        [{ featureId: "flag_1", revisionVersion: 3 }],
      ),
    ).toEqual({
      bypassedGates: [
        {
          key: "goalMetric",
          type: "checklist-item",
          outcome: "bypassed",
          via: "skipChecklist",
        },
      ],
      publishedFeatureDrafts: [{ featureId: "flag_1", revisionVersion: 3 }],
    });
    expect(startResult(plan([]))).toEqual({});
  });
});
