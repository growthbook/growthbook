import type { Response } from "express";
import { PermissionError } from "shared/util";

jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));
// The gate itself lives here now (shared with the REST handlers), so keep the
// real implementation and stub only the rest of the module's surface.
jest.mock("back-end/src/services/rampSchedule", () => ({
  assertCanControlRampSchedule: jest.requireActual(
    "back-end/src/services/rampSchedule",
  ).assertCanControlRampSchedule,
}));
jest.mock("back-end/src/services/safeRolloutSnapshots", () => ({
  createSafeRolloutSnapshot: jest.fn(),
}));
jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

import { postRampScheduleAction } from "back-end/src/routers/ramp-schedule/ramp-schedule.controller";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

/**
 * Every ramp state action — pause, resume, advance, rewind, complete — mutates
 * a rollout that is already serving users, so the handler gates ALL of them on
 * publish authority over the environments the schedule reaches, before any
 * action dispatches.
 *
 * Regression test for the gate that was missing entirely: the only check used
 * to be the model's draft-class canUpdate, so a draft-only role could pause a
 * live rollout while a publisher was refused.
 */

const SCHEDULE = {
  id: "ramp_1",
  entityId: "feat_1",
  status: "running",
  steps: [],
  targets: [],
};

function makeRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function arrange({
  canPublish,
  canQueryDatasource = true,
  monitored = false,
}: {
  canPublish: boolean;
  canQueryDatasource?: boolean;
  monitored?: boolean;
}) {
  const canPublishFeature = jest.fn(() => canPublish);
  const canCreateExperimentSnapshot = jest.fn(() => canQueryDatasource);
  // A schedule whose monitoring is configured is what makes the refresh path
  // reach its lazy SafeRollout create.
  // The refresh path answers 409 for a schedule with no monitored step, before
  // it reaches the lazy create — so the gate under test needs a real one.
  const schedule = monitored
    ? {
        ...SCHEDULE,
        currentStepIndex: 0,
        steps: [{ monitored: true, actions: [] }],
        monitoringConfig: { datasourceId: "ds_1" },
      }
    : SCHEDULE;
  (getContextFromReq as jest.Mock).mockReturnValue({
    permissions: {
      canPublishFeature,
      canCreateExperimentSnapshot,
      throwPermissionError: () => {
        throw new PermissionError("permission denied");
      },
    },
    models: {
      rampSchedules: {
        getById: jest.fn(async () => schedule),
        publishEnvironments: jest.fn(() => ["production"]),
      },
      safeRollout: { getById: jest.fn(async () => null) },
    },
  });
  (getFeature as jest.Mock).mockResolvedValue({ project: "prj_1" });
  (getDataSourceById as jest.Mock).mockResolvedValue({ id: "ds_1" });
  return { canPublishFeature, canCreateExperimentSnapshot };
}

function makeReq(action: string) {
  return {
    params: { id: "ramp_1", action },
    body: {},
  } as unknown as Parameters<typeof postRampScheduleAction>[0];
}

describe("postRampScheduleAction publish gate", () => {
  afterEach(() => jest.clearAllMocks());

  it("refuses every action without publish authority", async () => {
    arrange({ canPublish: false });
    await expect(
      postRampScheduleAction(makeReq("pause"), makeRes()),
    ).rejects.toThrow(PermissionError);
  });

  it("checks publish over the schedule's own environments", async () => {
    const { canPublishFeature } = arrange({ canPublish: false });
    await postRampScheduleAction(makeReq("pause"), makeRes()).catch(() => {});
    expect(canPublishFeature).toHaveBeenCalledWith({ project: "prj_1" }, [
      "production",
    ]);
  });

  it("refuses refresh-monitoring before the write that creates a monitoring experiment", async () => {
    // The datasource check used to be the only gate on this path and it sat
    // AFTER a lazy SafeRollout create, so an under-privileged caller reached a
    // write on its way to a 403. This pins the ORDER, not just the refusal:
    // the services/rampSchedule mock exposes only the two assertions, so
    // reaching the ensure would raise a TypeError instead of PermissionError.
    const { canPublishFeature, canCreateExperimentSnapshot } = arrange({
      canPublish: false,
      canQueryDatasource: false,
      monitored: true,
    });
    await expect(
      postRampScheduleAction(makeReq("refresh-monitoring"), makeRes()),
    ).rejects.toThrow(PermissionError);
    expect(canCreateExperimentSnapshot).toHaveBeenCalled();
    // Still not a publish gate — the refusal comes from the datasource.
    expect(canPublishFeature).not.toHaveBeenCalled();
  });

  it("exempts refresh-monitoring, which reads data rather than moving the rollout", async () => {
    // It gates on the datasource's query permission instead; with no monitored
    // steps the case answers 409, which proves the publish gate did not fire.
    const { canPublishFeature } = arrange({ canPublish: false });
    const res = makeRes();
    await postRampScheduleAction(makeReq("refresh-monitoring"), res);
    expect(canPublishFeature).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("lets a publisher past the gate", async () => {
    arrange({ canPublish: true });
    const res = makeRes();
    // An unknown action proves gate ordering without engaging the schedule
    // machinery: past the gate, the switch's default answers 400.
    await postRampScheduleAction(makeReq("not-an-action"), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Unknown action"),
      }),
    );
  });
});
