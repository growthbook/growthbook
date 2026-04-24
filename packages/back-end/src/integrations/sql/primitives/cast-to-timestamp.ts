export function castToTimestamp(col: string): string {
  return `CAST(${col} AS TIMESTAMP)`;
}
