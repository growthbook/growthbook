import { vi } from "vitest";
import type { HoldoutInterface } from "shared/validators";
import type { ExperimentInterface } from "shared/types/experiment";
import type { ReqContext } from "back-end/types/request";
import {
  createExperiment,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getChangesToStartExperiment,
  validateExperimentData,
} from "back-end/src/services/experiments";
import {
  createHoldoutWithExperiment,
  setHoldoutStage,
} from "back-end/src/services/holdouts";
import {
  notifyHoldoutCreated,
  notifyHoldoutStatusChanged,
} from "back-end/src/services/holdoutNotifications";

vi.mock("back-end/src/models/ExperimentModel", () => ({
  createExperiment: vi.fn(),
  updateExperiment: vi.fn(),
}));
vi.mock("back-end/src/services/experiments", () => ({
  getChangesToStartExperiment: vi.fn(),
  validateExperimentData: vi.fn(),
  validateVariationIds: vi.fn(),
}));
vi.mock("back-end/src/services/holdoutNotifications", () => ({
  notifyHoldoutCreated: vi.fn(),
  notifyHoldoutStatusChanged: vi.fn(),
}));
vi.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: vi.fn(),
}));

const createHoldout = vi.fn();
const updateHoldout = vi.fn();
const context = {
  org: { id: "org", settings: {} },
  models: { holdout: { create: createHoldout, update: updateHoldout } },
} as unknown as ReqContext;
const holdout = {
  id: "hld",
  environmentSettings: {},
  projects: [],
} as unknown as HoldoutInterface;
const experiment = {
  id: "exp",
  type: "holdout",
  phases: [{ dateStarted: new Date() }],
} as unknown as ExperimentInterface;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateExperiment).mockImplementation(
    async ({ experiment, changes }) => ({
      ...experiment,
      ...changes,
    }),
  );
  updateHoldout.mockImplementation(async (holdout, changes) => ({
    ...holdout,
    ...changes,
  }));
  vi.mocked(getChangesToStartExperiment).mockResolvedValue({
    status: "running",
  });
});

it.each([
  ["draft", "running"],
  ["running", "analysis-period"],
  ["analysis-period", "stopped"],
  ["running", "stopped"],
] as const)(
  "emits %s → %s once, after both documents commit",
  async (previousStatus, currentStatus) => {
    await setHoldoutStage(context, {
      holdout: {
        ...holdout,
        ...(previousStatus === "analysis-period"
          ? { analysisStartDate: new Date() }
          : {}),
      },
      experiment: {
        ...experiment,
        status:
          previousStatus === "analysis-period" ? "running" : previousStatus,
      },
      stage: currentStatus,
    });
    expect(notifyHoldoutStatusChanged).toHaveBeenCalledTimes(1);
    expect(notifyHoldoutStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ previousStatus, currentStatus }),
    );
    expect(
      vi.mocked(notifyHoldoutStatusChanged).mock.invocationCallOrder[0],
    ).toBeGreaterThan(updateHoldout.mock.invocationCallOrder[0]);
  },
);

it("does not announce a transition that is rolled back", async () => {
  updateHoldout.mockRejectedValueOnce(new Error("Holdout write failed"));
  await expect(
    setHoldoutStage(context, {
      holdout,
      experiment: { ...experiment, status: "running" },
      stage: "stopped",
    }),
  ).rejects.toThrow("Holdout write failed");
  expect(updateExperiment).toHaveBeenCalledTimes(2);
  expect(notifyHoldoutStatusChanged).not.toHaveBeenCalled();
});

it("does not announce a failed experiment write or a repeated stage", async () => {
  await setHoldoutStage(context, {
    holdout,
    experiment: { ...experiment, status: "running" },
    stage: "running",
  });
  vi.mocked(updateExperiment).mockRejectedValueOnce(
    new Error("Experiment write failed"),
  );
  await expect(
    setHoldoutStage(context, {
      holdout,
      experiment: { ...experiment, status: "running" },
      stage: "stopped",
    }),
  ).rejects.toThrow("Experiment write failed");
  expect(notifyHoldoutStatusChanged).not.toHaveBeenCalled();
});

describe("holdout creation notifications", () => {
  beforeEach(() => {
    vi.mocked(validateExperimentData).mockResolvedValue({
      metricIds: [],
      datasource: null,
    });
    vi.mocked(createExperiment).mockResolvedValue({
      ...experiment,
      name: "New holdout",
    });
    createHoldout.mockResolvedValue({ ...holdout, name: "New holdout" });
  });

  it("announces creation after both documents are saved", async () => {
    const result = await createHoldoutWithExperiment(context, {
      name: "New holdout",
    });
    expect(notifyHoldoutCreated).toHaveBeenCalledWith({
      context,
      holdout: result.holdout,
    });
    expect(createHoldout.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(createExperiment).mock.invocationCallOrder[0],
    );
    expect(
      vi.mocked(notifyHoldoutCreated).mock.invocationCallOrder[0],
    ).toBeGreaterThan(createHoldout.mock.invocationCallOrder[0]);
  });

  it("does not announce creation if saving the holdout fails", async () => {
    createHoldout.mockRejectedValueOnce(new Error("Holdout save failed"));
    await expect(
      createHoldoutWithExperiment(context, { name: "New holdout" }),
    ).rejects.toThrow("Holdout save failed");
    expect(notifyHoldoutCreated).not.toHaveBeenCalled();
  });

  it("does not announce creation if saving the experiment fails", async () => {
    vi.mocked(createExperiment).mockRejectedValueOnce(
      new Error("Experiment save failed"),
    );
    await expect(
      createHoldoutWithExperiment(context, { name: "New holdout" }),
    ).rejects.toThrow("Experiment save failed");
    expect(createHoldout).not.toHaveBeenCalled();
    expect(notifyHoldoutCreated).not.toHaveBeenCalled();
  });
});
