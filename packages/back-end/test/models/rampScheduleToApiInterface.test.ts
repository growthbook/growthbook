// Mocked only to sever the heavy services/rampSchedule import chain — no test
// here exercises the monitoringStatus branch that calls these.
jest.mock("back-end/src/services/rampSchedule", () => ({
  getEffectiveRampAutoUpdateState: jest.fn(),
  getRampMonitoringMode: jest.fn(),
  getRampAutoUpdatePreference: jest.fn(),
}));

import { RampScheduleInterface } from "shared/validators";
import { apiMonitoringConfigToInternal } from "shared/util";
import { ReqContext } from "back-end/types/request";
import { rampScheduleToApiInterface } from "back-end/src/models/RampScheduleModel";

const context = {
  foreignRefs: { datasource: new Map() },
} as unknown as ReqContext;

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
    const api = rampScheduleToApiInterface(context, makeSchedule());
    expect(api.awaitingApproval).toBe(true);
    expect(api.stepApproval).toBeUndefined();
  });

  it("reports awaitingApproval for a pre-start schedule with an unapproved start gate", () => {
    const api = rampScheduleToApiInterface(
      context,
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
      context,
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
      context,
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
      context,
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

describe("apiMonitoringConfigToInternal", () => {
  it("requires one of the exposure query fields", () => {
    expect(() =>
      apiMonitoringConfigToInternal({
        datasourceId: "ds_1",
        guardrailMetricIds: ["met_1"],
      }),
    ).toThrow("monitoringConfig.exposureQuery is required");
  });

  describe("re-sending the stored query without an identifier", () => {
    const previous = {
      datasourceId: "ds_1",
      exposureQueryId: "eq_1",
      exposureQueryIdentifierType: "user_id",
    };

    it("keeps the stored identifier instead of dropping it", () => {
      expect(
        apiMonitoringConfigToInternal(
          { datasourceId: "ds_1", exposureQuery: { id: "eq_1" } },
          previous,
        ).exposureQueryIdentifierType,
      ).toBe("user_id");
      expect(
        apiMonitoringConfigToInternal(
          { datasourceId: "ds_1", exposureQueryId: "eq_1" },
          previous,
        ).exposureQueryIdentifierType,
      ).toBe("user_id");
    });

    it("uses an identifier the request names", () => {
      expect(
        apiMonitoringConfigToInternal(
          {
            datasourceId: "ds_1",
            exposureQuery: { id: "eq_1", identifierType: "anonymous_id" },
          },
          previous,
        ).exposureQueryIdentifierType,
      ).toBe("anonymous_id");
    });

    it("doesn't carry the identifier to a different query or data source", () => {
      expect(
        apiMonitoringConfigToInternal(
          { datasourceId: "ds_1", exposureQuery: { id: "eq_2" } },
          previous,
        ).exposureQueryIdentifierType,
      ).toBeUndefined();
      expect(
        apiMonitoringConfigToInternal(
          { datasourceId: "ds_2", exposureQuery: { id: "eq_1" } },
          previous,
        ).exposureQueryIdentifierType,
      ).toBeUndefined();
    });
  });
});
