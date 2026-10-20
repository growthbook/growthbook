import type { ExperimentInterface } from "shared/types/experiment";
import type { ReqContext } from "back-end/types/request";
import { deleteExperimentWithLinks } from "back-end/src/services/experiments";

// Import cycles: a lazy Proxy defers requireActual to first property access.
const mockGetFeaturesByIds = jest.fn();
const mockGetFeatureProjectsByIds = jest.fn();
const mockDeleteExperimentByIdForOrganization = jest.fn();
const mockRemoveExperimentFromPresentations = jest.fn();
const mockLoggerWarn = jest.fn();

// A function declaration: hoisted, so the hoisted jest.mock factories can call it.
function lazyMock(modulePath: string, overrides: Record<string, unknown>) {
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual(modulePath)[prop],
    },
  );
}
jest.mock("back-end/src/models/FeatureModel", () =>
  lazyMock("back-end/src/models/FeatureModel", {
    getFeaturesByIds: (...args: unknown[]) => mockGetFeaturesByIds(...args),
    getFeatureProjectsByIds: (...args: unknown[]) =>
      mockGetFeatureProjectsByIds(...args),
  }),
);
jest.mock("back-end/src/models/ExperimentModel", () =>
  lazyMock("back-end/src/models/ExperimentModel", {
    deleteExperimentByIdForOrganization: (...args: unknown[]) =>
      mockDeleteExperimentByIdForOrganization(...args),
  }),
);
jest.mock("back-end/src/services/presentations", () =>
  lazyMock("back-end/src/services/presentations", {
    removeExperimentFromPresentations: (...args: unknown[]) =>
      mockRemoveExperimentFromPresentations(...args),
  }),
);
jest.mock("back-end/src/util/logger", () =>
  lazyMock("back-end/src/util/logger", {
    logger: {
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  }),
);

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    project: "proj_1",
    status: "stopped",
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeContext({
  canDelete = true,
  canRun = true,
}: { canDelete?: boolean; canRun?: boolean } = {}) {
  const permissions = {
    canDeleteExperiment: jest.fn(() => canDelete),
    canRunExperiment: jest.fn(() => canRun),
    throwPermissionError: jest.fn(() => {
      throw new Error("permission denied");
    }),
  };
  const removeExperimentFromHoldout = jest.fn<
    Promise<void>,
    [string, string]
  >();
  removeExperimentFromHoldout.mockResolvedValue();
  const auditLog = jest.fn<Promise<void>, [unknown]>();
  auditLog.mockResolvedValue();
  const context = {
    org: { id: "org_1", settings: { environments: [{ id: "production" }] } },
    permissions,
    models: { holdout: { removeExperimentFromHoldout } },
    auditLog,
  } as unknown as ReqContext;
  return { context, permissions, removeExperimentFromHoldout, auditLog };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFeaturesByIds.mockResolvedValue([]);
  mockGetFeatureProjectsByIds.mockResolvedValue(new Map());
  mockDeleteExperimentByIdForOrganization.mockResolvedValue(undefined);
  mockRemoveExperimentFromPresentations.mockResolvedValue(undefined);
});

describe("deleteExperimentWithLinks", () => {
  function expectNothingDeleted(auditLog: jest.Mock) {
    expect(mockDeleteExperimentByIdForOrganization).not.toHaveBeenCalled();
    expect(mockRemoveExperimentFromPresentations).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  }

  it("refuses without delete permission and deletes nothing", async () => {
    const experiment = makeExperiment({ holdoutId: "hld_1" });
    const { context, permissions, removeExperimentFromHoldout, auditLog } =
      makeContext({ canDelete: false });

    await expect(
      deleteExperimentWithLinks(context, experiment),
    ).rejects.toThrow("permission denied");
    expect(permissions.canDeleteExperiment).toHaveBeenCalledWith(experiment);
    expect(permissions.canRunExperiment).not.toHaveBeenCalled();
    expect(removeExperimentFromHoldout).not.toHaveBeenCalled();
    expectNothingDeleted(auditLog);
  });

  it("refuses without run permission in the environments it reaches", async () => {
    const experiment = makeExperiment({
      hasVisualChangesets: true,
      holdoutId: "hld_1",
    });
    const { context, permissions, removeExperimentFromHoldout, auditLog } =
      makeContext({ canRun: false });

    await expect(
      deleteExperimentWithLinks(context, experiment),
    ).rejects.toThrow("permission denied");
    expect(permissions.canRunExperiment).toHaveBeenCalledWith(
      { project: "proj_1" },
      ["__ALL__"],
    );
    expect(removeExperimentFromHoldout).not.toHaveBeenCalled();
    expectNothingDeleted(auditLog);
  });

  it("checks run permission against a linked feature's environments", async () => {
    mockGetFeaturesByIds.mockResolvedValue([
      {
        id: "feat_1",
        project: "proj_1",
        environmentSettings: { production: { enabled: true } },
        rules: [
          {
            type: "experiment-ref",
            id: "fr_1",
            experimentId: "exp_1",
            enabled: true,
            allEnvironments: true,
            variations: [],
          },
        ],
      },
    ]);
    const experiment = makeExperiment({ linkedFeatures: ["feat_1"] });
    const { context, permissions } = makeContext();

    await deleteExperimentWithLinks(context, experiment);
    expect(permissions.canRunExperiment).toHaveBeenCalledWith(
      { project: "proj_1" },
      ["production"],
    );
    expect(mockDeleteExperimentByIdForOrganization).toHaveBeenCalled();
  });

  it("skips the run check for an experiment that reaches no environment", async () => {
    const { context, permissions } = makeContext({ canRun: false });

    await deleteExperimentWithLinks(context, makeExperiment());
    expect(permissions.canRunExperiment).not.toHaveBeenCalled();
    expect(mockDeleteExperimentByIdForOrganization).toHaveBeenCalled();
  });

  it("deletes the experiment and its links, then audits the delete", async () => {
    const experiment = makeExperiment({ hasURLRedirects: true });
    const { context, removeExperimentFromHoldout, auditLog } = makeContext();

    await deleteExperimentWithLinks(context, experiment);

    // Visual changesets and URL redirects go with the experiment in this call
    expect(mockDeleteExperimentByIdForOrganization).toHaveBeenCalledWith(
      context,
      experiment,
    );
    expect(mockRemoveExperimentFromPresentations).toHaveBeenCalledWith("exp_1");
    expect(removeExperimentFromHoldout).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith({
      event: "experiment.delete",
      entity: { object: "experiment", id: "exp_1" },
      details: JSON.stringify({ pre: experiment, context: {} }),
    });
  });

  it("removes a holdout experiment link after the deletes and before the audit", async () => {
    const calls: string[] = [];
    mockDeleteExperimentByIdForOrganization.mockImplementation(async () => {
      calls.push("delete");
    });
    mockRemoveExperimentFromPresentations.mockImplementation(async () => {
      calls.push("presentations");
    });
    const { context, removeExperimentFromHoldout, auditLog } = makeContext();
    removeExperimentFromHoldout.mockImplementation(async () => {
      calls.push("holdout");
    });
    auditLog.mockImplementation(async () => {
      calls.push("audit");
    });

    await deleteExperimentWithLinks(
      context,
      makeExperiment({ holdoutId: "hld_1" }),
    );

    expect(removeExperimentFromHoldout).toHaveBeenCalledWith("hld_1", "exp_1");
    expect(calls.slice(2)).toEqual(["holdout", "audit"]);
    expect(calls.slice(0, 2).sort()).toEqual(["delete", "presentations"]);
  });

  it("only logs a failure to remove the holdout link and still audits", async () => {
    const holdoutError = new Error("holdout update failed");
    const { context, removeExperimentFromHoldout, auditLog } = makeContext();
    removeExperimentFromHoldout.mockRejectedValue(holdoutError);

    await deleteExperimentWithLinks(
      context,
      makeExperiment({ holdoutId: "hld_1" }),
    );

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      holdoutError,
      expect.any(String),
    );
    expect(auditLog).toHaveBeenCalled();
  });

  it("stops before the holdout and audit when removing from presentations fails", async () => {
    mockRemoveExperimentFromPresentations.mockRejectedValue(
      new Error("presentation update failed"),
    );
    const { context, removeExperimentFromHoldout, auditLog } = makeContext();

    await expect(
      deleteExperimentWithLinks(
        context,
        makeExperiment({ holdoutId: "hld_1" }),
      ),
    ).rejects.toThrow("presentation update failed");
    // The experiment delete runs alongside, so it has already been issued
    expect(mockDeleteExperimentByIdForOrganization).toHaveBeenCalled();
    expect(removeExperimentFromHoldout).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
