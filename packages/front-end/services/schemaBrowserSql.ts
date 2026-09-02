const SIMPLE_SELECT_FROM =
  /^SELECT\s+([\s\S]+?)\s+FROM\s+((?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[^\s,;]+)(?:\.(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[^\s,;]+))*)\s*$/i;

function normalizeRelationPath(path: string): string {
  return path
    .trim()
    .replace(/["`[\]]/g, "")
    .toLowerCase();
}

function parseSimpleSelectFrom(sql: string): {
  selectList: string;
  fromPath: string;
  limit: string;
} | null {
  const stripped = sql
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (!stripped) return null;
  const limitMatch = stripped.match(/^(.*?)(\s+LIMIT\s+\d+)\s*$/is);
  const body = (limitMatch ? limitMatch[1] : stripped).trim();
  const limit = limitMatch ? limitMatch[2] : "";
  if (body.includes(";") || body.includes("(")) return null;
  const match = body.match(SIMPLE_SELECT_FROM);
  if (!match) return null;
  return {
    selectList: match[1].trim(),
    fromPath: match[2].trim(),
    limit,
  };
}

function selectListHasColumn(selectList: string, column: string): boolean {
  const target = normalizeRelationPath(column);
  return selectList
    .split(",")
    .some((part) => normalizeRelationPath(part) === target);
}

function isComplexSql(sql: string): boolean {
  const stripped = sql
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (!stripped) return false;
  if (stripped.includes(";")) return true;
  if (/^\s*WITH\b/i.test(stripped)) return true;
  if (/\bUNION\b/i.test(stripped)) return true;
  return (stripped.match(/\bSELECT\b/gi)?.length ?? 0) > 1;
}

export function columnInsertDisabledReason(
  sql: string,
  tablePath: string,
  column: string,
): string | null {
  if (!sql.trim()) return null;
  if (isComplexSql(sql)) {
    return "This query is too complex. Copy the column name instead.";
  }
  const parsed = parseSimpleSelectFrom(sql);
  if (
    parsed &&
    normalizeRelationPath(parsed.fromPath) !== normalizeRelationPath(tablePath)
  ) {
    return "This query selects from a different table. Copy the column name instead.";
  }
  if (
    parsed &&
    parsed.selectList !== "*" &&
    selectListHasColumn(parsed.selectList, column)
  ) {
    return "This column is already in SELECT.";
  }
  return null;
}

export function insertColumnIntoSelect(
  sql: string,
  column: string,
  tablePath: string,
): string {
  if (columnInsertDisabledReason(sql, tablePath, column)) return sql;
  const parsed = parseSimpleSelectFrom(sql);
  if (!parsed) {
    return `SELECT ${column} FROM ${tablePath}`;
  }
  if (parsed.selectList === "*") {
    return `SELECT ${column} FROM ${parsed.fromPath}${parsed.limit}`;
  }
  if (selectListHasColumn(parsed.selectList, column)) return sql;
  return `SELECT ${parsed.selectList}, ${column} FROM ${parsed.fromPath}${parsed.limit}`;
}
