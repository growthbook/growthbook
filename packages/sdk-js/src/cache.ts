export interface CacheEntry {
  // eslint-disable-next-line
  payload: any;
  staleOn: Date;
  expiresOn: Date;
}

export interface Settings {
  engine?: "memory" | "localStorage";
  staleTTL?: number;
  expiresTTL?: number;
}

export class Cache {
  private readonly localStoragePrefix = "growthbook_features";
  private readonly engine: "memory" | "localStorage";
  private readonly store:
    | Map<string, CacheEntry>
    | {
        get: (key: string) => CacheEntry;
        set: (key: string, payload: CacheEntry) => void;
      }
    | undefined;
  private readonly staleTTL: number;
  private readonly expiresTTL: number;

  public constructor({
    engine = "memory",
    staleTTL = 60, // 1 minute
    expiresTTL = 10 * 60, // 10 minutes
  }: Settings = {}) {
    this.engine = engine;
    if (engine === "memory") {
      this.store = new Map();
    } else if (engine === "localStorage") {
      this.store = {
        get: (key: string): CacheEntry => {
          const res = window.localStorage.getItem(
            `${this.localStoragePrefix}_${key}`
          );
          return res ? JSON.parse(res) : null;
        },
        set: (key: string, payload: CacheEntry) => {
          window.localStorage.setItem(
            `${this.localStoragePrefix}_${key}`,
            JSON.stringify(payload)
          );
        },
      };
    }
    this.staleTTL = staleTTL * 1000;
    this.expiresTTL = expiresTTL * 1000;
  }

  public async get(key: string): Promise<CacheEntry | undefined> {
    const entry = this.store?.get(key);
    if (!entry || entry.expiresOn < new Date()) {
      return undefined;
    }
    return entry;
  }

  public async set(key: string, payload: unknown) {
    this.store?.set(key, {
      payload,
      staleOn: new Date(Date.now() + this.staleTTL),
      expiresOn: new Date(Date.now() + this.expiresTTL),
    });
  }
}

const featuresCache = new Cache({
  engine: typeof window === "undefined" ? "memory" : "localStorage",
});
export default featuresCache;
