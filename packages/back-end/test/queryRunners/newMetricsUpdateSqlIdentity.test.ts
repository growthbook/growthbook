import type { ExposureQuery } from "shared/types/datasource";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SegmentInterface } from "shared/types/segment";
import type { ApiReqContext } from "back-end/types/api";
import BigQuery from "back-end/src/integrations/BigQuery";
import Databricks from "back-end/src/integrations/Databricks";
import { getIndexAfterLastGroup } from "back-end/src/queryRunners/newMetricsUpdateQueryNaming";
import {
  generateExperimentResultQuerySql,
  type GenerateResultQuerySql,
  getQueriesWithChangedSql,
  replayNewMetricsUpdateLineage,
  type NewMetricsUpdateReplayLevel,
} from "back-end/src/services/newMetricsUpdateSqlIdentity";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: () => true,
}));

const exposureQuery: ExposureQuery = {
  id: "user_id",
  name: "Exposure",
  description: "",
  query:
    "SELECT user_id, timestamp, experiment_id, variation_id FROM exposures",
  userIdType: "user_id",
  dimensions: [],
};

const orders = factTableFactory.build({
  id: "orders",
  sql: "SELECT user_id, timestamp, amount FROM orders",
  userIdTypes: ["user_id"],
});
const events = factTableFactory.build({
  id: "events",
  sql: "SELECT user_id, timestamp, value FROM events",
  userIdTypes: ["user_id"],
});
const factTableMap = new Map([
  [orders.id, orders],
  [events.id, events],
]);

// Its conversion window lets a run without a cutoff read past its end date.
const revenue = factMetricFactory.build({
  id: "fact_revenue",
  name: "Revenue",
  numerator: { factTableId: "orders", column: "amount" },
  windowSettings: {
    type: "conversion",
    windowValue: 72,
    windowUnit: "hours",
    delayValue: 0,
    delayUnit: "hours",
  },
});
const clicks = factMetricFactory.build({
  id: "fact_clicks",
  name: "Clicks",
  numerator: { factTableId: "events", column: "value" },
});

const segment = {
  id: "seg_1",
  name: "Buyers",
  type: "SQL",
  sql: "SELECT user_id, date FROM buyers",
  userIdType: "user_id",
} as SegmentInterface;

// Today's plan, pinned to the base's end date as a cutoff.
const settings: ExperimentSnapshotSettings = {
  dimensions: [],
  metricSettings: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  activationMetric: null,
  defaultMetricPriorSettings: {
    override: false,
    proper: false,
    mean: 0,
    stddev: 1,
  },
  regressionAdjustmentEnabled: false,
  attributionModel: "firstExposure",
  experimentId: "exp_1",
  queryFilter: "",
  segment: "seg_1",
  skipPartialData: false,
  datasourceId: "ds_1",
  exposureQueryId: "user_id",
  exposureQueryIdentifierType: "user_id",
  startDate: new Date("2026-11-01T00:00:00Z"),
  endDate: new Date("2026-11-10T12:00:00Z"),
  endDateIsCutoff: true,
  variations: [
    { id: "0", weight: 0.5 },
    { id: "1", weight: 0.5 },
  ],
};

// A manual full update has no cutoff and was planned at its end date. It
// generated its SQL a few seconds later.
const BASE_SQL_GENERATED_AT = new Date(settings.endDate.getTime() + 3_000);

// A full update with Revenue, then a new-metrics update that added Clicks.
const levels: NewMetricsUpdateReplayLevel[] = [
  {
    snapshotId: "snp_base",
    metricSettings: [{ id: revenue.id }],
    newMetricIds: null,
    endDateIsCutoff: false,
    plannedAt: settings.endDate,
  },
  {
    snapshotId: "snp_refresh",
    metricSettings: [{ id: revenue.id }, { id: clicks.id }],
    newMetricIds: [clicks.id],
    endDateIsCutoff: true,
    plannedAt: new Date("2026-11-10T15:00:00Z"),
  },
];
// The queries a new-metrics update of snp_refresh compares: the groups it
// would copy and the units table each of them reads.
const comparedQueryNames = ["group_0", "group_1", "snp_base", "snp_refresh"];

const integrations = {
  BigQuery: (datasource: object) =>
    // @ts-expect-error -- the integration only reads `.datasource` here
    new BigQuery("", { type: "bigquery", ...datasource }),
  Databricks: (datasource: object) =>
    // @ts-expect-error -- the integration only reads `.datasource` here
    new Databricks("", { type: "databricks", ...datasource }),
};

type Variant = {
  dialect?: keyof typeof integrations;
  exposureSql?: string;
  segmentSql?: string;
  metrics?: FactMetricInterface[];
  settings?: Partial<ExperimentSnapshotSettings>;
};

function makeGenerator({
  dialect = "BigQuery",
  exposureSql = exposureQuery.query,
  segmentSql = segment.sql,
  metrics = [revenue, clicks],
}: Variant): GenerateResultQuerySql {
  const integration = integrations[dialect]({
    settings: {
      queries: { exposure: [{ ...exposureQuery, query: exposureSql }] },
      pipelineSettings: {
        allowWriting: true,
        mode: "ephemeral",
        writeDataset: "gb_tmp",
        writeDatabase: "gb_project",
        unitsTableDeletion: true,
      },
    },
  });
  const context = {
    org: { id: "org_1", settings: {} },
    models: {
      segments: { getById: async () => ({ ...segment, sql: segmentSql }) },
    },
  } as unknown as ApiReqContext;
  return ({ settings, queryParentId, scope }) =>
    generateExperimentResultQuerySql(
      context,
      {
        snapshotType: "standard",
        snapshotSettings: settings,
        variationNames: ["Control", "Treatment"],
        metricMap: new Map(metrics.map((m) => [m.id, m])),
        factTableMap,
        queryParentId,
        experimentQueryMetadata: null,
      },
      integration,
      scope,
    );
}

/**
 * The SQL each run stored when it ran, seconds after it was planned. The
 * replay runs today.
 */
async function storedSql(variant: Variant = {}): Promise<Map<string, string>> {
  const generate = makeGenerator(variant);
  const runSettings = { ...settings, ...variant.settings };
  jest.useFakeTimers({ now: BASE_SQL_GENERATED_AT, doNotFake: ["nextTick"] });
  const base = await generate({
    settings: {
      ...runSettings,
      endDateIsCutoff: false,
      plannedAt: settings.endDate,
      metricSettings: levels[0].metricSettings,
    },
    queryParentId: levels[0].snapshotId,
  }).finally(() => jest.useRealTimers());
  const refresh = await generate({
    settings: {
      ...runSettings,
      plannedAt: new Date("2026-11-10T15:00:00Z"),
      metricSettings: levels[1].metricSettings,
    },
    queryParentId: levels[1].snapshotId,
    scope: {
      metricIds: new Set(levels[1].newMetricIds),
      firstGroupIndex: getIndexAfterLastGroup([...base.keys()]),
    },
  });
  return new Map([...base, ...refresh]);
}

async function getChangedQueries(stored: Variant, today: Variant) {
  return getQueriesWithChangedSql({
    queryNames: comparedQueryNames,
    storedSql: await storedSql(stored),
    todaysSql: await replayNewMetricsUpdateLineage({
      levels,
      settings: { ...settings, ...today.settings },
      generateResultQuerySql: makeGenerator(today),
    }),
  });
}

describe("comparing a pipeline-mode lineage's generated SQL", () => {
  it.each([
    { dialect: "BigQuery" as const, skipPartialData: false },
    { dialect: "BigQuery" as const, skipPartialData: true },
    { dialect: "Databricks" as const, skipPartialData: false },
    { dialect: "Databricks" as const, skipPartialData: true },
  ])(
    "regenerates the same $dialect SQL for an unchanged lineage whose base had no cutoff, with skipPartialData $skipPartialData",
    async ({ dialect, skipPartialData }) => {
      const unchanged = { dialect, settings: { skipPartialData } };
      const stored = await storedSql(unchanged);

      expect(stored.get("group_0")).toContain("growthbook_tmp_units_snp_base");
      expect(stored.get("group_1")).toContain(
        "growthbook_tmp_units_snp_refresh",
      );
      expect(stored.get("snp_base")).toContain("CREATE");
      expect(await getChangedQueries(unchanged, unchanged)).toEqual([]);
    },
  );

  it.each(["BigQuery", "Databricks"] as const)(
    "with skipPartialData, counts the base's conversion windows back from its stored clock in %s",
    async (dialect) => {
      const stored = await storedSql({
        dialect,
        settings: { skipPartialData: true },
      });
      // Revenue's 72 hour window, back from the base's planning clock.
      expect(stored.get("group_0")).toMatch(/2026-11-07[ T]12:00:00/);
    },
  );

  it.each([
    {
      name: "the exposure query",
      change: { exposureSql: `${exposureQuery.query} WHERE 1=1` },
    },
    {
      name: "the segment",
      change: { segmentSql: `${segment.sql} WHERE 1=1` },
    },
  ])(
    "catches a change to $name only through the units table queries",
    async ({ change }) => {
      expect(await getChangedQueries({}, change)).toEqual([
        "snp_base",
        "snp_refresh",
      ]);
    },
  );

  it("catches a row filter added to a copied metric in its group", async () => {
    const filtered = {
      ...revenue,
      numerator: {
        ...revenue.numerator,
        rowFilters: [{ operator: "sql_expr" as const, values: ["amount > 0"] }],
      },
    };
    expect(
      await getChangedQueries({}, { metrics: [filtered, clicks] }),
    ).toEqual(["group_0"]);
  });

  it("ignores a renamed metric", async () => {
    expect(
      await getChangedQueries(
        {},
        { metrics: [{ ...revenue, name: "Revenue (renamed)" }, clicks] },
      ),
    ).toEqual([]);
  });

  it("catches skipPartialData turned off since the copied runs", async () => {
    expect(
      await getChangedQueries(
        { settings: { skipPartialData: true } },
        { settings: { skipPartialData: false } },
      ),
    ).toEqual(["group_0", "group_1"]);
  });

  it("with skipPartialData, catches a conversion window that only moves the exposure cutoff", async () => {
    const run = {
      settings: {
        skipPartialData: true,
        attributionModel: "experimentDuration" as const,
      },
    };
    const shorter = {
      ...revenue,
      windowSettings: { ...revenue.windowSettings, windowValue: 71 },
    };
    expect(
      await getChangedQueries(run, { ...run, metrics: [shorter, clicks] }),
    ).toEqual(["group_0"]);
  });
});
