import { ObjectId } from "mongodb";
import { StampedCache, deepFreeze } from "back-end/src/util/stampedCache";

type Doc = { id: string; version: number; nested: { list: string[] } };

function setup({ maxAgeMs = 1000, maxSize = 10 } = {}) {
  let now = 0;
  const stamps = new Map<string, string>();
  const versions = new Map<string, number>();
  const readStamp = jest.fn(async (key: string) => stamps.get(key) ?? null);
  const load = jest.fn(async (key: string): Promise<Doc | null> => {
    const version = versions.get(key);
    if (version === undefined) return null;
    return { id: key, version, nested: { list: ["a"] } };
  });
  const cache = new StampedCache<Doc>({
    maxAgeMs,
    maxSize,
    readStamp,
    load,
    now: () => now,
  });
  const write = (key: string, stamp: string) => {
    stamps.set(key, stamp);
    versions.set(key, (versions.get(key) ?? 0) + 1);
  };
  const advance = (ms: number) => {
    now += ms;
  };
  return { cache, readStamp, load, write, advance, stamps };
}

describe("StampedCache", () => {
  it("reuses the loaded value while the stamp is unchanged", async () => {
    const { cache, readStamp, load, write } = setup();
    write("org_1", "s1");

    const first = await cache.get("org_1");
    const second = await cache.get("org_1");

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(readStamp).toHaveBeenCalledTimes(2);
  });

  it("reloads when the stamp changes", async () => {
    const { cache, load, write } = setup();
    write("org_1", "s1");
    expect((await cache.get("org_1"))?.version).toBe(1);

    write("org_1", "s2");
    expect((await cache.get("org_1"))?.version).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads once the copy is older than the max age", async () => {
    const { cache, load, write, advance } = setup({ maxAgeMs: 1000 });
    write("org_1", "s1");
    await cache.get("org_1");

    advance(1000);
    await cache.get("org_1");
    expect(load).toHaveBeenCalledTimes(1);

    advance(1);
    await cache.get("org_1");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("treats an empty stamp as a valid stamp", async () => {
    const { cache, load, write } = setup();
    write("org_1", "");
    await cache.get("org_1");
    await cache.get("org_1");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one load between concurrent callers with the same stamp", async () => {
    const { cache, load, write } = setup();
    write("org_1", "s1");

    const [a, b, c] = await Promise.all([
      cache.get("org_1"),
      cache.get("org_1"),
      cache.get("org_1"),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("deep-freezes stored values", async () => {
    const { cache, write } = setup();
    write("org_1", "s1");
    const doc = await cache.get("org_1");

    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc?.nested)).toBe(true);
    expect(Object.isFrozen(doc?.nested.list)).toBe(true);
    expect(() => doc?.nested.list.push("b")).toThrow(TypeError);
  });

  it("returns null and caches nothing when the key does not exist", async () => {
    const { cache, load } = setup();
    expect(await cache.get("missing")).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it("drops a cached value once its key is gone", async () => {
    const { cache, write, stamps } = setup();
    write("org_1", "s1");
    await cache.get("org_1");
    expect(cache.size).toBe(1);

    stamps.delete("org_1");
    expect(await cache.get("org_1")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("does not keep a load that returned null", async () => {
    const { cache, load, stamps } = setup();
    stamps.set("org_1", "s1");
    expect(await cache.get("org_1")).toBeNull();
    expect(await cache.get("org_1")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("does not keep a failed load", async () => {
    const { cache, load, write } = setup();
    write("org_1", "s1");
    load.mockRejectedValueOnce(new Error("boom"));

    await expect(cache.get("org_1")).rejects.toThrow("boom");
    expect(cache.size).toBe(0);
    expect((await cache.get("org_1"))?.version).toBe(1);
  });

  it("evicts the earliest-loaded key past the size limit", async () => {
    const { cache, load, write } = setup({ maxSize: 2 });
    write("a", "s1");
    write("b", "s1");
    write("c", "s1");

    await cache.get("a");
    await cache.get("b");
    // Reloading "a" makes "b" the earliest-loaded
    write("a", "s2");
    await cache.get("a");
    await cache.get("c");

    expect(cache.size).toBe(2);
    load.mockClear();
    await cache.get("a");
    await cache.get("c");
    expect(load).not.toHaveBeenCalled();
    await cache.get("b");
    expect(load).toHaveBeenCalledWith("b");
  });
});

describe("deepFreeze", () => {
  it("freezes plain objects and arrays but leaves class instances alone", () => {
    const date = new Date();
    const id = new ObjectId();
    const value = deepFreeze({ date, id, list: [{ a: 1 }] });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(date)).toBe(false);
    expect(Object.isFrozen(id)).toBe(false);
  });
});
