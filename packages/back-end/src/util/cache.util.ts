import { logger } from "./logger";

type CacheObject<T> = {
  created: number;
  value: T;
};

export function createCache<T>({
  // By default, refresh in the background every 60 seconds
  staleTTL = 60000,
  // By default, if an entry is more than 5 minutes old, never use it
  maxTTL = 300000,
  fetcher,
  getKey,
}: {
  staleTTL?: number;
  maxTTL?: number;
  fetcher: (keys: string[]) => Promise<T[]>;
  getKey: (value: T) => string;
}) {
  const cache = new Map<string, CacheObject<T>>();

  const getNewValues = async (keys: string[]) => {
    try {
      const values = await fetcher(keys);

      const res: Record<string, T> = {};

      for (const value of values) {
        const k = getKey(value);
        res[k] = value;
        cache.set(k, {
          value,
          created: Date.now(),
        });
      }

      return res;
    } catch (e) {
      logger.error(e, `Failed to update cache entry for ${keys.join(",")}`);
      return {};
    }
  };

  const getMany = async (
    keys: string[],
    skipCache: boolean = false
  ): Promise<Record<string, T>> => {
    // If skipping cache, just get new values
    if (skipCache) {
      return getNewValues(keys);
    }

    // Values that are already cached
    const result: Record<string, T> = {};
    const missingKeys: string[] = [];
    const staleKeys: string[] = [];
    const now = Date.now();
    keys.forEach((k) => {
      const data = cache.get(k);

      // Not cached
      if (!data) {
        missingKeys.push(k);
        return;
      }

      const age = now - data.created;

      // Fresh
      if (age < staleTTL) {
        result[k] = data.value;
        return;
      }

      // Stale
      if (age >= staleTTL && age < maxTTL) {
        staleKeys.push(k);
        result[k] = data.value;
        return;
      }

      // Expired
      missingKeys.push(k);
    });

    // If there are any missing keys, fetch them and await
    if (missingKeys.length > 0) {
      // Fetch both missing and stale keys in a single query
      const newValues = await getNewValues(missingKeys.concat(staleKeys));
      for (const [key, value] of Object.entries(newValues)) {
        result[key] = value;
      }
    }
    // If there are no missing keys, but some stale keys, refresh in background
    else if (staleKeys.length > 0) {
      getNewValues(staleKeys);
    }

    return result;
  };

  // Purge expired entries every 5 minutes
  setInterval(() => {
    const oldestDate = Date.now() - maxTTL;
    for (const [key, value] of cache.entries()) {
      if (value.created < oldestDate) {
        cache.delete(key);
      }
    }
  }, 300000);

  return {
    getOne: async (
      key: string,
      skipCache: boolean = false
    ): Promise<T | null> => {
      const data = await getMany([key], skipCache);
      return data[key] ?? null;
    },
    getMany,
    set: (key: string, value: T): void => {
      cache.set(key, {
        value,
        created: Date.now(),
      });
    },
    invalidate: (key: string): void => {
      cache.delete(key);
    },
    clear: (): void => {
      cache.clear();
    },
  };
}
