import { describe, expect, it } from "vitest";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { FactTableInterface } from "shared/types/fact-table";
import {
  formatLlmTracingAddedDetail,
  getLlmTracingAddedAt,
  getLlmTracingProjectScope,
  getLlmTracingSchemaOptionValues,
  getLlmTracingTools,
  isLlmTracingToolAdded,
  resolveLlmTracingSchemaOptions,
} from "@/services/llmTracing";

function datasource(
  overrides: Partial<DataSourceInterfaceWithParams> = {},
): DataSourceInterfaceWithParams {
  return {
    id: "ds_1",
    type: "clickhouse",
    params: {},
    settings: { schemaFormat: "custom", userIdTypes: [] },
    ...overrides,
  } as DataSourceInterfaceWithParams;
}

function factTable(
  name: string,
  overrides: Partial<FactTableInterface> = {},
): FactTableInterface {
  return {
    id: name,
    name,
    datasource: "ds_1",
    archived: false,
    dateCreated: new Date(2026, 10, 2),
    ...overrides,
  } as FactTableInterface;
}

describe("getLlmTracingTools", () => {
  it("offers only the tool that matches the connection type", () => {
    expect(
      getLlmTracingTools({ type: "clickhouse" }).map((t) => t.value),
    ).toEqual(["langfuse"]);
    expect(
      getLlmTracingTools({ type: "postgres" }).map((t) => t.value),
    ).toEqual(["phoenix"]);
    expect(getLlmTracingTools({ type: "bigquery" })).toEqual([]);
  });
});

describe("isLlmTracingToolAdded", () => {
  it("is added when every fact table is present and unarchived", () => {
    expect(
      isLlmTracingToolAdded({
        datasource: datasource(),
        tool: "langfuse",
        factTables: [
          factTable("Langfuse Traces"),
          factTable("Langfuse Observations"),
          factTable("Langfuse Scores"),
        ],
      }),
    ).toBe(true);
  });

  it("is not added when an assignment query exists but a fact table is missing", () => {
    expect(
      isLlmTracingToolAdded({
        datasource: datasource({
          settings: {
            schemaFormat: "custom",
            queries: {
              exposure: [
                {
                  id: "langfuse_user_id",
                  name: "Langfuse: Logged-in Users",
                  userIdType: "user_id",
                  userIdTypes: ["user_id"],
                  query: "select 1",
                  dimensions: [],
                },
              ],
            },
          },
        }),
        tool: "langfuse",
        factTables: [
          factTable("Langfuse Traces"),
          factTable("Langfuse Observations"),
        ],
      }),
    ).toBe(false);
  });

  it("is not added when the Data Source format matches but fact tables are missing", () => {
    expect(
      isLlmTracingToolAdded({
        datasource: datasource({
          settings: { schemaFormat: "langfuse" },
        }),
        tool: "langfuse",
        factTables: [],
      }),
    ).toBe(false);
  });

  it("ignores archived fact tables and other Data Sources", () => {
    expect(
      isLlmTracingToolAdded({
        datasource: datasource(),
        tool: "langfuse",
        factTables: [
          factTable("Langfuse Traces"),
          factTable("Langfuse Observations"),
          factTable("Langfuse Scores", { archived: true }),
          factTable("Langfuse Scores", { datasource: "ds_other" }),
        ],
      }),
    ).toBe(false);
  });
});

describe("LLM tracing project scope", () => {
  it("loads the saved project instead of the blank default", () => {
    expect(
      getLlmTracingSchemaOptionValues("langfuse", { projectId: " proj_1 " }),
    ).toEqual({ projectId: "proj_1" });
    expect(getLlmTracingSchemaOptionValues("phoenix", {})).toEqual({
      projectName: "",
    });
  });

  it("keeps the saved project once any of the tool is already set up", () => {
    const partial = datasource({
      settings: {
        schemaFormat: "custom",
        queries: {
          exposure: [
            {
              id: "langfuse_user_id",
              name: "Langfuse: Logged-in Users",
              userIdType: "user_id",
              userIdTypes: ["user_id"],
              query: "select 1",
              dimensions: [],
            },
          ],
        },
        schemaOptions: { projectId: "proj_1" },
      },
    });
    expect(
      resolveLlmTracingSchemaOptions({
        datasource: partial,
        tool: "langfuse",
        schemaOptions: { projectId: "" },
        factTables: [factTable("Langfuse Traces")],
      }),
    ).toEqual({ projectId: "proj_1" });
    expect(
      resolveLlmTracingSchemaOptions({
        datasource: datasource(),
        tool: "langfuse",
        schemaOptions: { projectId: "  proj_2  " },
        factTables: [],
      }),
    ).toEqual({ projectId: "proj_2" });
  });
});

describe("LLM tracing status", () => {
  it("uses the earliest fact table date", () => {
    const addedAt = getLlmTracingAddedAt("ds_1", "phoenix", [
      factTable("Phoenix Spans", { dateCreated: new Date(2026, 10, 4) }),
      factTable("Phoenix Traces", { dateCreated: new Date(2026, 10, 2) }),
      factTable("Phoenix Annotations", { archived: true }),
    ]);
    expect(addedAt).toEqual(new Date(2026, 10, 2));
  });

  it("describes an empty project option as every project", () => {
    expect(getLlmTracingProjectScope("langfuse", {})).toBe(
      "All Langfuse projects",
    );
    expect(getLlmTracingProjectScope("langfuse", { projectId: "  " })).toBe(
      "All Langfuse projects",
    );
    expect(getLlmTracingProjectScope("langfuse", { projectId: "proj_1" })).toBe(
      "proj_1",
    );
    expect(getLlmTracingProjectScope("phoenix", {})).toBe(
      "All Phoenix projects",
    );
    expect(
      getLlmTracingProjectScope("phoenix", { projectName: "support" }),
    ).toBe("support");
  });

  it("includes the date in the added detail when one exists", () => {
    expect(
      formatLlmTracingAddedDetail(
        new Date(2026, 10, 2),
        "All Langfuse projects",
      ),
    ).toBe("Nov 2, 2026 · All Langfuse projects");
    expect(formatLlmTracingAddedDetail(null, "All Phoenix projects")).toBe(
      "All Phoenix projects",
    );
  });
});
