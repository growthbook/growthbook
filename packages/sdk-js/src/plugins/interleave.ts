import type { GrowthBook } from "../GrowthBook";
import type { UserScopedGrowthBook } from "../GrowthBookClient";
import { genUUID, hash } from "../util";
import { AnyGrowthBook, isGrowthBookClient } from "./utils/instance";

export const EVENT_INTERLEAVE_EXPOSURE = "Interleave Exposure";

// A ranker's config, authored in GrowthBook and handed straight to getList.
// Opaque to the SDK — only getList knows its shape.
export type InterleaveConfig = Record<string, unknown>;

export type InterleavedItem = {
  itemId: string;
  // The ranker that drafted the item. Arbitrary for a tie, since both rankers
  // picked it; the supplying ranker for a leftover or a maxItems fill.
  variation: string;
  position: number;
  // False for ties, leftovers and fills; analysis only counts competitive items
  competitive: boolean;
};

export type InterleaveExposure = {
  timestamp: number;
  experimentId: string;
  rankingId: string;
  hashAttribute: string;
  hashValue: string;
  items: InterleavedItem[];
};

export type InterleavePluginOptions = {
  // Called once per interleaved impression, with no dedupe
  onExposure?: (exposure: InterleaveExposure) => void | Promise<void>;
};

// `C` is the ranker config's shape. Constrained to `object`, not InterleaveConfig:
// an interface has no implicit index signature, so Record<string, unknown> would
// reject one. TypeScript has no partial type-argument inference, so pass both
// type arguments or neither.
export type InterleaveOptions<T, C extends object = InterleaveConfig> = {
  // The interleaving experiment's key
  key: string;
  getList: (config: C) => T[] | Promise<T[]>;
  // Used when the interleaving isn't in the payload
  fallbackConfig: C;
  // One id per query or impression. Seeds the draft, so reusing it replays the
  // same list. Defaults to a uuid
  rankingId?: string;
  // Set false to skip interleaving for this call, e.g. a user-selected sort
  enabled?: boolean;
  // Defaults to the item itself for strings and numbers, otherwise `item.id`
  getItemId?: (item: T) => string;
  maxItems?: number;
};

export type InterleaveTrackingProps = {
  experiment_id?: string;
  ranking_id?: string;
};

export type InterleaveResult<T> = {
  result: T[];
  inExperiment: boolean;
  // The ranker whose config was used when not interleaved
  variation?: string;
  rankingId: string;
  // Spread into engagement events along with `item_id`. Empty when not interleaved
  trackingProps: InterleaveTrackingProps;
};

type InterleaveInstance = GrowthBook | UserScopedGrowthBook;

const optionsByInstance = new WeakMap<object, InterleavePluginOptions>();

export function interleavePlugin(options: InterleavePluginOptions = {}) {
  return (gb: AnyGrowthBook) => {
    // Re-run by each UserScopedGrowthBook a multi-user client creates
    if (isGrowthBookClient(gb)) return;
    optionsByInstance.set(gb, options);
  };
}

function defaultItemId(item: unknown): string {
  if (typeof item === "string" || typeof item === "number") {
    return String(item);
  }
  const id = (item as { id?: unknown } | null)?.id;
  return id === undefined || id === null ? "" : String(id);
}

type RankerList<T> = { variation: string; items: T[] };

export function teamDraft<T>(
  lists: [RankerList<T>, RankerList<T>],
  getItemId: (item: T) => string,
  // Which ranker picks first in a round. The caller owns the seeding
  firstPicker: (round: number) => 0 | 1,
  maxItems?: number,
): { items: T[]; meta: InterleavedItem[] } {
  const items: T[] = [];
  const meta: InterleavedItem[] = [];
  const taken = new Set<string>();
  const cursors = [0, 0];

  const next = (ranker: number): T | null => {
    const list = lists[ranker].items;
    let c = cursors[ranker];
    while (c < list.length && taken.has(getItemId(list[c]))) c++;
    cursors[ranker] = c;
    return c < list.length ? list[c] : null;
  };

  const place = (item: T, ranker: number, competitive: boolean) => {
    const itemId = getItemId(item);
    taken.add(itemId);
    items.push(item);
    meta.push({
      itemId,
      variation: lists[ranker].variation,
      position: items.length - 1,
      competitive,
    });
  };

  // A round places two items, so it can't be run with one slot left
  const capped = (picks: number) =>
    maxItems !== undefined && items.length + picks > maxItems;

  for (let round = 0; ; round++) {
    const first = firstPicker(round);
    const second = first === 0 ? 1 : 0;
    const firstItem = next(first);
    const secondItem = next(second);

    if (firstItem !== null && secondItem !== null) {
      // A shared top is placed once and credited to neither ranker, so the two
      // items placed below are always distinct and neither pick goes stale
      if (getItemId(firstItem) === getItemId(secondItem)) {
        if (capped(1)) break;
        place(firstItem, first, false);
        continue;
      }
      if (capped(2)) {
        // An earlier tie can leave a single slot. Filling it beats returning a
        // short list, and non-competitive keeps the fill out of analysis
        if (!capped(1)) place(firstItem, first, false);
        break;
      }
      place(firstItem, first, true);
      place(secondItem, second, true);
      continue;
    }

    // One ranker is out of items; the other's remainder isn't competitive
    const leftover = firstItem ?? secondItem;
    if (leftover === null) break;
    if (capped(1)) break;
    place(leftover, firstItem !== null ? first : second, false);
  }

  return { items, meta };
}

export async function interleave<T, C extends object = InterleaveConfig>(
  gb: InterleaveInstance,
  options: InterleaveOptions<T, C>,
): Promise<InterleaveResult<T>> {
  const { key, getList, fallbackConfig, maxItems } = options;
  const getItemId = options.getItemId || defaultItemId;
  const rankingId =
    options.rankingId ??
    genUUID(typeof crypto !== "undefined" ? crypto : undefined);

  const payload = gb.getDecryptedPayload();
  const definition = payload.interleavings?.[key];
  const variations = definition?.variations || [];

  // maxItems caps every list this returns, not just the drafted one, so the
  // option means the same thing on each exit.
  const capItems = (items: T[]) =>
    maxItems === undefined ? items : items.slice(0, maxItems);

  const notInterleaved = async (
    variation?: string,
  ): Promise<InterleaveResult<T>> => {
    const match = variations.find((v) => v.key === variation);
    return {
      result: capItems(
        await getList(match ? (match.config as C) : fallbackConfig),
      ),
      inExperiment: false,
      variation: match?.key,
      rankingId,
      trackingProps: {},
    };
  };

  if (options.enabled === false || gb._experimentsDisabled()) {
    return notInterleaved(variations[0]?.key);
  }

  if (!definition || variations.length !== 2) return notInterleaved();

  const featureId = "$interleave:" + key;
  const value = gb.evalFeature<unknown>(featureId).value;
  if (
    !value ||
    typeof value !== "object" ||
    !(value as { interleave?: boolean }).interleave
  ) {
    return notInterleaved(
      typeof value === "string" ? value : variations[0].key,
    );
  }

  const hashAttribute = definition.hashAttribute;
  const hashValue = gb.getAttributes()[hashAttribute];
  if (!hashValue) {
    return notInterleaved(variations[0].key);
  }

  // Settled by hand rather than with Promise.allSettled, which is ES2020 and
  // isn't polyfilled by the browser builds
  const settle = async (
    config: C,
  ): Promise<{ items: T[] } | { error: unknown }> => {
    try {
      return { items: await getList(config) };
    } catch (error) {
      return { error };
    }
  };
  const [a, b] = await Promise.all([
    settle(variations[0].config as C),
    settle(variations[1].config as C),
  ]);
  // A broken ranker shouldn't take the other one's results down with it. The
  // first ranker is the default, so if that one threw there is nothing left to
  // serve and the error belongs to the caller
  if ("error" in a) throw a.error;
  if ("error" in b) {
    console.error(
      `interleave: ranker "${variations[1].key}" of "${key}" threw, serving "${variations[0].key}"`,
      b.error,
    );
    return {
      result: capItems(a.items),
      inExperiment: false,
      variation: variations[0].key,
      rankingId,
      trackingProps: {},
    };
  }
  const lists: [RankerList<T>, RankerList<T>] = [
    { variation: variations[0].key, items: a.items },
    { variation: variations[1].key, items: b.items },
  ];
  if (lists.some((l) => l.items.some((item) => !getItemId(item)))) {
    console.error(
      `interleave: every item in "${key}" needs an id, pass getItemId`,
    );
    return {
      result: capItems(lists[0].items),
      inExperiment: false,
      variation: lists[0].variation,
      rankingId,
      trackingProps: {},
    };
  }

  const { items, meta } = teamDraft(
    lists,
    getItemId,
    // One hash per round, split at the midpoint: hash() buckets into 10000, so
    // this is an even coin flip
    (round) =>
      (hash(definition.seed, rankingId + ":" + round, 2) || 0) < 0.5 ? 0 : 1,
    maxItems,
  );

  const exposure: InterleaveExposure = {
    timestamp: Date.now(),
    experimentId: definition.trackingKey,
    rankingId,
    hashAttribute,
    hashValue: String(hashValue),
    items: meta,
  };
  const onExposure = optionsByInstance.get(gb)?.onExposure;
  if (onExposure) {
    // Exposure logging must never block or break serving
    try {
      Promise.resolve(onExposure(exposure)).catch(console.error);
    } catch (e) {
      console.error(e);
    }
  }
  // Skipped when nothing consumes it: logEvent logs an error of its own when
  // no logger is configured, and this fires once per impression
  if (gb._hasEventConsumer()) {
    gb.logEvent(EVENT_INTERLEAVE_EXPOSURE, { ...exposure });
  }

  return {
    result: items,
    inExperiment: true,
    rankingId,
    trackingProps: {
      experiment_id: definition.trackingKey,
      ranking_id: rankingId,
    },
  };
}
