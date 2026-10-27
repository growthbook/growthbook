type Entry<T> = {
  stamp: string;
  loadedAt: number;
  value: Promise<T | null>;
};

export type StampedCacheOptions<T> = {
  maxAgeMs: number;
  maxSize: number;
  // null means the key no longer exists
  readStamp: (key: string) => Promise<string | null>;
  load: (key: string) => Promise<T | null>;
  now?: () => number;
};

function isPlainObjectOrArray(value: unknown): value is object {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Leaves class instances (Date, ObjectId, Buffer) alone: some can't be frozen.
export function deepFreeze<T>(value: T): T {
  if (isPlainObjectOrArray(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Caches values that carry a cheap change marker. Every get reads the current
// stamp, so a write that changes the stamp is seen on the next get. Stored
// values are frozen because they are shared between callers.
export class StampedCache<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(private options: StampedCacheOptions<T>) {}

  async get(key: string): Promise<T | null> {
    const stamp = await this.options.readStamp(key);
    if (stamp === null) {
      this.entries.delete(key);
      return null;
    }

    const now = this.now();
    const existing = this.entries.get(key);
    if (
      existing &&
      existing.stamp === stamp &&
      now - existing.loadedAt <= this.options.maxAgeMs
    ) {
      return existing.value;
    }

    const entry: Entry<T> = {
      stamp,
      loadedAt: now,
      value: this.options.load(key).then((v) => deepFreeze(v)),
    };
    // Re-inserting keeps the map in load order, so the first key is the oldest
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.options.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }

    const drop = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
    entry.value.then((v) => v === null && drop(), drop);

    return entry.value;
  }

  get size() {
    return this.entries.size;
  }

  private now() {
    return this.options.now ? this.options.now() : Date.now();
  }
}
