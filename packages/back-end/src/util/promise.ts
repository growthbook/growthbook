import lodash from "lodash";

const { chunk } = lodash;
export async function promiseAllChunks<T = unknown>(
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
