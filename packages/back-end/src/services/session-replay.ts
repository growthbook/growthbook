import { promisify } from "util";
import zlib from "zlib";
import { promiseAllChunks } from "back-end/src/util/promise";
import { getSessionReplayObjectBuffer, SessionReplayRegion } from "./files";

const gunzip = promisify(zlib.gunzip);

// Bounds the fan-out so a pathological session can't open one S3 connection
// per chunk, without serialising normal ones: a 33-chunk session measured
// ~1.1s at 24 versus ~1.75s at 6, since each batch costs a full S3 round trip.
const CHUNK_FETCH_CONCURRENCY = 24;

/**
 * Fetch and decompress the rrweb events for an explicit list of chunk keys.
 *
 * Keys come from the ClickHouse metadata rows, which already carry each
 * chunk's s3_key, so no S3 listing is involved. The back-end proxies these
 * bytes to the browser, keeping replay payloads behind authenticated REST
 * endpoints. Routed through the session-replay bucket
 * (S3_SESSION_REPLAY_BUCKET / S3_SESSION_REPLAY_BUCKET_EU) and its own S3
 * client/role, not the general uploads bucket.
 */
export async function getSessionReplayEventsByChunkKeys(
  chunkKeys: string[],
  region: SessionReplayRegion,
): Promise<unknown[]> {
  const sortedChunkKeys = sortReplayChunkKeysByChunkIndex(chunkKeys);

  if (!sortedChunkKeys.length) {
    return [];
  }

  // promiseAllChunks preserves input order, so chunk ordering survives.
  const eventsByChunk = await promiseAllChunks(
    sortedChunkKeys.map((chunkKey) => async () => {
      const gzippedChunk = await getSessionReplayObjectBuffer(chunkKey, region);
      const decompressed = await gunzip(gzippedChunk);
      return JSON.parse(decompressed.toString("utf-8"));
    }),
    CHUNK_FETCH_CONCURRENCY,
  );

  return eventsByChunk.flat();
}

export function sortReplayChunkKeysByChunkIndex(chunkKeys: string[]): string[] {
  return [...chunkKeys].sort((a, b) => {
    const chunkIndexA = parseChunkIndexFromKey(a);
    const chunkIndexB = parseChunkIndexFromKey(b);
    return chunkIndexA - chunkIndexB;
  });
}

export function parseChunkIndexFromKey(storageKey: string): number {
  const fileName = storageKey.split("/").pop() ?? "";
  const numericText = fileName.replace(".json.gz", "");
  const parsedNumber = parseInt(numericText, 10);
  return Number.isFinite(parsedNumber) ? parsedNumber : 0;
}

/**
 * Given a map of SDK connection clientKey → projects and an optional project
 * filter, return the subset of clientKeys the caller is allowed to see.
 *
 * An SDK connection with an empty projects array is treated as "all projects"
 * and is always included regardless of the project filter.
 */
export function filterClientKeysByProject(
  permittedKeys: Map<string, string[]>,
  project?: string,
): string[] {
  const keys = Array.from(permittedKeys.keys());
  if (!project) return keys;
  return keys.filter((key) => {
    const projects = permittedKeys.get(key);
    if (!projects || projects.length === 0) return true;
    return projects.includes(project);
  });
}
