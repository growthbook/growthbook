import zlib from "zlib";
import { getFileBuffer, listFilesByPrefix } from "./files";

export async function getSessionReplayEventsByStoragePrefix(
  storagePrefix: string,
): Promise<unknown[]> {
  const chunkKeys = await listFilesByPrefix(storagePrefix);
  const sortedChunkKeys = sortReplayChunkKeysByChunkIndex(chunkKeys);

  if (!sortedChunkKeys.length) {
    return [];
  }

  const eventsByChunk = await Promise.all(
    sortedChunkKeys.map(async (chunkKey) => {
      const gzippedChunk = await getFileBuffer(chunkKey);
      return JSON.parse(zlib.gunzipSync(gzippedChunk).toString("utf-8"));
    }),
  );

  return eventsByChunk.flat();
}

function sortReplayChunkKeysByChunkIndex(chunkKeys: string[]): string[] {
  return [...chunkKeys].sort((a, b) => {
    const chunkIndexA = parseChunkIndexFromKey(a);
    const chunkIndexB = parseChunkIndexFromKey(b);
    return chunkIndexA - chunkIndexB;
  });
}

function parseChunkIndexFromKey(storageKey: string): number {
  const fileName = storageKey.split("/").pop() ?? "";
  const numericText = fileName.replace(".json.gz", "");
  const parsedNumber = parseInt(numericText, 10);
  return Number.isFinite(parsedNumber) ? parsedNumber : 0;
}
