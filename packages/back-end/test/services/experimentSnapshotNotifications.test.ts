import type { ExperimentInterface } from "shared/types/experiment";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { notifyExperimentUpdateFailed } from "back-end/src/services/experimentNotifications";
import { notifySnapshotUpdateFailure } from "back-end/src/services/experimentSnapshotNotifications";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));
jest.mock("back-end/src/services/experimentNotifications", () => ({
  notifyExperimentUpdateFailed: jest.fn(),
}));
const context = { org: { id: "org" } } as Context;
const experiment = { id: "exp", status: "running" } as ExperimentInterface;
const snapshot = {
  id: "snap",
  experiment: "exp",
  type: "standard",
  status: "error",
  analyses: [],
} as unknown as ExperimentSnapshotInterface;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getExperimentById).mockResolvedValue(experiment);
});

it.each(["query", "analysis", "no-queries"] as const)(
  "notifies for persisted %s failures",
  async (failureCause) => {
    await notifySnapshotUpdateFailure({ context, snapshot, failureCause });
    expect(notifyExperimentUpdateFailed).toHaveBeenCalledWith({
      context,
      experiment,
      cause: failureCause,
    });
  },
);

it("treats metric compute failures as analysis failures even when the snapshot succeeded", async () => {
  await notifySnapshotUpdateFailure({
    context,
    snapshot: {
      ...snapshot,
      status: "success",
      analyses: [
        {
          results: [
            { variations: [{ metrics: { revenue: { computeFailed: true } } }] },
          ],
        },
      ],
    } as unknown as ExperimentSnapshotInterface,
  });
  expect(notifyExperimentUpdateFailed).toHaveBeenCalledWith({
    context,
    experiment,
    cause: "analysis",
  });
});

it.each([
  { status: "running" },
  { status: "success" },
  { report: "report" },
  { type: "exploratory" },
] as Partial<ExperimentSnapshotInterface>[])(
  "ignores ineligible snapshots %j",
  async (overrides) => {
    await notifySnapshotUpdateFailure({
      context,
      snapshot: { ...snapshot, ...overrides },
    });
    expect(getExperimentById).not.toHaveBeenCalled();
    expect(notifyExperimentUpdateFailed).not.toHaveBeenCalled();
  },
);

it("does not notify cancellations or reset the existing failure period", async () => {
  await notifySnapshotUpdateFailure({
    context,
    snapshot,
    failureCause: "cancelled",
  });
  expect(notifyExperimentUpdateFailed).not.toHaveBeenCalled();
});

it("ignores deleted experiments", async () => {
  jest.mocked(getExperimentById).mockResolvedValue(null);
  await notifySnapshotUpdateFailure({ context, snapshot });
  expect(notifyExperimentUpdateFailed).not.toHaveBeenCalled();
});

it("does not fail snapshot finalization if notification fails", async () => {
  jest
    .mocked(notifyExperimentUpdateFailed)
    .mockRejectedValueOnce(new Error("Notification failed"));
  await expect(
    notifySnapshotUpdateFailure({ context, snapshot }),
  ).resolves.toBeUndefined();
});
