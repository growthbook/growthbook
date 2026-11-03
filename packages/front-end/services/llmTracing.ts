import { format } from "date-fns";
import {
  DataSourceInterfaceWithParams,
  SchemaFormat,
} from "shared/types/datasource";
import { FactTableInterface } from "shared/types/fact-table";
import { hasEventTrackerSql } from "@/services/datasources";
import { eventSchema, eventSchemas } from "@/services/eventSchema";

export const LLM_TRACING_FORMATS = ["langfuse", "phoenix"] as const;

export type LlmTracingFormat = (typeof LLM_TRACING_FORMATS)[number];

const FACT_TABLE_NAMES: Record<LlmTracingFormat, readonly string[]> = {
  langfuse: ["Langfuse Traces", "Langfuse Observations", "Langfuse Scores"],
  phoenix: ["Phoenix Traces", "Phoenix Spans", "Phoenix Annotations"],
};

export function isLlmTracingFormat(
  value: SchemaFormat | undefined,
): value is LlmTracingFormat {
  return (
    value !== undefined &&
    (LLM_TRACING_FORMATS as readonly string[]).includes(value)
  );
}

// One row per tool this connection can query. A later tool for the same
// warehouse shows up here without a layout change.
export function getLlmTracingTools(
  datasource: Pick<DataSourceInterfaceWithParams, "type">,
): eventSchema[] {
  return eventSchemas.filter(
    (schema) =>
      isLlmTracingFormat(schema.value) &&
      !!schema.types?.includes(datasource.type) &&
      hasEventTrackerSql(schema.value),
  );
}

export function getLlmTracingSchema(tool: LlmTracingFormat): eventSchema {
  const schema = eventSchemas.find((s) => s.value === tool);
  if (!schema) {
    throw new Error(`Missing LLM tracing schema for ${tool}`);
  }
  return schema;
}

type TracingFactTable = Pick<
  FactTableInterface,
  "name" | "datasource" | "archived" | "dateCreated"
>;

function matchingFactTables(
  datasourceId: string,
  tool: LlmTracingFormat,
  factTables: TracingFactTable[],
): TracingFactTable[] {
  const names = new Set(FACT_TABLE_NAMES[tool]);
  return factTables.filter(
    (factTable) =>
      factTable.datasource === datasourceId &&
      !factTable.archived &&
      names.has(factTable.name),
  );
}

// Partial setups stay recoverable. The add modal skips unarchived fact tables.
export function isLlmTracingToolAdded({
  datasource,
  tool,
  factTables,
}: {
  datasource: Pick<DataSourceInterfaceWithParams, "id">;
  tool: LlmTracingFormat;
  factTables: TracingFactTable[];
}): boolean {
  const present = new Set(
    matchingFactTables(datasource.id, tool, factTables).map(
      (factTable) => factTable.name,
    ),
  );
  return FACT_TABLE_NAMES[tool].every((name) => present.has(name));
}

export function getLlmTracingAddedAt(
  datasourceId: string,
  tool: LlmTracingFormat,
  factTables: TracingFactTable[],
): Date | null {
  const times = matchingFactTables(datasourceId, tool, factTables).flatMap(
    (factTable) => {
      if (!factTable.dateCreated) return [];
      const date = new Date(factTable.dateCreated);
      return Number.isNaN(date.getTime()) ? [] : [date.getTime()];
    },
  );
  if (times.length === 0) return null;
  return new Date(Math.min(...times));
}

export function getLlmTracingProjectScope(
  tool: LlmTracingFormat,
  schemaOptions?: Record<string, string | number>,
): string {
  if (tool === "langfuse") {
    const projectId = String(schemaOptions?.projectId ?? "").trim();
    return projectId || "All Langfuse projects";
  }
  const projectName = String(schemaOptions?.projectName ?? "").trim();
  return projectName || "All Phoenix projects";
}

export function getLlmTracingReadsLabel(tool: LlmTracingFormat): string {
  if (tool === "langfuse") return "Reads Langfuse's ClickHouse database";
  return "Reads Phoenix's Postgres database";
}

// The status label carries "Added". Omit the date when no fact table records one.
export function formatLlmTracingAddedDetail(
  addedAt: Date | null,
  scope: string,
): string {
  if (!addedAt) return scope;
  return `${format(addedAt, "MMM d, yyyy")} · ${scope}`;
}
