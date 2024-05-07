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
