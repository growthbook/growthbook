// Mocked only to sever the heavy services/rampSchedule import chain — no test
// here exercises the monitoringStatus branch that calls these.
jest.mock("back-end/src/services/rampSchedule", () => ({
  getEffectiveRampAutoUpdateState: jest.fn(),
  getRampMonitoringMode: jest.fn(),
  getRampAutoUpdatePreference: jest.fn(),
}));

import { RampScheduleInterface } from "shared/validators";
import {
  apiMonitoringConfigToInternal,
  rampScheduleToApiInterface,
} from "back-end/src/models/RampScheduleModel";

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

  it("omits stepApproval when it belongs to a step other than the current one", () => {
    const api = rampScheduleToApiInterface(
      makeSchedule({
        currentStepIndex: 1,
        steps: [
          { interval: null, actions: [], holdConditions: {} },
          {
            interval: null,
            actions: [],
            holdConditions: { requiresApproval: true },
          },
        ] as unknown as RampScheduleInterface["steps"],
        stepApproval: {
          stepIndex: 0,
          approvedAt: new Date("2024-01-02T03:04:05Z"),
          approvedBy: "u_1",
          context: "api",
        },
      }),
    );
    expect(api.stepApproval).toBeUndefined();
    expect(api.awaitingApproval).toBe(true);
  });
});

describe("rampScheduleToApiInterface exposureQuery", () => {
  it("groups the stored exposure query id and identifier type into exposureQuery", () => {
    // A stored monitoringConfig activates the monitoringStatus branch, which
    // calls into the mocked rampSchedule service; give it valid returns.
    const svc = jest.requireMock("back-end/src/services/rampSchedule");
    svc.getRampMonitoringMode.mockReturnValue("manual");
    svc.getRampAutoUpdatePreference.mockReturnValue(false);
    svc.getEffectiveRampAutoUpdateState.mockReturnValue({
      enabled: false,
      reason: null,
    });
    const api = rampScheduleToApiInterface(
      makeSchedule({
        monitoringConfig: {
          datasourceId: "ds_1",
          exposureQueryId: "eq_1",
          exposureQueryIdentifierType: "anonymous_id",
          guardrailMetricIds: ["met_1"],
        },
      } as unknown as Partial<RampScheduleInterface>),
    );
    expect(api.monitoringConfig?.exposureQuery).toEqual({
      id: "eq_1",
      identifierType: "anonymous_id",
    });
    // deprecated flat fields still present for back-compat
    expect(api.monitoringConfig?.exposureQueryId).toBe("eq_1");
  });
});

describe("apiMonitoringConfigToInternal", () => {
  it("projects the exposureQuery object onto the flat fields", () => {
    expect(
      apiMonitoringConfigToInternal({
        datasourceId: "ds_1",
        exposureQuery: { id: "eq_1", identifierType: "anonymous_id" },
        guardrailMetricIds: ["met_1"],
      }),
    ).toEqual({
      datasourceId: "ds_1",
      exposureQueryId: "eq_1",
      exposureQueryIdentifierType: "anonymous_id",
      guardrailMetricIds: ["met_1"],
    });
  });

  it("passes through the deprecated flat fields when no object is set", () => {
    expect(
      apiMonitoringConfigToInternal({
        datasourceId: "ds_1",
        exposureQueryId: "eq_1",
        guardrailMetricIds: ["met_1"],
      }),
    ).toEqual({
      datasourceId: "ds_1",
      exposureQueryId: "eq_1",
      guardrailMetricIds: ["met_1"],
    });
  });

  it("rejects the object together with the deprecated flat fields", () => {
    expect(() =>
      apiMonitoringConfigToInternal({
        datasourceId: "ds_1",
        exposureQuery: { id: "eq_1", identifierType: "anonymous_id" },
        exposureQueryId: "eq_1",
        guardrailMetricIds: ["met_1"],
      }),
    ).toThrow("Cannot set exposureQuery together with the deprecated");
  });
});
