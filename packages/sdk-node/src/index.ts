/* eslint-disable @typescript-eslint/no-var-requires */
import type { IncomingMessage, ServerResponse } from "http";
import {
  GrowthBook,
  Context,
  setPolyfills,
  LocalStorageCompat,
} from "@growthbook/growthbook";

export {
  GrowthBook,
  setPolyfills,
  configureCache,
  clearCache,
} from "@growthbook/growthbook";

export type {
  Context,
  Experiment,
  Result,
  ExperimentOverride,
  Attributes,
  ConditionInterface,
  ExperimentStatus,
  FeatureDefinition,
  FeatureResult,
  FeatureResultSource,
  FeatureRule,
  JSONValue,
  SubscriptionFunction,
  Filter,
  VariationMeta,
  VariationRange,
} from "@growthbook/growthbook";

let polyfillsSet = false;

export interface GrowthBookMiddlewareProps<Request extends IncomingMessage> {
  context: Context;
  getAttributes?: (
    req: Request
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  timeout?: number;
  persistentCache?: LocalStorageCompat;
}

export function simpleFileCache(
  path: string = "/tmp/gbcache"
): LocalStorageCompat {
  const fs = require("fs/promises");

  const read = async () => {
    const contents = await fs.readFile(path);
    if (!contents) return null;
    const json = JSON.parse(contents);
    return json || null;
  };

  return {
    getItem: async (key: string) => {
      const json = await read();
      return json?.[key];
    },
    setItem: async (key: string, value: string) => {
      const json = (await read()) || {};
      json[key] = value;
      await fs.writeFile(path, JSON.stringify(json));
    },
  };
}

export function growthbookMiddleware<
  Request extends IncomingMessage,
  Response extends ServerResponse,
  // eslint-disable-next-line
  NextFunction extends (err?: any) => void
>({
  context,
  getAttributes,
  timeout = 3000,
  persistentCache,
}: GrowthBookMiddlewareProps<Request>) {
  if (!polyfillsSet) {
    polyfillsSet = true;
    setPolyfills({
      // Node 18+ will use built-in fetch
      // Older Node versions will require adding `node-fetch` as a dependency
      fetch: globalThis.fetch || require("node-fetch"),
      // node:crypto added in Node 16, only required if using encryption
      SubtleCrypto: context.decryptionKey
        ? require("node:crypto").webcrypto.subtle
        : undefined,
      EventSource: require("eventsource"),
      // Default to caching in a tmp file
      localStorage: persistentCache || simpleFileCache(),
    });
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Create a GrowthBook instance
      const gb = new GrowthBook({
        ...context,
        attributes: {
          ...context.attributes,
          ...(getAttributes ? await getAttributes(req) : null),
        },
      });

      // Store it in the request for use later
      (req as Request & { growthbook: GrowthBook }).growthbook = gb;

      // Clean up at the end of the request
      res.on("close", () => gb.destroy());

      // Wait for features to load (will be cached in-memory for future requests)
      await gb.loadFeatures({ timeout, autoRefresh: false });
      next();
    } catch (e) {
      next(e);
    }
  };
}
