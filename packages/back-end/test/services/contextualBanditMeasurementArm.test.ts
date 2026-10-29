import {
  ContextualBanditInterface,
  ContextualBanditMeasurementArm,
} from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ReqContext } from "back-end/types/request";
import {
  createExperiment,
  deleteExperimentByIdForOrganization,
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getLatestSnapshotStatus,
  getLatestSuccessfulSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { queueExperimentUpdate } from "back-end/src/jobs/updateExperimentResults";
import {
  assertMeasurementArmChangeAllowed,
  assertMeasurementArmExperimentEditable,
  buildMeasurementArmSubdoc,
  cbGovernedChanges,
  getMeasurementArmResultsSummary,
  MEASUREMENT_ARM_GOVERNING_CB_FIELDS,
  measurementArmSyncFieldsChanged,
  reconcileMeasurementArmExperiment,
  refreshMeasurementArmAfterBanditRun,
  syncMeasurementArmExperiment,
} from "back-end/src/enterprise/services/contextualBanditMeasurementArm";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  createExperiment: jest.fn(),
  deleteExperimentByIdForOrganization: jest.fn(),
  getExperimentById: jest.fn(),
  updateExperiment: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSnapshotStatus: jest.fn(),
  getLatestSuccessfulSnapshot: jest.fn(),
}));
jest.mock("back-end/src/jobs/updateExperimentResults", () => ({
  queueExperimentUpdate: jest.fn(),
}));

const createExperimentMock = createExperiment as jest.Mock;
const deleteExperimentMock = deleteExperimentByIdForOrganization as jest.Mock;
const getExperimentByIdMock = getExperimentById as jest.Mock;
const updateExperimentMock = updateExperiment as jest.Mock;
const getLatestSnapshotStatusMock = getLatestSnapshotStatus as jest.Mock;
const getLatestSuccessfulSnapshotMock =
  getLatestSuccessfulSnapshot as jest.Mock;
const queueExperimentUpdateMock = queueExperimentUpdate as jest.Mock;

const cbQuery = { id: "cbq_1", userIdType: "anonymous_id" };

const context = {
  org: { id: "org_1", settings: {} },
  userId: "u_1",
  models: {
    contextualBanditQueries: {
      getById: jest.fn().mockResolvedValue(cbQuery),
    },
  },
} as unknown as ReqContext;

const arm: ContextualBanditMeasurementArm = {
  enabled: true,
  percent: 0.1,
  experimentId: "exp_ma",
  trackingKey: "cb-key__measurement_arm",
  seed: "seed-1",
};

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    name: "CB",
    description: "",
    tags: [],
    project: "",
    owner: "",
    hashAttribute: "id",
    trackingKey: "cb-key",
    datasource: "ds_1",
    contextualBanditQueryId: "cbq_1",
    decisionMetric: "met_g",
    status: "running",
    archived: false,
    dateStarted: new Date("2026-01-01"),
    coverage: 1,
    condition: "",
    savedGroups: [],
    prerequisites: [],
    measurementArm: arm,
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeArmExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  const cb = makeCb();
  return {
    id: "exp_ma",
    organization: "org_1",
    owner: "",
    status: "running",
    goalMetrics: ["met_g"],
    ...cbGovernedChanges(cb, arm, cbQuery),
    ...overrides,
  } as ExperimentInterface;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("buildMeasurementArmSubdoc", () => {
  const existing = {
    enabled: true,
    percent: 0.1,
    experimentId: "exp-ma",
    trackingKey: "cb-key__measurement_arm",
    seed: "seed-1",
  };

  it("defaults a new arm to off at 5% when the API body omits it", () => {
    const arm = buildMeasurementArmSubdoc({ cbTrackingKey: "cb-key" });
    expect(arm).toMatchObject({
      enabled: false,
      percent: 0.05,
      trackingKey: "cb-key__measurement_arm",
    });
    expect(arm.seed).toBeTruthy();
  });

  it("enables the arm when asked, at the default percent", () => {
    expect(
      buildMeasurementArmSubdoc({ enabled: true, cbTrackingKey: "cb-key" }),
    ).toMatchObject({ enabled: true, percent: 0.05 });
  });

  it("keeps the stored percent, experiment and seed when disabling", () => {
    const arm = buildMeasurementArmSubdoc({
      enabled: false,
      existing,
      cbTrackingKey: "cb-key",
    });
    expect(arm).toMatchObject({
      enabled: false,
      percent: 0.1,
      experimentId: "exp-ma",
      seed: "seed-1",
    });
  });

  it("keeps the stored tracking key unless asked to re-derive it", () => {
    expect(
      buildMeasurementArmSubdoc({ existing, cbTrackingKey: "renamed" })
        .trackingKey,
    ).toBe("cb-key__measurement_arm");
    expect(
      buildMeasurementArmSubdoc({
        existing,
        cbTrackingKey: "renamed",
        rederiveTrackingKey: true,
      }).trackingKey,
    ).toBe("renamed__measurement_arm");
  });
});

describe("assertMeasurementArmChangeAllowed", () => {
  const arm = { enabled: true, percent: 0.1, seed: "s" };
  const draft = {
    status: "draft",
    measurementArm: arm,
  } as unknown as ContextualBanditInterface;
  const running = {
    ...draft,
    status: "running",
  } as unknown as ContextualBanditInterface;

  it("allows changes while the CB is a draft", () => {
    expect(() =>
      assertMeasurementArmChangeAllowed(draft, {
        measurementArm: { ...arm, percent: 0.2 },
      }),
    ).not.toThrow();
  });

  it("locks enabled and percent once the CB has started", () => {
    expect(() =>
      assertMeasurementArmChangeAllowed(running, {
        measurementArm: { ...arm, percent: 0.2 },
      }),
    ).toThrow(/measurement_arm_locked/);
    expect(() =>
      assertMeasurementArmChangeAllowed(running, {
        measurementArm: { ...arm, enabled: false },
      }),
    ).toThrow(/measurement_arm_locked/);
  });

  it("ignores writes that keep enabled and percent as they are", () => {
    expect(() =>
      assertMeasurementArmChangeAllowed(running, {
        measurementArm: { ...arm, trackingKey: "renamed__measurement_arm" },
      }),
    ).not.toThrow();
    expect(() => assertMeasurementArmChangeAllowed(running, {})).not.toThrow();
  });
});

describe("assertMeasurementArmExperimentEditable", () => {
  const experiment = {
    type: "contextualBanditMeasurementArm",
    name: "CB — measurement arm",
    goalMetrics: ["met_g"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    phases: [{ dateStarted: new Date("2026-01-01") }],
  } as unknown as ExperimentInterface;

  it("allows secondary and guardrail metric changes", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        secondaryMetrics: ["met_s"],
        guardrailMetrics: ["met_gr"],
      }),
    ).not.toThrow();
  });

  it("rejects a CUPED toggle", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        regressionAdjustmentEnabled: true,
      }),
    ).toThrow(/regressionAdjustmentEnabled/);
  });

  it("allows unchanged governed fields to be re-sent", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        name: "CB — measurement arm",
        goalMetrics: ["met_g"],
        description: "",
      }),
    ).not.toThrow();
  });

  it("rejects changes to governed fields and phase dates", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        goalMetrics: ["met_other"],
      }),
    ).toThrow(/goalMetrics/);
    expect(() =>
      assertMeasurementArmExperimentEditable(experiment, {
        phaseStartDate: "2026-02-01",
        currentPhase: 0,
      }),
    ).toThrow(/phaseStartDate/);
  });

  it("does nothing for other experiment types", () => {
    expect(() =>
      assertMeasurementArmExperimentEditable(
        { ...experiment, type: "standard" } as ExperimentInterface,
        { goalMetrics: ["met_other"] },
      ),
    ).not.toThrow();
  });
});

describe("measurementArmSyncFieldsChanged", () => {
  const cb = {
    id: "cb1",
    name: "CB",
    status: "running",
    coverage: 1,
    nextSnapshotAttempt: new Date("2026-01-01"),
    analysisSummary: { foo: 1 },
    dateUpdated: new Date("2026-01-01"),
  } as unknown as ContextualBanditInterface;

  it("ignores operational writes", () => {
    const next = {
      ...cb,
      nextSnapshotAttempt: new Date("2026-02-01"),
      analysisSummary: { foo: 2 },
      dateUpdated: new Date("2026-02-01"),
    } as unknown as ContextualBanditInterface;
    expect(measurementArmSyncFieldsChanged(cb, next)).toBe(false);
  });

  it("flags governed field changes", () => {
    expect(
      measurementArmSyncFieldsChanged(cb, {
        ...cb,
        status: "stopped",
      } as ContextualBanditInterface),
    ).toBe(true);
    expect(
      measurementArmSyncFieldsChanged(cb, {
        ...cb,
        coverage: 0.5,
      } as ContextualBanditInterface),
    ).toBe(true);
  });
});

describe("cbGovernedChanges", () => {
  it("reads only CB fields that trigger a re-sync", () => {
    const accessed = new Set<string>();
    const cb = new Proxy(makeCb(), {
      get(target, key) {
        if (typeof key === "string") accessed.add(key);
        return Reflect.get(target, key);
      },
    });
    cbGovernedChanges(cb, arm, cbQuery);
    accessed.delete("id");
    const governing: readonly string[] = MEASUREMENT_ARM_GOVERNING_CB_FIELDS;
    expect([...accessed].filter((k) => !governing.includes(k))).toEqual([]);
  });

  it("gives the arm the CB's owner, never the creator", () => {
    expect(cbGovernedChanges(makeCb({ owner: "" }), arm, cbQuery).owner).toBe(
      "",
    );
    expect(
      cbGovernedChanges(makeCb({ owner: "u_cb" }), arm, cbQuery).owner,
    ).toBe("u_cb");
  });

  it("takes the analysis identifier from the Bandit's query", () => {
    expect(
      cbGovernedChanges(makeCb(), arm, cbQuery).exposureQueryIdentifierType,
    ).toBe("anonymous_id");
    expect(
      cbGovernedChanges(makeCb(), arm, null).exposureQueryIdentifierType,
    ).toBe("");
  });
});

describe("reconcileMeasurementArmExperiment", () => {
  it("creates the experiment when the arm is enabled without one", async () => {
    createExperimentMock.mockResolvedValue({
      id: "exp_new",
      trackingKey: "cb-key__measurement_arm",
    });
    const cb = makeCb({
      status: "draft",
      measurementArm: { ...arm, experimentId: undefined },
    });
    const patch = await reconcileMeasurementArmExperiment(context, cb);
    expect(createExperimentMock).toHaveBeenCalledTimes(1);
    expect(createExperimentMock.mock.calls[0][0].data).toMatchObject({
      type: "contextualBanditMeasurementArm",
      contextualBanditId: "cb_1",
      trackingKey: "cb-key__measurement_arm",
      excludeFromPayload: true,
      exposureQueryIdentifierType: "anonymous_id",
      goalMetrics: ["met_g"],
      owner: "",
    });
    expect(
      createExperimentMock.mock.calls[0][0].data.regressionAdjustmentEnabled,
    ).toBeUndefined();
    expect(patch).toEqual({
      measurementArm: { ...arm, experimentId: "exp_new" },
    });
  });

  it("deletes the experiment when the arm is disabled with one", async () => {
    getExperimentByIdMock.mockResolvedValue(makeArmExperiment());
    const cb = makeCb({
      status: "draft",
      measurementArm: { ...arm, enabled: false },
    });
    const patch = await reconcileMeasurementArmExperiment(context, cb);
    expect(deleteExperimentMock).toHaveBeenCalledTimes(1);
    expect(patch).toEqual({
      measurementArm: { ...arm, enabled: false, experimentId: undefined },
    });
  });

  it("is a no-op when the arm already matches its experiment", async () => {
    expect(await reconcileMeasurementArmExperiment(context, makeCb())).toBe(
      null,
    );
    expect(
      await reconcileMeasurementArmExperiment(
        context,
        makeCb({ measurementArm: undefined }),
      ),
    ).toBe(null);
    expect(createExperimentMock).not.toHaveBeenCalled();
    expect(deleteExperimentMock).not.toHaveBeenCalled();
  });
});

describe("syncMeasurementArmExperiment", () => {
  it("skips when the experiment is missing", async () => {
    getExperimentByIdMock.mockResolvedValue(null);
    expect(await syncMeasurementArmExperiment(context, makeCb())).toBe(null);
    expect(updateExperimentMock).not.toHaveBeenCalled();
  });

  it("does not write when nothing governed changed", async () => {
    const experiment = makeArmExperiment();
    getExperimentByIdMock.mockResolvedValue(experiment);
    expect(await syncMeasurementArmExperiment(context, makeCb())).toBe(
      experiment,
    );
    expect(updateExperimentMock).not.toHaveBeenCalled();
  });

  it("writes only the governed fields that changed", async () => {
    const experiment = makeArmExperiment();
    getExperimentByIdMock.mockResolvedValue(experiment);
    updateExperimentMock.mockImplementation(async ({ changes }) => ({
      ...experiment,
      ...changes,
    }));
    const stopped = makeCb({
      status: "stopped",
      dateStopped: new Date("2026-02-01"),
      coverage: 0.5,
    });
    await syncMeasurementArmExperiment(context, stopped);
    expect(updateExperimentMock).toHaveBeenCalledTimes(1);
    const { changes, bypassWebhooks } = updateExperimentMock.mock.calls[0][0];
    expect(bypassWebhooks).toBe(true);
    expect(Object.keys(changes).sort()).toEqual(["phases", "status"]);
    expect(changes.status).toBe("stopped");
    expect(context.models.contextualBanditQueries.getById).toHaveBeenCalledWith(
      "cbq_1",
    );
    expect(changes.phases[0]).toMatchObject({
      coverage: 0.5,
      dateEnded: new Date("2026-02-01"),
      seed: "seed-1",
    });
  });
});

describe("getMeasurementArmResultsSummary", () => {
  it("returns null when the CB has no active arm", async () => {
    expect(
      await getMeasurementArmResultsSummary(
        context,
        makeCb({ measurementArm: { ...arm, enabled: false } }),
      ),
    ).toBe(null);
    expect(getExperimentByIdMock).not.toHaveBeenCalled();
  });

  it("reads the bandit vs. control comparison from the latest successful snapshot", async () => {
    getExperimentByIdMock.mockResolvedValue(makeArmExperiment());
    getLatestSnapshotStatusMock.mockResolvedValue({
      id: "snap_running",
      status: "running",
      dateCreated: new Date("2026-03-02"),
    });
    getLatestSuccessfulSnapshotMock.mockResolvedValue({
      id: "snap_ok",
      dateCreated: new Date("2026-03-01"),
      analyses: [
        {
          results: [
            {
              variations: [
                { users: 100, metrics: { met_g: { cr: 0.1 } } },
                {
                  users: 900,
                  metrics: {
                    met_g: {
                      cr: 0.12,
                      expected: 0.2,
                      ci: [0.05, 0.35],
                      chanceToWin: 0.97,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ExperimentSnapshotInterface);

    const summary = await getMeasurementArmResultsSummary(context, makeCb());
    expect(summary).toEqual({
      experimentId: "exp_ma",
      trackingKey: "cb-key__measurement_arm",
      percent: 0.1,
      status: "running",
      latestSnapshot: {
        id: "snap_running",
        dateCreated: "2026-03-02T00:00:00.000Z",
        status: "running",
        error: undefined,
      },
      resultsSnapshot: {
        id: "snap_ok",
        dateCreated: "2026-03-01T00:00:00.000Z",
      },
      decisionMetricResult: {
        metricId: "met_g",
        controlMean: 0.1,
        banditMean: 0.12,
        controlUsers: 100,
        banditUsers: 900,
        lift: 0.2,
        ci: [0.05, 0.35],
        chanceToWin: 0.97,
        pValue: null,
      },
    });
  });

  it("reports no comparison before the first successful analysis", async () => {
    getExperimentByIdMock.mockResolvedValue(makeArmExperiment());
    getLatestSnapshotStatusMock.mockResolvedValue({
      id: "snap_err",
      status: "error",
      error: "boom",
      dateCreated: new Date("2026-03-02"),
    });
    getLatestSuccessfulSnapshotMock.mockResolvedValue(null);
    const summary = await getMeasurementArmResultsSummary(context, makeCb());
    expect(summary?.latestSnapshot).toMatchObject({
      status: "error",
      error: "boom",
    });
    expect(summary?.resultsSnapshot).toBe(null);
    expect(summary?.decisionMetricResult).toBe(null);
  });
});

describe("refreshMeasurementArmAfterBanditRun", () => {
  it("queues the arm's scheduled update when the arm is active", async () => {
    await refreshMeasurementArmAfterBanditRun(makeCb());
    expect(queueExperimentUpdateMock).toHaveBeenCalledWith("org_1", "exp_ma");
  });

  it("does nothing when the arm is off or the CB is not running", async () => {
    await refreshMeasurementArmAfterBanditRun(
      makeCb({ measurementArm: { ...arm, enabled: false } }),
    );
    await refreshMeasurementArmAfterBanditRun(makeCb({ status: "stopped" }));
    expect(queueExperimentUpdateMock).not.toHaveBeenCalled();
  });

  it("never fails the bandit run when queueing fails", async () => {
    queueExperimentUpdateMock.mockRejectedValueOnce(new Error("agenda down"));
    await expect(
      refreshMeasurementArmAfterBanditRun(makeCb()),
    ).resolves.toBeUndefined();
  });
});
