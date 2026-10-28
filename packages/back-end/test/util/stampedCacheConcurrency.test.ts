import { StampedCache, StampedLoad } from "back-end/src/util/stampedCache";

type Doc = { id: string; version: number };

// Deterministic, so a failing seed can be replayed
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ticks(n: number) {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function run(seed: number) {
  const rand = prng(seed);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const keys = Array.from({ length: 14 }, (_, i) => `org_${i}`);
  const maxSize = 10;

  // Each write replaces stamp and version together, like one Mongo update
  const store = new Map<string, { stamp: string; version: number }>();
  let stampCounter = 0;
  for (const key of keys) {
    store.set(key, { stamp: `s${stampCounter++}`, version: 0 });
  }
  let now = 0;

  const cache = new StampedCache<Doc>({
    maxAgeMs: 50,
    maxSize,
    now: () => now,
    readStamp: async (key) => {
      await ticks(Math.floor(rand() * 4));
      return store.get(key)?.stamp ?? null;
    },
    load: async (key): Promise<StampedLoad<Doc>> => {
      await ticks(Math.floor(rand() * 6));
      const current = store.get(key);
      if (!current) return null;
      return {
        value: { id: key, version: current.version },
        stamp: current.stamp,
      };
    },
  });

  const failures: string[] = [];
  const read = async (key: string) => {
    const committedAtStart = store.get(key)?.version ?? -1;
    const org = await cache.get(key);
    if (!org) {
      failures.push(`${key}: null`);
    } else if (org.id !== key) {
      failures.push(`${key}: got ${org.id}`);
    } else if (org.version < committedAtStart) {
      failures.push(`${key}: v${org.version} < committed v${committedAtStart}`);
    }
    if (cache.size > maxSize) failures.push(`size ${cache.size}`);
  };
  const write = async (key: string) => {
    await ticks(Math.floor(rand() * 3));
    const current = store.get(key);
    if (!current) return;
    store.set(key, {
      stamp: `s${stampCounter++}`,
      version: current.version + 1,
    });
  };

  const ops: Promise<void>[] = [];
  for (let i = 0; i < 1500; i++) {
    const key = pick(keys);
    now += Math.floor(rand() * 3);
    ops.push(rand() < 0.2 ? write(key) : read(key));
    if (rand() < 0.3) await ticks(1);
  }
  await Promise.all(ops);
  return { failures, cache };
}

describe("StampedCache under concurrent reads and writes", () => {
  it.each(Array.from({ length: 25 }, (_, i) => i + 1))(
    "never returns an org older than the last write before the read (seed %i)",
    async (seed) => {
      const { failures, cache } = await run(seed);
      expect(failures).toEqual([]);
      expect(cache.size).toBeLessThanOrEqual(10);
    },
  );
});
