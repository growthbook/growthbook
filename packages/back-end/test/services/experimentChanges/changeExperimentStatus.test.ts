import { ExperimentInterface } from "shared/types/experiment";
import { ReqContext } from "back-end/types/request";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { executeExperimentStart } from "back-end/src/services/experimentChanges/changeExperimentStatus";

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
  getChangesToStartExperiment: jest.fn(async () => ({ status: "running" })),
}));
jest.mock("back-end/src/services/growthbook", () => ({
  trackEventForContext: jest.fn(),
}));

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
