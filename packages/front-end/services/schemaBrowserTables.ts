import { SchemaWithPath, TableWithPath } from "shared/types/integrations";

export type SchemaBrowserTable = TableWithPath & {
  schemaName: string;
  shards?: number;
  hasIntraday?: boolean;
};

// Daily export shards like events_20240101 and events_intraday_20240102
const SHARD_RE = /^(.+?_)(intraday_)?\d{8}$/;

// Wildcard rows keep the newest daily shard's id for column lookups
export function getSchemaBrowserTables(
  schema: SchemaWithPath,
  groupDateShards: boolean,
): SchemaBrowserTable[] {
  const tables = schema.tables.map((t) => ({
    ...t,
    schemaName: schema.schemaName,
  }));
  if (!groupDateShards) return tables;

  const prefixOf = (name: string) => name.match(SHARD_RE)?.[1];
  const groups = new Map<string, SchemaBrowserTable[]>();
  tables.forEach((t) => {
    const prefix = prefixOf(t.tableName);
    if (prefix) groups.set(prefix, [...(groups.get(prefix) ?? []), t]);
  });

  return tables.flatMap((t): SchemaBrowserTable[] => {
    const prefix = prefixOf(t.tableName);
    const shards = prefix ? (groups.get(prefix) ?? []) : [];
    if (!prefix || shards.length < 2) return [t];
    // One row per group, where its first shard would have been
    if (shards[0] !== t) return [];

    const daily = shards.filter((s) => !s.tableName.match(SHARD_RE)?.[2]);
    const latest = (daily.length ? daily : shards).reduce((a, b) =>
      b.tableName > a.tableName ? b : a,
    );
    const tableName = `${prefix}*`;
    const i = latest.path.lastIndexOf(latest.tableName);
    return [
      {
        ...latest,
        tableName,
        path:
          latest.path.slice(0, i) +
          tableName +
          latest.path.slice(i + latest.tableName.length),
        shards: shards.length,
        hasIntraday: daily.length < shards.length,
      },
    ];
  });
}
