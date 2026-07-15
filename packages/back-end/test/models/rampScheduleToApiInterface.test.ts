// Mocked only to sever the heavy services/rampSchedule import chain — no test
// here exercises the monitoringStatus branch that calls these.
jest.mock("back-end/src/services/rampSchedule", () => ({
  getEffectiveRampAutoUpdateState: jest.fn(),
  getRampMonitoringMode: jest.fn(),
  getRampAutoUpdatePreference: jest.fn(),
}));

import { RampScheduleInterface } from "shared/validators";
import { rampScheduleToApiInterface } from "back-end/src/models/RampScheduleModel";

function makeSchedule(
  overrides: Partial<RampScheduleInterface> = {},
): RampScheduleInterface {
  return {
    id: "rs_1",
    organization: "org_1",
    dateCreated: new Date("2024-01-01T00:00:00Z"),
    dateUpdated: new Date("2024-01-01T00:00:00Z"),
    name: "Test ramp",
    entityType: "feature",
    entityId: "feat_1",
    targets: [],
    steps: [
      {
        interval: null,
        actions: [],
        holdConditions: { requiresApproval: true },
      },
    ],
    status: "running",
    currentStepIndex: 0,
    nextStepAt: null,
    ...overrides,
  } as unknown as RampScheduleInterface;
}

describe("rampScheduleToApiInterface approval fields", () => {
  it("reports awaitingApproval when the current step's only remaining gate is approval", () => {
    const api = rampScheduleToApiInterface(makeSchedule());
    expect(api.awaitingApproval).toBe(true);
    expect(api.stepApproval).toBeUndefined();
  });

  it("reports awaitingApproval for a pre-start schedule with an unapproved start gate", () => {
    const api = rampScheduleToApiInterface(
      makeSchedule({
        status: "ready",
        currentStepIndex: -1,
        requiresStartApproval: true,
        startApprovedAt: null,
      }),
    );
    expect(api.awaitingApproval).toBe(true);
  });

  it("does not report awaitingApproval while an approval step's time hold is still counting", () => {
    const api = rampScheduleToApiInterface(
      makeSchedule({
        steps: [
          {
            interval: 3600,
            actions: [],
            holdConditions: { requiresApproval: true },
          },
        ],
        nextStepAt: new Date(Date.now() + 60 * 60 * 1000),
      } as unknown as Partial<RampScheduleInterface>),
    );
    expect(api.awaitingApproval).toBe(false);
  });

  it("clears awaitingApproval and serializes stepApproval once the current step is approved", () => {
    const api = rampScheduleToApiInterface(
      makeSchedule({
        stepApproval: {
          stepIndex: 0,
          approvedAt: new Date("2024-01-02T03:04:05Z"),
          approvedBy: "u_1",
          context: "api",
        },
      }),
    );
    expect(api.awaitingApproval).toBe(false);
    expect(api.stepApproval).toEqual({
      stepIndex: 0,
      approvedAt: "2024-01-02T03:04:05.000Z",
      approvedBy: "u_1",
      context: "api",
    });
  });
});
