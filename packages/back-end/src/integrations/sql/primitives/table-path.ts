// Table paths are built unquoted (`db.schema.table`), so each part has to be
// a plain name. Hyphens are allowed for BigQuery project ids, but not `--`.
const SAFE_TABLE_PATH_PART = /^[\p{L}\p{N}_$-]+$/u;

export function assertSafeTablePathParts(
  ...parts: (string | undefined)[]
): void {
  for (const part of parts) {
    if (!part) continue;
    if (!SAFE_TABLE_PATH_PART.test(part) || part.includes("--")) {
      throw new Error(`Invalid table path name: ${JSON.stringify(part)}`);
    }
  }
}
