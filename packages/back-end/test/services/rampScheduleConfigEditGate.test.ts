import { PermissionError } from "shared/util";
import type { RampScheduleInterface } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";

jest.mock("back-end/src/services/organizations", () => ({
  getEnvironmentIdsFromOrg: jest.fn(() => ["dev", "production"]),
  getContextForAgendaJobByOrgObject: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  getFeatureProjectsByIds: jest.fn(async () => new Map([["feat_1", "prj_1"]])),
  getFeatureRuleEnvironmentsByIds: jest.fn(async () => new Map()),
}));
jest.mock("back-end/src/services/safeRolloutSnapshots", () => ({
  createSafeRolloutSnapshot: jest.fn(),
}));
jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

import { assertCanEditRampScheduleConfig } from "back-end/src/services/rampSchedule";

// The PUT-style config edit gate shared by the dashboard and REST update
// handlers: execution-field edits on a schedule that is armed before or after
// the edit take publish authority; everything else stays draft-class.

const ARMED_AT = new Date("2030-01-01T00:00:00Z");

const schedule = (nextProcessAt: Date | null) =>
  ({
    id: "ramp_1",
    entityType: "feature",
    entityId: "feat_1",
    status: "ready",
    targets: [
      {
        id: "t_1",
        entityType: "feature",
        entityId: "feat_1",
        status: "active",
      },
    ],
    steps: [
      {
        actions: [{ targetId: "t_1", patch: { environments: ["production"] } }],
      },
    ],
    startActions: [],
    nextProcessAt,
  }) as unknown as RampScheduleInterface;

function makeContext(canPublish: boolean) {
  const canPublishFeature = jest.fn(() => canPublish);
  const context = {
    org: { id: "org_1" },
    permissions: {
      canPublishFeature,
      throwPermissionError: () => {
        throw new PermissionError("permission denied");
      },
    },
    models: {
      rampSchedules: { publishEnvironments: jest.fn(() => ["production"]) },
    },
  } as unknown as ApiReqContext;
  return { context, canPublishFeature };
}

describe("assertCanEditRampScheduleConfig", () => {
  afterEach(() => jest.clearAllMocks());

  it("does not ask for publish authority on a name-only edit of an armed schedule", async () => {
    const { context, canPublishFeature } = makeContext(false);
    await expect(
      assertCanEditRampScheduleConfig(context, schedule(ARMED_AT), {
        name: "renamed",
        nextProcessAt: ARMED_AT,
      }),
    ).resolves.toBeUndefined();
    expect(canPublishFeature).not.toHaveBeenCalled();
  });

  it("does not ask for publish authority to edit steps of a schedule that is not armed before or after", async () => {
    const { context, canPublishFeature } = makeContext(false);
    await expect(
      assertCanEditRampScheduleConfig(context, schedule(null), {
        steps: [],
        nextProcessAt: null,
      }),
    ).resolves.toBeUndefined();
    expect(canPublishFeature).not.toHaveBeenCalled();
  });

  it("refuses a steps edit on an armed schedule without publish authority", async () => {
    const { context, canPublishFeature } = makeContext(false);
    await expect(
      assertCanEditRampScheduleConfig(context, schedule(ARMED_AT), {
        steps: [],
        nextProcessAt: ARMED_AT,
      }),
    ).rejects.toThrow(PermissionError);
    expect(canPublishFeature).toHaveBeenCalledWith({ project: "prj_1" }, [
      "production",
    ]);
  });

  it("refuses arming a dateless schedule (startDate edit) without publish authority", async () => {
    const { context } = makeContext(false);
    await expect(
      assertCanEditRampScheduleConfig(context, schedule(null), {
        startDate: ARMED_AT,
        nextProcessAt: ARMED_AT,
      }),
    ).rejects.toThrow(PermissionError);
  });

  it("allows an execution-field edit on an armed schedule with publish authority", async () => {
    const { context, canPublishFeature } = makeContext(true);
    await expect(
      assertCanEditRampScheduleConfig(context, schedule(ARMED_AT), {
        cutoffDate: null,
        nextProcessAt: ARMED_AT,
      }),
    ).resolves.toBeUndefined();
    expect(canPublishFeature).toHaveBeenCalled();
  });
});
