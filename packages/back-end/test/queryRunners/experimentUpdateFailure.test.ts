import type { QueryRunnerFailureCause } from "shared/types/query";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type { ExperimentInterface } from "shared/types/experiment";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { updateSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { updateReport } from "back-end/src/models/ReportModel";
import { notifyExperimentUpdateFailed } from "back-end/src/services/experimentNotifications";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  updateSnapshot: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));
jest.mock("back-end/src/models/ReportModel", () => ({
  updateReport: jest.fn(),
}));
jest.mock("back-end/src/services/experimentNotifications", () => ({
  notifyExperimentUpdateFailed: jest.fn(),
}));

const context = {
  org: { id: "org_test" },
  permissions: { canRunExperimentQueries: () => true },
} as unknown as ReqContext;
const experiment = { id: "exp_test", status: "running" } as ExperimentInterface;
const snapshot = {
  id: "snap_test",
  experiment: "exp_test",
  organization: "org_test",
  type: "standard",
  queries: [],
} as unknown as ExperimentSnapshotInterface;
const runner = (overrides: Partial<ExperimentSnapshotInterface> = {}) =>
  new ExperimentResultsQueryRunner(context, { ...snapshot, ...overrides }, {
    datasource: {},
  } as SourceIntegrationInterface);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getExperimentById).mockResolvedValue(experiment);
});

it.each([
  "query",
  "analysis",
  "no-queries",
] satisfies QueryRunnerFailureCause[])(
  "notifies with cause %s after persisting failure",
  async (failureCause) => {
    await runner().updateModel({
      status: "failed",
      queries: [],
      error: "secret SQL",
      failureCause,
    });
    expect(notifyExperimentUpdateFailed).toHaveBeenCalledWith({
      context,
      experiment,
      cause: failureCause,
    });
    expect(
      jest.mocked(updateSnapshot).mock.invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(notifyExperimentUpdateFailed).mock.invocationCallOrder[0],
    );
  },
);

it("persists user cancellation without notifying", async () => {
  await runner().updateModel({
    status: "failed",
    queries: [],
    failureCause: "cancelled",
  });
  expect(updateSnapshot).toHaveBeenCalled();
  expect(getExperimentById).not.toHaveBeenCalled();
  expect(notifyExperimentUpdateFailed).not.toHaveBeenCalled();
});

it("does not notify when snapshot persistence fails", async () => {
  jest
    .mocked(updateSnapshot)
    .mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(
    runner().updateModel({
      status: "failed",
      queries: [],
      failureCause: "query",
    }),
  ).rejects.toThrow("Database unavailable");
  expect(notifyExperimentUpdateFailed).not.toHaveBeenCalled();
});

it("does not notify for reports or nonstandard snapshots", async () => {
  await runner({ report: "report_test" }).updateModel({
    status: "failed",
    queries: [],
    failureCause: "query",
  });
  await runner({ type: "exploratory" }).updateModel({
    status: "failed",
    queries: [],
    failureCause: "query",
  });
  expect(updateReport).toHaveBeenCalled();
  expect(notifyExperimentUpdateFailed).not.toHaveBeenCalled();
});
