// Utilities for spilling large sub-documents into a separate Mongo collection
// when they would push the parent document past the 16MB BSON limit.

// Threshold at which we divert snapshot `analyses` to the overflow collection.
// 12MB leaves comfortable headroom under the 16MB BSON limit for the rest of
// the snapshot document (settings, queries, health, etc).
export const SNAPSHOT_ANALYSES_OVERFLOW_THRESHOLD_BYTES = 12 * 1024 * 1024;

// Slices by JS string length (UTF-16 code units), not bytes. Analyses are
// mostly ASCII so actual BSON size is ~1:1; worst case ~3x still well under
// 16MB.
export const OVERFLOW_CHUNK_SIZE_CHARS = 4 * 1024 * 1024;

export function estimateJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function chunkString(str: string, chunkSize: number): string[] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be positive");
  }
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    chunks.push(str.slice(i, i + chunkSize));
  }
  return chunks;
}
