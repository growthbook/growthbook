import type { Job } from "agenda";
import { updateSingleExperimentStatus } from "back-end/src/jobs/updateExperimentStatus";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getUserById } from "back-end/src/models/UserModel";
import { insertAudit } from "back-end/src/models/AuditModel";
import { executeExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { notifyScheduledStatusUpdateFailed } from "back-end/src/services/experimentNotifications";

// A staged status change was authorized when it was armed. The job fires it as
// itself and records whoever armed it, user or API key.

const getApiKey = jest.fn();
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(async () => ({
    org: { id: "org_1" },
    models: { apiKeys: { getById: getApiKey } },
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
jest.mock("back-end/src/models/UserModel", () => ({ getUserById: jest.fn() }));
jest.mock("back-end/src/models/AuditModel", () => ({ insertAudit: jest.fn() }));
jest.mock("back-end/src/services/experimentScheduling", () => ({
  applyScheduledExperimentStop: jest.fn(),
}));
jest.mock(
  "back-end/src/services/experimentChanges/changeExperimentStatus",
  () => ({
    executeExperimentStart: jest.fn(async (_ctx, experiment) => ({
      updated: { ...experiment, status: "running" },
    })),
  }),
);
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

const staged = { type: "start", date: new Date(Date.now() - 1000) };
const draft = (by: Record<string, string>) => ({
  id: "exp_1",
  status: "draft",
  owner: "u_owner",
  nextScheduledStatusUpdate: { ...staged, ...by },
});

describe("updateSingleExperimentStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserById as jest.Mock).mockResolvedValue({
      id: "u_analyst",
      email: "a@test.com",
      name: "Analyst",
    });
    getApiKey.mockResolvedValue({ description: "CI" });
  });

  it.each([
    ["a user", { scheduledBy: "u_analyst" }, { id: "u_analyst" }],
    [
      "an API key",
      { scheduledByApiKey: "key_ci" },
      { apiKey: "key_ci", name: "CI" },
    ],
    ["nobody (legacy pointer)", {}, { system: true }],
  ])("fires as the job and audits the start as %s", async (_who, by, user) => {
    (getExperimentById as jest.Mock).mockResolvedValue(draft(by));
    await updateSingleExperimentStatus(job);
    expect(executeExperimentStart).toHaveBeenCalledWith(
      expect.objectContaining({ org: { id: "org_1" } }),
      expect.objectContaining({ id: "exp_1" }),
    );
    expect(insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "experiment.status",
        user: expect.objectContaining(user),
      }),
    );
    expect(notifyScheduledStatusUpdateFailed).not.toHaveBeenCalled();
  });

  it("leaves a schedule re-staged meanwhile alone, even the same action by someone else", async () => {
    (executeExperimentStart as jest.Mock).mockRejectedValueOnce(
      new Error("boom"),
    );
    (getExperimentById as jest.Mock)
      .mockResolvedValueOnce(draft({ scheduledBy: "u_analyst" }))
      .mockResolvedValueOnce(draft({ scheduledByApiKey: "key_ci" }));
    await updateSingleExperimentStatus(job);
    expect(updateExperiment).not.toHaveBeenCalled();
    expect(notifyScheduledStatusUpdateFailed).not.toHaveBeenCalled();
  });

  it("retries a failed fire and keeps the stamp", async () => {
    (executeExperimentStart as jest.Mock).mockRejectedValueOnce(
      new Error("boom"),
    );
    (getExperimentById as jest.Mock).mockResolvedValue(
      draft({ scheduledByApiKey: "key_ci" }),
    );
    await updateSingleExperimentStatus(job);
    expect(updateExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: {
          nextScheduledStatusUpdate: expect.objectContaining({
            failedAttempts: 1,
            scheduledByApiKey: "key_ci",
          }),
        },
      }),
    );
    expect(notifyScheduledStatusUpdateFailed).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: true }),
    );
  });
});
