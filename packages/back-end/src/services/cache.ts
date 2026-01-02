export type ExpensiveOperation<T, K> = (key: K) => Promise<T>;

export class MemoryCache<T, K> {
  private store: Map<K, { expires: number; obj: T }>;
  private expensiveOperation: ExpensiveOperation<T, K>;
  private ttl: number;

  public constructor(
    expensiveOperation: ExpensiveOperation<T, K>,
    ttl: number = 30,
  ) {
    this.store = new Map();
    this.ttl = ttl * 1000;
    this.expensiveOperation = expensiveOperation;
  }

  public async get(key: K): Promise<T> {
    // Already cached
    const existing = this.store.get(key);
    if (existing && existing.expires > Date.now()) {
      return existing.obj;
    }

    // Do the expensive operation and cache it
    const obj = await this.expensiveOperation(key);
    this.store.set(key, {
      expires: Date.now() + this.ttl,
      obj,
    });
    return obj;
  }
}

export class LruCache<T, K> {
  private store: Map<K, T> = new Map<K, T>();

  public constructor(private maxEntries: number) {
    this.store = new Map<K, T>();
  }

  public get(key: K): T | undefined {
    const entry = this.store.get(key);
    if (entry) {
      this.store.delete(key);
      this.store.set(key, entry);
    }
    return entry;
  }

  public put(key: K, value: T) {
    if (this.store.size >= this.maxEntries) {
      // items are stored in insertion order, so the first key is the oldest
      const keyToDelete = this.store.keys().next().value;
      this.store.delete(keyToDelete);
    }
    this.store.set(key, value);
  }
}
