export class MemoryCache<T> {
  private store: Map<string, { expires: number; obj: T }>;
  private ttl: number;

  public constructor(ttl: number = 30) {
    this.store = new Map();
    this.ttl = ttl * 1000;
  }

  public get(key: string): T | null {
    const existing = this.store.get(key);
    if (existing && existing.expires > Date.now()) {
      return existing.obj;
    }

    return null;
  }

  public set(key: string, obj: T) {
    this.store.set(key, {
      expires: Date.now() + this.ttl,
      obj,
    });
  }
}
