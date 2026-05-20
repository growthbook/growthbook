import { DataSourceInterfaceWithParams } from "shared/types/datasource";

type StableJson =
  | null
  | string
  | number
  | boolean
  | StableJson[]
  | { [key: string]: StableJson };

function stableValue(value: unknown): StableJson {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, stableValue(inner)]),
    );
  }
  return String(value);
}

function pickFields(
  source: Record<string, unknown> | undefined,
  fields: string[],
): Record<string, unknown> {
  if (!source) return {};
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}

export function computeEventForwarderAccessSignature(
  datasource: Partial<DataSourceInterfaceWithParams>,
): string {
  const config = datasource.eventForwarderConfig;
  if (!config) return "";

  const params = datasource.params as Record<string, unknown> | undefined;
  const base = {
    type: datasource.type,
    eventForwarderConfig: config,
  };

  if (config.sinkType === "bigquery") {
    return JSON.stringify(
      stableValue({
        ...base,
        params: pickFields(params, [
          "authType",
          "projectId",
          "defaultProject",
          "defaultDataset",
          "clientEmail",
          "privateKey",
          "serviceAccountJson",
        ]),
      }),
    );
  }

  if (config.sinkType === "snowflake") {
    return JSON.stringify(
      stableValue({
        ...base,
        params: pickFields(params, [
          "account",
          "username",
          "authMethod",
          "privateKey",
          "privateKeyPassword",
        ]),
      }),
    );
  }

  return JSON.stringify(
    stableValue({
      ...base,
      params: pickFields(params, ["host", "port", "path", "token", "catalog"]),
    }),
  );
}
