import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Permissions, roleToPermissionMap } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";
import { MetricInterface } from "shared/types/metric";
import {
  getMetricsForDefinitions,
  getMetricsByOrganization,
  METRIC_DEFINITION_EXCLUDED_FIELDS,
  METRIC_QUERY_STATUS_FIELDS,
  FIELDS_NOT_REQUIRING_DATE_UPDATED,
} from "back-end/src/models/MetricModel";
import { usingFileConfig, getConfigMetrics } from "back-end/src/init/config";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/init/config");

const mockedUsingFileConfig = usingFileConfig as jest.MockedFunction<
  typeof usingFileConfig
>;
const mockedGetConfigMetrics = getConfigMetrics as jest.MockedFunction<
  typeof getConfigMetrics
>;

const org: OrganizationInterface = {
  id: "org_1",
  name: "Test",
  url: "",
  ownerEmail: "",
  dateCreated: new Date(),
  members: [],
  invites: [],
  settings: {},
};

const context = {
  org,
  permissions: new Permissions({
    global: {
      permissions: roleToPermissionMap("admin", org),
      limitAccessByEnvironment: false,
      environments: [],
    },
    projects: {},
  }),
} as unknown as ReqContext;

function makeMetric(overrides: Partial<MetricInterface> = {}): MetricInterface {
  return {
    id: "met_1",
    organization: "org_1",
    owner: "",
    datasource: "ds_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Test Metric",
    description: "",
    type: "count",
    inverse: false,
    ignoreNulls: false,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "conversion",
      windowValue: 72,
      windowUnit: "hours",
      delayValue: 0,
      delayUnit: "hours",
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 0.3 },
    sql: "SELECT user_id, value FROM purchases",
    templateVariables: { eventName: "purchase" },
    conditions: [{ column: "country", operator: "=", value: "US" }],
    queries: [],
    runStarted: null,
    analysis: {
      createdAt: new Date(),
      average: 1,
      dates: [],
    },
    analysisError: "some error",
    ...overrides,
  };
}

const HEAVY_FIELDS = [
  "sql",
  "templateVariables",
  "conditions",
  "queries",
  "analysis",
  "analysisError",
] as const;

describe("getMetricsForDefinitions", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await mongoose.connection.db!.collection("metrics").deleteMany({});
  });

  it("excludes heavy fields from metrics read from the database", async () => {
    mockedUsingFileConfig.mockReturnValue(false);
    await mongoose.connection
      .db!.collection("metrics")
      .insertMany([makeMetric(), makeMetric({ id: "met_2", name: "Other" })]);

    const metrics = await getMetricsForDefinitions(context);

    expect(metrics).toHaveLength(2);
    metrics.forEach((m) => {
      HEAVY_FIELDS.forEach((field) => {
        expect(m).not.toHaveProperty(field);
      });
    });
    expect(metrics.map((m) => m.name).sort()).toEqual(["Other", "Test Metric"]);
    // Still runs the doc migration/defaults
    expect(metrics[0].windowSettings).toBeDefined();
    expect(metrics[0].userIdTypes).toBeDefined();
  });

  it("excludes heavy fields from config.yml metrics", async () => {
    mockedUsingFileConfig.mockReturnValue(true);
    mockedGetConfigMetrics.mockReturnValue([makeMetric({ id: "met_cfg" })]);

    const metrics = await getMetricsForDefinitions(context);

    expect(metrics.map((m) => m.id)).toContain("met_cfg");
    metrics.forEach((m) => {
      HEAVY_FIELDS.forEach((field) => {
        expect(m).not.toHaveProperty(field);
      });
    });
  });

  it("does not return metrics from other organizations", async () => {
    mockedUsingFileConfig.mockReturnValue(false);
    await mongoose.connection
      .db!.collection("metrics")
      .insertMany([
        makeMetric(),
        makeMetric({ id: "met_other", organization: "org_2" }),
      ]);

    const metrics = await getMetricsForDefinitions(context);

    expect(metrics.map((m) => m.id)).toEqual(["met_1"]);
  });
});

describe("getMetricsByOrganization includeArchived", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await mongoose.connection.db!.collection("metrics").deleteMany({});
  });

  it("excludes archived metrics from the database when includeArchived is false", async () => {
    mockedUsingFileConfig.mockReturnValue(false);
    await mongoose.connection.db!.collection("metrics").insertMany([
      makeMetric({ id: "met_active", status: "active" }),
      makeMetric({ id: "met_archived", status: "archived" }),
      // Metrics with no status should be kept (matches the $ne semantics)
      makeMetric({ id: "met_nostatus", status: undefined }),
    ]);

    const metrics = await getMetricsByOrganization(context, {
      includeArchived: false,
    });

    expect(metrics.map((m) => m.id).sort()).toEqual([
      "met_active",
      "met_nostatus",
    ]);
  });

  it("excludes archived config.yml metrics when includeArchived is false", async () => {
    mockedUsingFileConfig.mockReturnValue(true);
    mockedGetConfigMetrics.mockReturnValue([
      makeMetric({ id: "met_active", status: "active" }),
      makeMetric({ id: "met_archived", status: "archived" }),
    ]);

    const metrics = await getMetricsByOrganization(context, {
      includeArchived: false,
    });

    expect(metrics.map((m) => m.id)).toEqual(["met_active"]);
  });

  it("includes archived metrics by default", async () => {
    mockedUsingFileConfig.mockReturnValue(false);
    await mongoose.connection
      .db!.collection("metrics")
      .insertMany([
        makeMetric({ id: "met_active", status: "active" }),
        makeMetric({ id: "met_archived", status: "archived" }),
      ]);

    const metrics = await getMetricsByOrganization(context);

    expect(metrics.map((m) => m.id).sort()).toEqual([
      "met_active",
      "met_archived",
    ]);
  });
});

// The definitions endpoint serves 304s from a version counter, and two metric
// write paths skip the bump: updateMetricQueriesAndStatus (no touch at all)
// and updateMetric (gated on dateUpdated being stamped). Both are safe only
// while every field they can skip is excluded from the definitions payload —
// a field leaving METRIC_DEFINITION_EXCLUDED_FIELDS while still skipping the
// bump would serve stale 304s.
describe("definitions version exclusion invariants", () => {
  it("keeps updateMetricQueriesAndStatus's writable fields out of the definitions payload", () => {
    for (const field of METRIC_QUERY_STATUS_FIELDS) {
      expect(METRIC_DEFINITION_EXCLUDED_FIELDS).toContain(field);
    }
  });

  it("keeps every field that skips dateUpdated out of the definitions payload", () => {
    for (const field of FIELDS_NOT_REQUIRING_DATE_UPDATED) {
      expect(METRIC_DEFINITION_EXCLUDED_FIELDS).toContain(field);
    }
  });
});
