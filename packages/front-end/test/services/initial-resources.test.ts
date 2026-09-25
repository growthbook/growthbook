import { describe, expect, it, vi } from "vitest";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { getInitialDatasourceResources } from "@/services/initial-resources";
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
