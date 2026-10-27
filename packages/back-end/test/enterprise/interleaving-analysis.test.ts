import {
  InterleavingInterface,
  InterleavingExposureQueryInterface,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { resolveInterleavingMetrics } from "back-end/src/enterprise/services/interleavingMetrics";
import { InterleavingResultsQueryRunner } from "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner";
import {
  resolveInterleavingExposureQuery,
  runInterleavingSnapshot,
} from "back-end/src/enterprise/services/interleavingAnalysis";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));
jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));
jest.mock("back-end/src/enterprise/services/interleavingMetrics", () => ({
  resolveInterleavingMetrics: jest.fn(),
}));
jest.mock(
  "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner",
  () => ({ InterleavingResultsQueryRunner: jest.fn() }),
);

const mockGetDataSourceById = getDataSourceById as jest.MockedFunction<
  typeof getDataSourceById
>;
const mockGetIntegration = getSourceIntegrationObject as jest.MockedFunction<
  typeof getSourceIntegrationObject
>;
const mockResolveMetrics = resolveInterleavingMetrics as jest.MockedFunction<
  typeof resolveInterleavingMetrics
>;
const mockRunner = InterleavingResultsQueryRunner as unknown as jest.Mock;

class NotFound extends Error {}
class PlanError extends Error {}
class Forbidden extends Error {}

const DATASOURCE = "ds_1";
const USER_ID_TYPE = "user_id";

const exposureQuery = (
  overrides: Partial<InterleavingExposureQueryInterface> = {},
) =>
  ({
    id: "ileq_1",
    name: "Interleave exposures",
    datasourceId: DATASOURCE,
    userIdTypes: [USER_ID_TYPE],
    query: "SELECT 1",
    ...overrides,
  }) as InterleavingExposureQueryInterface;

const interleaving = (overrides: Partial<InterleavingInterface> = {}) =>
  ({
    id: "il_1",
    project: "prj_1",
    trackingKey: "search-ranking",
    datasource: DATASOURCE,
    interleavingExposureQueryId: "ileq_1",
    userIdType: USER_ID_TYPE,
    metrics: [{ id: "fact__goal", analyses: [{ type: "paired" }] }],
    dateStarted: new Date("2026-10-01T00:00:00Z"),
    dateStopped: null,
    variations: [
      { id: "v0", key: "popular", name: "Popular" },
      { id: "v1", key: "buyers-pick", name: "Buyer's pick" },
    ],
    ...overrides,
  }) as InterleavingInterface;

function makeContext({
  il = interleaving(),
  query = exposureQuery(),
  premium = true,
  canRunQueries = true,
}: {
  il?: InterleavingInterface | null;
  query?: InterleavingExposureQueryInterface | null;
  premium?: boolean;
  canRunQueries?: boolean;
} = {}) {
  const create = jest.fn(async (doc) => ({ id: "ilsnp_1", ...doc }));
  const updateById = jest.fn(async () => undefined);
  const context = {
    hasPremiumFeature: () => premium,
    throwPlanDoesNotAllowError: (message: string) => {
      throw new PlanError(message);
    },
    throwNotFoundError: (message: string) => {
      throw new NotFound(message);
    },
    permissions: {
      canRunExperimentQueries: () => canRunQueries,
      throwPermissionError: () => {
        throw new Forbidden("no permission");
      },
    },
    models: {
      interleavings: { getById: async () => il },
      interleavingExposureQueries: { getById: async () => query },
      interleavingSnapshots: { create, updateById },
    },
  };
  return { context: context as unknown as ReqContext, create, updateById };
}

const startAnalysis = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDataSourceById.mockResolvedValue({
    id: DATASOURCE,
  } as Awaited<ReturnType<typeof getDataSourceById>>);
  mockGetIntegration.mockReturnValue({
    datasource: { id: DATASOURCE, projects: [] },
  } as unknown as ReturnType<typeof getSourceIntegrationObject>);
  mockResolveMetrics.mockResolvedValue([]);
  startAnalysis.mockResolvedValue({ id: "ilsnp_1", status: "running" });
  mockRunner.mockImplementation(() => ({ startAnalysis }));
});

describe("resolveInterleavingExposureQuery", () => {
  it("returns the query the interleaving points at", async () => {
    const { context } = makeContext();
    const resolved = await resolveInterleavingExposureQuery(
      context,
      interleaving(),
    );
    expect(resolved.id).toBe("ileq_1");
  });

  it("throws when the query no longer exists", async () => {
    const { context } = makeContext({ query: null });
    await expect(
      resolveInterleavingExposureQuery(context, interleaving()),
    ).rejects.toThrow(NotFound);
  });

  it("rejects a query belonging to another Data Source", async () => {
    const { context } = makeContext({
      query: exposureQuery({ datasourceId: "ds_other" }),
    });
    await expect(
      resolveInterleavingExposureQuery(context, interleaving()),
    ).rejects.toThrow("different Data Source");
  });

  it("rejects a query that doesn't declare the identifier type", async () => {
    const { context } = makeContext({
      query: exposureQuery({ userIdTypes: ["anonymous_id"] }),
    });
    await expect(
      resolveInterleavingExposureQuery(context, interleaving()),
    ).rejects.toThrow(`"${USER_ID_TYPE}" identifier type`);
  });
});

describe("runInterleavingSnapshot", () => {
  it("creates a snapshot with frozen settings and starts the analysis", async () => {
    const { context, create } = makeContext();

    const snapshot = await runInterleavingSnapshot(context, "il_1");

    expect(snapshot).toEqual({ id: "ilsnp_1", status: "running" });
    expect(create).toHaveBeenCalledTimes(1);
    const doc = create.mock.calls[0][0];
    expect(doc.status).toBe("running");
    expect(doc.queries).toEqual([]);
    expect(doc.frozenSettings.interleavingExposureQueryId).toBe("ileq_1");
    expect(doc.frozenSettings.exposureQuery).toBe("SELECT 1");
    expect(doc.frozenSettings.variations.map((v) => v.key)).toEqual([
      "popular",
      "buyers-pick",
    ]);
    expect(startAnalysis).toHaveBeenCalledTimes(1);
  });

  it("freezes the end date at the stop date when the experiment is stopped", async () => {
    const dateStopped = new Date("2026-10-05T00:00:00Z");
    const { context, create } = makeContext({
      il: interleaving({ dateStopped }),
    });

    await runInterleavingSnapshot(context, "il_1");

    expect(create.mock.calls[0][0].frozenSettings.endDate).toEqual(dateStopped);
  });

  it("requires the interleaving premium feature", async () => {
    const { context, create } = makeContext({ premium: false });
    await expect(runInterleavingSnapshot(context, "il_1")).rejects.toThrow(
      PlanError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("throws when the interleaving doesn't exist", async () => {
    const { context } = makeContext({ il: null });
    await expect(runInterleavingSnapshot(context, "il_1")).rejects.toThrow(
      NotFound,
    );
  });

  it("refuses an experiment with no metrics", async () => {
    const { context, create } = makeContext({
      il: interleaving({ metrics: [] }),
    });
    await expect(runInterleavingSnapshot(context, "il_1")).rejects.toThrow(
      "at least one metric",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses an experiment that was never started", async () => {
    const { context } = makeContext({
      il: interleaving({ dateStarted: undefined }),
    });
    await expect(runInterleavingSnapshot(context, "il_1")).rejects.toThrow(
      "Start this interleaving experiment",
    );
  });

  it("requires permission to run queries on the Data Source", async () => {
    const { context, create } = makeContext({ canRunQueries: false });
    await expect(runInterleavingSnapshot(context, "il_1")).rejects.toThrow(
      Forbidden,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("does not create a snapshot when a metric fails to resolve", async () => {
    const { context, create } = makeContext();
    mockResolveMetrics.mockRejectedValue(new Error("bad metric"));
    await expect(runInterleavingSnapshot(context, "il_1")).rejects.toThrow(
      "bad metric",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("marks the snapshot errored when starting the queries fails", async () => {
    const { context, updateById } = makeContext();
    startAnalysis.mockRejectedValue(new Error("warehouse is down"));

    await expect(runInterleavingSnapshot(context, "il_1")).rejects.toThrow(
      "warehouse is down",
    );
    expect(updateById).toHaveBeenCalledWith("ilsnp_1", {
      status: "error",
      error: "warehouse is down",
    });
  });
});
