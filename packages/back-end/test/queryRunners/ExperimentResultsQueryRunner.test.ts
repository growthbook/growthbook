import { ExperimentMetricInterface } from "shared/experiments";
import { QueryPointer } from "shared/types/query";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import { startExperimentResultQueries } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { getFactMetricGroups } from "back-end/src/services/experimentQueries/experimentQueries";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { parseDimension } from "back-end/src/services/experiments";
import { shouldRunHealthTrafficQuery } from "back-end/src/queryRunners/snapshotQueryHelpers";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

// Only override the specific collaborators the build-isolation path touches;
// keep the pure helpers (e.g. getFactMetricGroupQueryName) real.
jest.mock("back-end/src/services/experimentQueries/experimentQueries", () => ({
  ...jest.requireActual(
    "back-end/src/services/experimentQueries/experimentQueries",
  ),
  getFactMetricGroups: jest.fn(),
}));

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

jest.mock("back-end/src/integrations/sql/queries/exposure-query", () => ({
  getExposureQuery: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  parseDimension: jest.fn(),
}));

jest.mock("back-end/src/queryRunners/snapshotQueryHelpers", () => ({
  shouldRunHealthTrafficQuery: jest.fn(),
}));

jest.mock("shared/util", () => ({
  ...jest.requireActual("shared/util"),
  buildUnitsQuerySettingsFromSnapshot: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedGetFactMetricGroups = getFactMetricGroups as jest.Mock;
const mockedOrgHasPremiumFeature = orgHasPremiumFeature as jest.Mock;
const mockedGetExposureQuery = getExposureQuery as jest.Mock;
const mockedParseDimension = parseDimension as jest.Mock;
const mockedShouldRunHealthTrafficQuery =
  shouldRunHealthTrafficQuery as jest.Mock;
const mockedBuildUnitsQuerySettings =
  buildUnitsQuerySettingsFromSnapshot as jest.Mock;

function buildLegacyMetric(id: string): ExperimentMetricInterface {
  return { id, denominator: null } as unknown as ExperimentMetricInterface;
}

describe("startExperimentResultQueries build-time error isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedOrgHasPremiumFeature.mockReturnValue(false);
    mockedGetExposureQuery.mockReturnValue({});
    mockedParseDimension.mockResolvedValue(null);
    // No units table, no traffic query — keep the DAG to just the metric and
    // group queries so the assertions stay focused on build isolation.
    mockedShouldRunHealthTrafficQuery.mockReturnValue(false);
    mockedBuildUnitsQuerySettings.mockReturnValue({});
  });

  it("records a failed query for a metric/group whose construction throws, while the others still start", async () => {
    const legacyOk = buildLegacyMetric("met_ok");
    const legacyBad = buildLegacyMetric("met_bad");
    const groupOk = factMetricFactory.build({ id: "fact_ok" });
    const groupBad = factMetricFactory.build({ id: "fact_bad" });

    mockedGetFactMetricGroups.mockReturnValue({
      legacyMetricSingles: [legacyOk, legacyBad],
      factMetricGroups: [[groupOk], [groupBad]],
    });

    const metricMap = new Map<string, ExperimentMetricInterface>([
      [legacyOk.id, legacyOk],
      [legacyBad.id, legacyBad],
      [groupOk.id, groupOk],
      [groupBad.id, groupBad],
    ]);

    // Fail construction for the "bad" legacy metric and the second group.
    const integration = {
      datasource: { id: "ds_1", settings: {} },
      getSourceProperties: () => ({
        separateExperimentResultQueries: true,
        supportsWritingTables: false,
        queryLanguage: "sql",
        dropUnitsTable: false,
      }),
      getSnapshotMetricQuery: jest.fn((params) => {
        if (params.metric.id === "met_bad") {
          throw new Error("bad legacy metric SQL");
        }
        return "SELECT 1 -- legacy";
      }),
      getExperimentFactMetricsQuery: jest.fn((params) => {
        if (params.metrics[0].id === "fact_bad") {
          throw new Error("Unknown fact table");
        }
        return "SELECT 1 -- group";
      }),
      runSnapshotMetricQuery: jest.fn(),
      runExperimentFactMetricsQuery: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const context = {
      org: { id: "org_1", settings: {} },
      models: { segments: { getById: jest.fn() } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const params = {
      snapshotType: "standard",
      snapshotSettings: {
        metricSettings: [
          { id: "met_ok" },
          { id: "met_bad" },
          { id: "fact_ok" },
          { id: "fact_bad" },
        ],
        dimensions: [],
        variations: [],
        exposureQueryId: "",
      },
      variationNames: [],
      metricMap,
      factTableMap: new Map(),
      queryParentId: "snp_1",
      experimentQueryMetadata: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Injected startQuery stands in for the real method: it resolves the SQL
    // builder and, when construction throws, records a terminal failed query
    // (mirroring QueryRunner.startQuery's build-guard) rather than letting the
    // throw escape. startExperimentResultQueries must pass a builder (not an
    // eagerly-constructed string) so a per-unit throw is isolated here.
    const startQuery = jest.fn(
      async ({
        name,
        query,
      }: {
        name: string;
        query: string | (() => string);
      }): Promise<QueryPointer> => {
        try {
          if (typeof query === "function") query();
          return { name, query: `qry_${name}`, status: "queued" };
        } catch (e) {
          return {
            name,
            query: `qry_failed_${name}`,
            status: "failed",
            error: `Failed to build query: ${
              e instanceof Error ? e.message : String(e)
            }`,
          };
        }
      },
    );

    const queries = await startExperimentResultQueries(
      context,
      params,
      integration,
      startQuery,
    );

    // Every unit — including the ones whose construction throws — is handed to
    // startQuery: the loop delegates construction lazily rather than aborting.
    const startedNames = startQuery.mock.calls.map((c) => c[0].name);
    expect(startedNames).toEqual(
      expect.arrayContaining(["met_ok", "met_bad", "group_0", "group_1"]),
    );

    // All four units are represented in the returned DAG with the right status,
    // and the failing ones carry the chained build error message.
    const byName = new Map(queries.map((q) => [q.name, q]));
    expect(byName.get("met_ok")?.status).toBe("queued");
    expect(byName.get("group_0")?.status).toBe("queued");
    expect(byName.get("met_bad")?.status).toBe("failed");
    expect(byName.get("met_bad")?.error).toBe(
      "Failed to build query: bad legacy metric SQL",
    );
    expect(byName.get("group_1")?.status).toBe("failed");
    expect(byName.get("group_1")?.error).toBe(
      "Failed to build query: Unknown fact table",
    );
  });

  it("records a failed query when the shared units-table construction throws, and still starts the dependent metric queries", async () => {
    mockedOrgHasPremiumFeature.mockReturnValue(true);
    const legacy = buildLegacyMetric("met_ok");
    mockedGetFactMetricGroups.mockReturnValue({
      legacyMetricSingles: [legacy],
      factMetricGroups: [],
    });

    const metricMap = new Map<string, ExperimentMetricInterface>([
      [legacy.id, legacy],
    ]);

    const integration = {
      datasource: {
        id: "ds_1",
        settings: {
          pipelineSettings: {
            allowWriting: true,
            mode: "ephemeral",
            writeDataset: "gb_tmp",
          },
        },
      },
      getSourceProperties: () => ({
        separateExperimentResultQueries: true,
        supportsWritingTables: true,
        queryLanguage: "sql",
        dropUnitsTable: false,
      }),
      generateTablePath: () => "gb_tmp.units",
      getExperimentUnitsTableQuery: jest.fn(() => {
        throw new Error("Unknown variable: ce_bad_units_var");
      }),
      getSnapshotMetricQuery: jest.fn(() => "SELECT 1 -- legacy"),
      runExperimentUnitsQuery: jest.fn(),
      runSnapshotMetricQuery: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const context = {
      org: { id: "org_1", settings: {} },
      models: { segments: { getById: jest.fn() } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const params = {
      snapshotType: "standard",
      snapshotSettings: {
        metricSettings: [{ id: "met_ok" }],
        dimensions: [],
        variations: [],
        exposureQueryId: "",
      },
      variationNames: [],
      metricMap,
      factTableMap: new Map(),
      queryParentId: "snp_1",
      experimentQueryMetadata: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const startQuery = jest.fn(
      async ({
        name,
        query,
      }: {
        name: string;
        query: string | (() => string);
      }): Promise<QueryPointer> => {
        try {
          if (typeof query === "function") query();
          return { name, query: `qry_${name}`, status: "queued" };
        } catch (e) {
          return {
            name,
            query: `qry_failed_${name}`,
            status: "failed",
            error: `Failed to build query: ${
              e instanceof Error ? e.message : String(e)
            }`,
          };
        }
      },
    );

    const queries = await startExperimentResultQueries(
      context,
      params,
      integration,
      startQuery,
    );

    const byName = new Map(queries.map((q) => [q.name, q]));
    // The units-table build throw is recorded, not escaped...
    expect(byName.get("snp_1")?.status).toBe("failed");
    expect(byName.get("snp_1")?.error).toBe(
      "Failed to build query: Unknown variable: ce_bad_units_var",
    );
    // ...and the dependent metric query is still created, so the runtime
    // cascade can mark it "Dependencies failed: …".
    expect(byName.get("met_ok")?.status).toBe("queued");
  });
});
