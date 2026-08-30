import chunk from "lodash/chunk";

/**
 * Run callbacks in chunks of `chunkSize`, awaiting each chunk before the next.
 *
 * NOT settle-all: each chunk is a `Promise.all`, so the FIRST rejection aborts
 * the loop while its chunk-mates keep running and later chunks never start. For
 * writes that another step will compensate, that is a trap — the caller sees a
 * failure while work it believes stopped is still landing. Callers that need
 * every callback to finish must catch inside the callback and surface the error
 * after (see `featureContextualBanditSync`), not rely on this helper.
 */

// eslint-disable-next-line
export async function promiseAllChunks<T = any>(
  callbacks: (() => Promise<T>)[],
  chunkSize: number = 3,
): Promise<T[]> {
  let results: T[] = [];
  const chunks = chunk(callbacks, chunkSize);
  for (let i = 0; i < chunks.length; i++) {
    results = results.concat(await Promise.all(chunks[i].map((cb) => cb())));
  }
  return results;
}
