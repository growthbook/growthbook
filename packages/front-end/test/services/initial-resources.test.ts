import { describe, expect, it, vi } from "vitest";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  getInitialDatasourceResources,
  getDatasourceTemplateResources,
  getDatasourceTemplateSettings,
} from "@/services/initial-resources";
import { validateSQL } from "@/services/datasources";

// initial-resources imports getDefaultFactMetricProps, which pulls in a React
// component tree the generators never touch.
vi.mock("@/services/metrics", () => ({
  getDefaultFactMetricProps: vi.fn(),
}));

function langfuseDatasource(projectId?: string): DataSourceInterfaceWithParams {
  return {
    id: "ds_langfuse",
    type: "clickhouse",
    params: { url: "http://localhost:8123", database: "default" },
    settings: {
      schemaFormat: "langfuse",
      schemaOptions: projectId === undefined ? {} : { projectId },
    },
  } as unknown as DataSourceInterfaceWithParams;
}

function phoenixDatasource(
  projectName?: string,
): DataSourceInterfaceWithParams {
  return {
    id: "ds_phoenix",
    type: "postgres",
    params: { host: "localhost", database: "phoenix", defaultSchema: "public" },
    settings: {
      schemaFormat: "phoenix",
      schemaOptions: projectName === undefined ? {} : { projectName },
    },
  } as unknown as DataSourceInterfaceWithParams;
}

const SPECIAL_COLUMNS = ["$$count", "$$distinctUsers", "$$distinctDates"];

function assertResourcesAreConsistent(
  datasource: DataSourceInterfaceWithParams,
) {
  const { factTables } = getInitialDatasourceResources({ datasource });
  expect(factTables.length).toBeGreaterThan(0);

  for (const { factTable, filters, metrics } of factTables) {
    const columnNames = (factTable.columns || []).map((c) => c.column);
    const filterNames = filters.map((f) => f.name);

    expect(() =>
      validateSQL(factTable.sql, ["timestamp", ...factTable.userIdTypes]),
    ).not.toThrow();
    expect(columnNames).toContain("timestamp");
    for (const idType of factTable.userIdTypes) {
      expect(columnNames).toContain(idType);
    }

    for (const metric of metrics) {
      for (const ref of [metric.numerator, metric.denominator]) {
        if (!ref) continue;
        if (ref.column && !SPECIAL_COLUMNS.includes(ref.column)) {
          expect(columnNames).toContain(ref.column);
        }
        for (const rf of ref.rowFilters || []) {
          if (rf.operator === "saved_filter") {
            expect(filterNames).toContain(rf.values?.[0]);
          } else if (rf.column) {
            expect(columnNames).toContain(rf.column);
          }
        }
      }
      if (metric.metricType === "quantile") {
        expect(metric.quantileSettings).toBeDefined();
      }
      if (metric.metricType === "ratio") {
        expect(metric.denominator).toBeDefined();
      }
    }
  }
  return factTables;
}

describe("getInitialDatasourceResources", () => {
  describe("langfuse", () => {
    it("generates consistent fact tables, filters, and metrics", () => {
      const factTables = assertResourcesAreConsistent(
        langfuseDatasource("proj_1"),
      );
      expect(factTables.map((f) => f.factTable.name)).toEqual([
        "Langfuse Traces",
        "Langfuse Observations",
        "Langfuse Scores",
      ]);

      const observations = factTables[1];
      expect(observations.factTable.sql).toContain("FINAL");
      expect(observations.factTable.sql).toContain("project_id = 'proj_1'");
      expect(observations.factTable.sql).toContain("usage_details['total']");
      expect(observations.metrics.map((m) => m.name)).toEqual([
        "LLM calls per user",
        "LLM cost per user",
        "LLM error rate",
        "p95 LLM latency",
        "Tokens per LLM call",
      ]);
    });

    it("omits the project filter when no project id is configured", () => {
      const { factTables } = getInitialDatasourceResources({
        datasource: langfuseDatasource(),
      });
      for (const { factTable } of factTables) {
        expect(factTable.sql).not.toContain("project_id = '");
      }
    });

    it("escapes quotes in the project id", () => {
      const { factTables } = getInitialDatasourceResources({
        datasource: langfuseDatasource("a'b"),
      });
      expect(factTables[0].factTable.sql).toContain("project_id = 'a''b'");
    });

    it("marks user-defined score names as inline filters instead of creating score metrics", () => {
      const { factTables } = getInitialDatasourceResources({
        datasource: langfuseDatasource(),
      });
      const scores = factTables[2];
      expect(scores.metrics).toEqual([]);
      const scoreName = scores.factTable.columns?.find(
        (c) => c.column === "score_name",
      );
      expect(scoreName?.alwaysInlineFilter).toBe(true);
    });
  });

  describe("phoenix", () => {
    it("generates consistent fact tables, filters, and metrics", () => {
      const factTables = assertResourcesAreConsistent(
        phoenixDatasource("default"),
      );
      expect(factTables.map((f) => f.factTable.name)).toEqual([
        "Phoenix Traces",
        "Phoenix Spans",
        "Phoenix Annotations",
      ]);

      const spans = factTables[1];
      expect(spans.factTable.sql).toContain("public.spans");
      expect(spans.factTable.sql).toContain("p.name = 'default'");
      expect(spans.factTable.sql).toContain("root.parent_id IS NULL");
      expect(spans.factTable.sql).toContain("->'user'->>'id'");
      expect(spans.filters.map((f) => f.name)).toEqual(["LLM Spans", "Errors"]);
    });

    it("omits the project filter when no project name is configured", () => {
      const { factTables } = getInitialDatasourceResources({
        datasource: phoenixDatasource(""),
      });
      for (const { factTable } of factTables) {
        expect(factTable.sql).not.toContain("p.name =");
      }
    });
  });

  it.each([
    { tracker: "langfuse", datasource: langfuseDatasource() },
    { tracker: "phoenix", datasource: phoenixDatasource("default") },
  ])(
    "sets metric direction and cost sample size for $tracker",
    ({ datasource }) => {
      const { factTables } = getInitialDatasourceResources({ datasource });
      const llmMetrics = factTables[1].metrics;

      expect(
        Object.fromEntries(llmMetrics.map((m) => [m.name, m.inverse ?? false])),
      ).toEqual({
        "LLM calls per user": false,
        "LLM cost per user": true,
        "LLM error rate": true,
        "p95 LLM latency": true,
        "Tokens per LLM call": true,
      });
      expect(
        llmMetrics.find((m) => m.name === "LLM cost per user")?.minSampleSize,
      ).toBe(0);
    },
  );
});

// A Data Source with its own identifier types and assignment query.
function businessClickhouse(): DataSourceInterfaceWithParams {
  return {
    id: "ds_business",
    type: "clickhouse",
    params: { url: "http://localhost:8123", database: "default" },
    settings: {
      schemaFormat: "custom",
      userIdTypes: [
        { userIdType: "user_id", description: "" },
        { userIdType: "anonymous_id", description: "" },
      ],
      queries: {
        exposure: [
          {
            id: "user_id",
            name: "Logged-in users",
            userIdType: "user_id",
            userIdTypes: ["user_id"],
            query: "SELECT * FROM experiment_viewed",
            dimensions: [],
          },
        ],
        identityJoins: [],
      },
    },
  } as unknown as DataSourceInterfaceWithParams;
}

describe("Firebase on a GA4 Data Source", () => {
  it("skips assignment queries with the same SQL", () => {
    const ds = {
      id: "ds_ga4",
      type: "bigquery",
      params: { defaultProject: "proj", defaultDataset: "analytics_123" },
      settings: { schemaFormat: "ga4" },
    } as unknown as DataSourceInterfaceWithParams;
    const ga4 = getDatasourceTemplateSettings({
      datasource: ds,
      template: "ga4",
      schemaOptions: {},
    });
    const withFirebase = getDatasourceTemplateSettings({
      datasource: { ...ds, settings: ga4 },
      template: "firebase",
      schemaOptions: {},
    });
    expect(withFirebase.queries?.exposure).toEqual(ga4.queries?.exposure);
  });
});

describe("Snowplow on an existing Data Source", () => {
  it("adds prefixed assignment queries and no fact tables", () => {
    const ds = {
      id: "ds_pg",
      type: "postgres",
      params: { host: "localhost", database: "app", defaultSchema: "atomic" },
      settings: { schemaFormat: "custom", userIdTypes: [] },
    } as unknown as DataSourceInterfaceWithParams;
    const settings = getDatasourceTemplateSettings({
      datasource: ds,
      template: "snowplow",
      schemaOptions: {},
    });
    const exposure = settings.queries?.exposure || [];
    expect(exposure.length).toBeGreaterThan(0);
    expect(exposure.every((q) => q.id.startsWith("snowplow_"))).toBe(true);
    expect(exposure[0].name.startsWith("Snowplow: ")).toBe(true);
    expect(
      getDatasourceTemplateResources({
        datasource: { ...ds, settings },
        template: "snowplow",
        schemaOptions: {},
        existingFactTables: [],
      }).factTables,
    ).toEqual([]);
  });
});

describe("Segment template on an existing Data Source", () => {
  it("builds fact tables against the Data Source's schema", () => {
    const ds = {
      id: "ds_pg",
      type: "postgres",
      params: { host: "localhost", database: "app", defaultSchema: "segment" },
      settings: { schemaFormat: "custom", userIdTypes: [] },
    } as unknown as DataSourceInterfaceWithParams;
    const settings = getDatasourceTemplateSettings({
      datasource: ds,
      template: "segment",
      schemaOptions: {},
    });
    expect(settings.userIdTypes?.map((t) => t.userIdType).sort()).toEqual([
      "anonymous_id",
      "user_id",
    ]);
    const resources = getDatasourceTemplateResources({
      datasource: { ...ds, settings },
      template: "segment",
      schemaOptions: {},
      existingFactTables: [],
    });
    expect(resources.factTables.length).toBeGreaterThan(0);
    expect(resources.factTables[0].factTable.sql).toContain(
      "FROM segment.tracks",
    );
  });
});

describe("getDatasourceTemplateSettings", () => {
  it("adds only the missing identifier types and keeps existing queries", () => {
    const settings = getDatasourceTemplateSettings({
      datasource: businessClickhouse(),
      template: "langfuse",
      schemaOptions: {},
    });
    expect(settings.schemaFormat).toBe("custom");
    expect(settings.userIdTypes?.map((t) => t.userIdType)).toEqual([
      "user_id",
      "anonymous_id",
      "session_id",
      "trace_id",
    ]);
    expect(settings.queries?.exposure?.[0].id).toBe("user_id");
  });

  it("adds prefixed assignment queries scoped to the project", () => {
    const settings = getDatasourceTemplateSettings({
      datasource: businessClickhouse(),
      template: "langfuse",
      schemaOptions: { projectId: "proj_1" },
    });
    const exposure = settings.queries?.exposure || [];
    expect(exposure.map((q) => q.id)).toEqual([
      "user_id",
      "langfuse_user_id",
      "langfuse_session_id",
      "langfuse_trace_id",
    ]);
    expect(exposure[1].name).toBe("Langfuse: Logged-in Users");
    expect(exposure[1].query).toContain("t.project_id = 'proj_1'");
    expect(settings.queries?.identityJoins?.[0].ids).toEqual([
      "user_id",
      "session_id",
    ]);
  });

  it("is a no-op when applied a second time", () => {
    const ds = businessClickhouse();
    const once = getDatasourceTemplateSettings({
      datasource: ds,
      template: "langfuse",
      schemaOptions: {},
    });
    const twice = getDatasourceTemplateSettings({
      datasource: { ...ds, settings: once },
      template: "langfuse",
      schemaOptions: {},
    });
    expect(twice).toEqual(once);
  });
});

describe("getDatasourceTemplateResources", () => {
  it("builds the template's fact tables for an existing Data Source", () => {
    const resources = getDatasourceTemplateResources({
      datasource: businessClickhouse(),
      template: "langfuse",
      schemaOptions: {},
      existingFactTables: [],
    });
    expect(resources.factTables.map((f) => f.factTable.name)).toEqual([
      "Langfuse Traces",
      "Langfuse Observations",
      "Langfuse Scores",
    ]);
  });

  it("skips fact tables the Data Source already has", () => {
    const resources = getDatasourceTemplateResources({
      datasource: businessClickhouse(),
      template: "langfuse",
      schemaOptions: {},
      existingFactTables: [
        { name: "Langfuse Traces", datasource: "ds_business", archived: false },
        // Archived, or on another Data Source: still created.
        { name: "Langfuse Scores", datasource: "ds_business", archived: true },
        {
          name: "Langfuse Observations",
          datasource: "ds_other",
          archived: false,
        },
      ],
    });
    expect(resources.factTables.map((f) => f.factTable.name)).toEqual([
      "Langfuse Observations",
      "Langfuse Scores",
    ]);
  });
});
