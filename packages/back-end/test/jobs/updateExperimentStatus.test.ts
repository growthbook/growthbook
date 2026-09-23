import type { Job } from "agenda";
import { PermissionError } from "shared/util";
import { updateSingleExperimentStatus } from "back-end/src/jobs/updateExperimentStatus";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getScheduledStatusContext } from "back-end/src/services/experimentScheduling";
import { executeExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { assertCanRunExperimentInAffectedEnvironments } from "back-end/src/services/experiments";
import { notifyScheduledStatusUpdateFailed } from "back-end/src/services/experimentNotifications";

// A staged status change fires on the authority of whoever staged it, re-checked
// at fire time, like a scheduled feature publish. No authority, no change.

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(async () => ({
    org: { id: "org_1" },
  })),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  getExperimentsWithScheduledStatusUpdate: jest.fn(),
  updateExperiment: jest.fn(async ({ experiment, changes }) => ({
    ...experiment,
    ...changes,
  })),
}));
jest.mock("back-end/src/services/experimentScheduling", () => ({
  applyScheduledExperimentStop: jest.fn(),
  getScheduledStatusContext: jest.fn(),
}));
jest.mock(
  "back-end/src/services/experimentChanges/changeExperimentStatus",
  () => ({
    executeExperimentStart: jest.fn(async (_ctx, experiment) => ({
      updated: { ...experiment, status: "running" },
    })),
  }),
);
jest.mock("back-end/src/services/experiments", () => ({
  assertCanRunExperimentInAffectedEnvironments: jest.fn(),
}));
jest.mock("back-end/src/services/experimentNotifications", () => ({
  notifyScheduledEndDecision: jest.fn(),
  notifyScheduledStatusUpdateApplied: jest.fn(),
  notifyScheduledStatusUpdateFailed: jest.fn(),
}));
jest.mock("back-end/src/services/audit", () => ({
  auditDetailsUpdate: jest.fn(() => ({})),
}));

const job = {
  attrs: { data: { experimentId: "exp_1", organization: "org_1" } },
} as unknown as Job<{ experimentId: string; organization: string }>;

const draft = {
  id: "exp_1",
  status: "draft",
  owner: "u_owner",
  nextScheduledStatusUpdate: {
    type: "start",
    date: new Date(Date.now() - 1000),
    scheduledBy: "u_analyst",
  },
};
const scheduler = { org: { id: "org_1" }, auditLog: jest.fn() };

describe("updateSingleExperimentStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getExperimentById as jest.Mock).mockResolvedValue(draft);
    (getScheduledStatusContext as jest.Mock).mockResolvedValue(scheduler);
  });

  it("starts the experiment as the user who scheduled it", async () => {
    await updateSingleExperimentStatus(job);
    expect(assertCanRunExperimentInAffectedEnvironments).toHaveBeenCalledWith(
      scheduler,
      draft,
    );
    expect(executeExperimentStart).toHaveBeenCalledWith(scheduler, draft);
    expect(scheduler.auditLog).toHaveBeenCalled();
    expect(notifyScheduledStatusUpdateFailed).not.toHaveBeenCalled();
  });

  it("gives up at once when the scheduler may not run the experiment", async () => {
    (
      assertCanRunExperimentInAffectedEnvironments as jest.Mock
    ).mockRejectedValue(new PermissionError("nope"));
    await updateSingleExperimentStatus(job);
    expect(executeExperimentStart).not.toHaveBeenCalled();
    expect(updateExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { nextScheduledStatusUpdate: null } }),
    );
    expect(notifyScheduledStatusUpdateFailed).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: false }),
    );
  });

  it("leaves a schedule re-staged meanwhile alone, even the same action by someone else", async () => {
    (getScheduledStatusContext as jest.Mock).mockResolvedValue(null);
    (getExperimentById as jest.Mock)
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        nextScheduledStatusUpdate: {
          ...draft.nextScheduledStatusUpdate,
          scheduledBy: "u_other",
        },
      });
    await updateSingleExperimentStatus(job);
    expect(updateExperiment).not.toHaveBeenCalled();
    expect(notifyScheduledStatusUpdateFailed).not.toHaveBeenCalled();
  });

  it("retries when the scheduling user cannot be resolved yet", async () => {
    (getScheduledStatusContext as jest.Mock).mockResolvedValue(null);
    await updateSingleExperimentStatus(job);
    expect(executeExperimentStart).not.toHaveBeenCalled();
    expect(updateExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: {
          nextScheduledStatusUpdate: expect.objectContaining({
            failedAttempts: 1,
            scheduledBy: "u_analyst",
          }),
        },
      }),
    );
    expect(notifyScheduledStatusUpdateFailed).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: true }),
    );
  });
});
