import { ExperimentInterface } from "shared/types/experiment";
import { ReqContext } from "back-end/types/request";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { getExperimentLaunchChecklist } from "back-end/src/models/ExperimentLaunchChecklistModel";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import {
  ChecklistIncompleteError,
  isTerminalPublishError,
} from "back-end/src/util/errors";
import {
  assertScheduledStartNotHardBlocked,
  executeExperimentStart,
  getExperimentStartChecklistStatus,
  startExperiment,
} from "back-end/src/services/experimentChanges/changeExperimentStatus";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  updateExperiment: jest.fn(async ({ experiment, changes }) => ({
    ...experiment,
    ...changes,
  })),
}));
jest.mock("back-end/src/services/experiment-feature", () => ({
  publishPendingFeatureDraftsForExperiment: jest.fn(async () => ({
    published: [],
    failed: [],
  })),
  formatPendingDraftFailureMessage: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  assertCanRunExperimentInAffectedEnvironments: jest.fn(),
  getChangesToStartExperiment: jest.fn(async () => ({ status: "running" })),
  getLinkedFeatureInfo: jest.fn(),
}));
jest.mock("back-end/src/services/growthbook", () => ({
  trackEventForContext: jest.fn(),
}));
jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionsByOrganization: jest.fn(),
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
  implementationType: "none",
  linkedFeatures: [],
  variations: [
    { id: "v0", screenshots: [] },
    { id: "v1", screenshots: [] },
  ],
  phases: [{ variationWeights: [0.5, 0.5] }],
} as unknown as ExperimentInterface;
const context = {
  org: { id: "org_1" },
  userId: "u_1",
  permissions: { canUpdateExperiment: () => true },
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
    { id: "sdk_1" },
  ]);
  (getExperimentLaunchChecklist as jest.Mock).mockResolvedValue(null);
});

describe("executeExperimentStart", () => {
  it("stages the scheduled stop on the authority of whoever started the experiment", async () => {
    const experiment = {
      id: "exp_1",
      status: "draft",
      owner: "u_owner",
      variations: [{ id: "v0" }, { id: "v1" }],
      phases: [{ variationWeights: [0.5, 0.5] }],
      statusUpdateSchedule: { stopAt: new Date(Date.now() + 60 * 60 * 1000) },
    } as unknown as ExperimentInterface;
    const context = {
      org: { id: "org_1" },
      userId: "u_scheduler",
    } as unknown as ReqContext;

    await executeExperimentStart(context, experiment);

    expect(updateExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          nextScheduledStatusUpdate: expect.objectContaining({
            type: "stop",
            scheduledBy: "u_scheduler",
          }),
        }),
      }),
    );
  });
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
});

describe("custom launch checklist tasks", () => {
  const customStatuses = async (experiment: ExperimentInterface) =>
    Object.fromEntries(
      (await getExperimentStartChecklistStatus(context, experiment))
        .filter((item) => item.reason.startsWith("Required custom"))
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
      name: "an unrelated draft change",
      facts: { hasUnrelatedDraftChanges: true },
      key: "unrelatedDraftChanges:flag_1",
    },
    {
      name: "a merge conflict",
      facts: { hasMergeConflict: true },
      key: "mergeConflict:flag_1",
    },
  ])(
    "refuses to fire with $name, as a retryable failure",
    async ({ facts, key }) => {
      (getLinkedFeatureInfo as jest.Mock).mockResolvedValue([
        { ...draftFlag, ...facts },
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

  it("fires with only soft items open", async () => {
    (findSDKConnectionsByOrganization as jest.Mock).mockResolvedValue([]);

    await expect(
      assertScheduledStartNotHardBlocked(context, draft),
    ).resolves.toBeUndefined();
  });
});
