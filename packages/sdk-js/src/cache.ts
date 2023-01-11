export interface CacheEntry {
  // eslint-disable-next-line
  payload: any;
  staleOn: Date;
  expiresOn: Date;
}

export interface Settings {
  engine: "memory" | "localStorage";
  staleTTL?: number;
  expiresTTL?: number;
}

export class Cache {
  private localStoragePrefix = "growthbook_features";
  private engine: "memory" | "localStorage" = "memory";
  private store:
    | Map<string, CacheEntry>
    | {
        get: (key: string) => CacheEntry | undefined;
        set: (key: string, payload: CacheEntry) => void;
      }
    | undefined;
  private staleTTL = 60;
  private expiresTTL: number = 10 * 60;

  public initialize({ engine = "memory", staleTTL, expiresTTL }: Settings) {
    this.engine = engine;
    this.staleTTL = (staleTTL || this.staleTTL) * 1000;
    this.expiresTTL = (expiresTTL || this.expiresTTL) * 1000;

    if (engine === "memory") {
      this.store = new Map();
    } else if (engine === "localStorage") {
      this.store = {
        get: (key: string): CacheEntry | undefined => {
          try {
            const res = window.localStorage.getItem(
              `${this.localStoragePrefix}_${key}`
            );
            const parsed = res ? JSON.parse(res) : undefined;
            if (parsed) {
              (parsed as CacheEntry).staleOn = new Date(parsed.staleOn);
              (parsed as CacheEntry).expiresOn = new Date(parsed.expiresOn);
            }
            return parsed;
          } catch (e) {
            console.error("cache get error", e);
            return undefined;
          }
        },
        set: (key: string, payload: CacheEntry) => {
          window.localStorage.setItem(
            `${this.localStoragePrefix}_${key}`,
            JSON.stringify(payload)
          );
        },
      };
    }
  }

  public get(key: string): CacheEntry | undefined {
    const entry = this.store?.get(key);
    if (!entry || entry.expiresOn < new Date()) {
      return undefined;
    }
    return entry;
  }

  public set(key: string, payload: unknown) {
    this.store?.set(key, {
      payload,
      staleOn: new Date(Date.now() + this.staleTTL),
      expiresOn: new Date(Date.now() + this.expiresTTL),
    });
  }
}

const featuresCache = new Cache();
export default featuresCache;
