import { promisify } from "util";
import zlib from "zlib";
import { getSessionReplayObjectBuffer, listSessionReplayChunks } from "./files";

const gunzip = promisify(zlib.gunzip);

export async function getSessionReplayEventsByStoragePrefix(
  storagePrefix: string,
): Promise<unknown[]> {
  // Routed through the session-replay bucket (S3_SESSION_REPLAY_BUCKET) using
  // the session-replay S3 client/role, not the general uploads bucket. The
  // back-end proxies these bytes to the browser so replay payloads stay
  // entirely behind authenticated REST endpoints.
  const chunkKeys = await listSessionReplayChunks(storagePrefix);
  const sortedChunkKeys = sortReplayChunkKeysByChunkIndex(chunkKeys);

  if (!sortedChunkKeys.length) {
    return [];
  }

  const eventsByChunk = await Promise.all(
    sortedChunkKeys.map(async (chunkKey) => {
      const gzippedChunk = await getSessionReplayObjectBuffer(chunkKey);
      const decompressed = await gunzip(gzippedChunk);
      return JSON.parse(decompressed.toString("utf-8"));
    }),
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
