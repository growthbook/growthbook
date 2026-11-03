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
  "name" | "datasource" | "archived"
> & {
  dateCreated?: FactTableInterface["dateCreated"];
};

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

function projectOptionKey(tool: LlmTracingFormat): "projectId" | "projectName" {
  return tool === "langfuse" ? "projectId" : "projectName";
}

// Prefixed queries, a datasource created as this tool, or one of its fact
// tables. Their SQL already has a project scope baked in.
export function hasLlmTracingSetup({
  datasource,
  tool,
  factTables,
}: {
  datasource: Pick<DataSourceInterfaceWithParams, "id" | "settings">;
  tool: LlmTracingFormat;
  factTables: Pick<TracingFactTable, "name" | "datasource" | "archived">[];
}): boolean {
  if (datasource.settings?.schemaFormat === tool) return true;
  const prefix = `${tool}_`;
  const exposure = datasource.settings?.queries?.exposure || [];
  if (exposure.some((query) => query.id.startsWith(prefix))) return true;
  return matchingFactTables(datasource.id, tool, factTables).length > 0;
}

export function getLlmTracingSchemaOptionValues(
  tool: LlmTracingFormat,
  saved?: Record<string, string | number>,
): Record<string, string> {
  return Object.fromEntries(
    (getLlmTracingSchema(tool).options ?? []).map((option) => [
      option.name,
      saved?.[option.name] !== undefined
        ? String(saved[option.name]).trim()
        : String(option.defaultValue ?? ""),
    ]),
  );
}

// A retry must keep the saved project. New fact tables would otherwise be
// created for every project while the existing queries stay scoped.
export function resolveLlmTracingSchemaOptions({
  datasource,
  tool,
  schemaOptions,
  factTables,
}: {
  datasource: Pick<DataSourceInterfaceWithParams, "id" | "settings">;
  tool: LlmTracingFormat;
  schemaOptions: Record<string, string>;
  factTables: Pick<TracingFactTable, "name" | "datasource" | "archived">[];
}): Record<string, string> {
  const key = projectOptionKey(tool);
  const requested = String(schemaOptions[key] ?? "").trim();
  const saved = String(datasource.settings?.schemaOptions?.[key] ?? "").trim();
  const project = hasLlmTracingSetup({ datasource, tool, factTables })
    ? saved
    : requested;
  return { ...schemaOptions, [key]: project };
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
