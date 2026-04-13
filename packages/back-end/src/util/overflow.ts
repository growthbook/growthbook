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

export function chunkString(str: string, chunkSize: number): string[] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be positive");
  }
  const chunks: string[] = [];
  let i = 0;
  while (i < str.length) {
    let end = Math.min(i + chunkSize, str.length);
    // Don't split a surrogate pair across chunks: a lone surrogate stored as
    // UTF-8 in Mongo round-trips as U+FFFD, corrupting the rejoined JSON.
    // Back off one code unit if the boundary lands between a high surrogate
    // (0xD800-0xDBFF) and its low surrogate.
    if (end < str.length && end - 1 > i) {
      const code = str.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    chunks.push(str.slice(i, end));
    i = end;
  }
  return chunks;
}
