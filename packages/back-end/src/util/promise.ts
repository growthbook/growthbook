import chunk from "lodash/chunk";

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
