// Redshift, Vertica, and Presto/Athena CONCAT only accept two strings.
export function concatSql(...parts: string[]): string {
  if (parts.length === 0) return "''";
  return parts.reduce((left, right) => `CONCAT(${left}, ${right})`);
}
