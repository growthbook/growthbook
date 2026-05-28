import { normalizeSnowflakeTableNameForEventForwarder } from "./snowflake-table-name";

export type BigQueryEventForwarderDestination = {
  dataset: string;
  table: string;
  projectId?: string;
};

export type SnowflakeEventForwarderDestination = {
  database: string;
  schema: string;
  table: string;
};

function unwrapIdentifier(segment: string): string {
  const trimmed = segment.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitQualifiedPath(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Destination table is required.");
  }

  return trimmed.split(".").map(unwrapIdentifier);
}

function assertNonEmptySegment(segment: string, label: string): string {
  if (!segment.trim()) {
    throw new Error(`${label} cannot be empty.`);
  }
  return segment.trim();
}

export function parseBigQueryEventForwarderDestination(
  input: string,
): BigQueryEventForwarderDestination {
  const segments = splitQualifiedPath(input);

  if (segments.length === 2) {
    return {
      dataset: assertNonEmptySegment(segments[0], "Dataset"),
      table: assertNonEmptySegment(segments[1], "Table"),
    };
  }

  if (segments.length === 3) {
    return {
      projectId: assertNonEmptySegment(segments[0], "Project"),
      dataset: assertNonEmptySegment(segments[1], "Dataset"),
      table: assertNonEmptySegment(segments[2], "Table"),
    };
  }

  throw new Error(
    "BigQuery destination must be dataset.table or project.dataset.table.",
  );
}

export function formatBigQueryEventForwarderDestination(
  destination: BigQueryEventForwarderDestination,
): string {
  const { dataset, table, projectId } = destination;
  if (projectId?.trim()) {
    return `${projectId.trim()}.${dataset.trim()}.${table.trim()}`;
  }
  return `${dataset.trim()}.${table.trim()}`;
}

export function parseSnowflakeEventForwarderDestination(
  input: string,
): SnowflakeEventForwarderDestination {
  const segments = splitQualifiedPath(input);

  if (segments.length !== 3) {
    throw new Error(
      "Snowflake destination must be DATABASE.SCHEMA.TABLE (three dot-separated parts).",
    );
  }

  const database = assertNonEmptySegment(segments[0], "Database").toUpperCase();
  const schema = assertNonEmptySegment(segments[1], "Schema").toUpperCase();
  const rawTable = assertNonEmptySegment(segments[2], "Table");

  return {
    database,
    schema,
    table: normalizeSnowflakeTableNameForEventForwarder(rawTable),
  };
}

export function formatSnowflakeEventForwarderDestination(
  destination: SnowflakeEventForwarderDestination,
): string {
  return `${destination.database.trim()}.${destination.schema.trim()}.${destination.table.trim()}`;
}
