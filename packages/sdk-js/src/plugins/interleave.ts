import type { GrowthBook } from "../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../GrowthBookClient";
import type { Attributes } from "../types/growthbook";
import { genUUID, hash } from "../util";

export const EVENT_INTERLEAVE_EXPOSURE = "Interleave Exposure";

export type InterleaveConfig = Record<string, unknown>;

export type InterleavedItem = {
  itemId: string;
  // Key of the ranker that drafted the item
  variation: string;
  position: number;
  // False for ties and leftovers; analysis only counts competitive items
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

export type InterleaveOptions<T> = {
  // The interleaving experiment's key
  ranker: string;
  getList: (config: InterleaveConfig) => T[] | Promise<T[]>;
  // Used when the interleaving isn't in the payload
  fallbackConfig: InterleaveConfig;
  // Seeds the draft; reuse it to replay the same list. Defaults to a uuid
  rankingSeed?: string;
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
  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    // Re-run by each UserScopedGrowthBook a multi-user client creates
    if ("createScopedInstance" in gb) return;
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

function getAttributes(gb: InterleaveInstance): Attributes {
  if (!("getUserContext" in gb)) return gb.getAttributes();
  const user = gb.getUserContext();
  return { ...user.attributes, ...user.attributeOverrides };
}

export function teamDraft<T>(
  lists: { variation: string; items: T[] }[],
  getItemId: (item: T) => string,
  rng: (round: number, ranker: number) => number,
  maxItems?: number,
): { items: T[]; meta: InterleavedItem[] } {
  const items: T[] = [];
  const meta: InterleavedItem[] = [];
  const taken = new Set<string>();
  const cursors = lists.map(() => 0);

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

  for (let round = 0; ; round++) {
    const order = lists
      .map((_, i) => i)
      .sort((a, b) => rng(round, a) - rng(round, b));
    const wanted = order.map((ranker) => ({ ranker, item: next(ranker) }));
    const present = wanted.filter((w) => w.item !== null);
    if (!present.length) break;

    const ids = present.map((w) => getItemId(w.item as T));
    const tie =
      present.length === lists.length && ids.every((id) => id === ids[0]);
    const picks = tie ? 1 : present.length;
    if (maxItems !== undefined && items.length + picks > maxItems) break;

    if (tie) {
      place(present[0].item as T, present[0].ranker, false);
      continue;
    }

    const competitive = present.length === lists.length;
    for (const { ranker } of wanted) {
      // With 3+ rankers (not currently supported) an earlier pick this round may have taken this ranker's item
      const item = next(ranker);
      if (item !== null) place(item, ranker, competitive);
    }
  }

  return { items, meta };
}

export async function interleave<T>(
  gb: InterleaveInstance,
  options: InterleaveOptions<T>,
): Promise<InterleaveResult<T>> {
  const { ranker, getList, fallbackConfig, maxItems } = options;
  const getItemId = options.getItemId || defaultItemId;
  const rankingId =
    options.rankingSeed ||
    genUUID(typeof crypto !== "undefined" ? crypto : undefined);

  const payload = gb.getDecryptedPayload();
  const definition = payload.interleavings?.[ranker];
  const variations = definition?.variations || [];

  const notInterleaved = async (
    variation?: string,
  ): Promise<InterleaveResult<T>> => {
    const match = variations.find((v) => v.key === variation);
    return {
      result: await getList(match ? match.config : fallbackConfig),
      inExperiment: false,
      variation: match?.key,
      rankingId,
      trackingProps: {},
    };
  };

  if (!definition || variations.length !== 2) return notInterleaved();

  const featureId = "$interleave:" + ranker;
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

  const rule = payload.features?.[featureId]?.rules?.[0];
  const hashAttribute = rule?.hashAttribute || "id";
  const hashValue = getAttributes(gb)[hashAttribute];
  if (!hashValue) {
    return notInterleaved(variations[0].key);
  }

  const lists = await Promise.all(
    variations.map(async (v) => ({
      variation: v.key,
      items: await getList(v.config),
    })),
  );
  if (lists.some((l) => l.items.some((item) => !getItemId(item)))) {
    console.error(
      `interleave: every item in "${ranker}" needs an id, pass getItemId`,
    );
    return {
      result: lists[0].items,
      inExperiment: false,
      variation: lists[0].variation,
      rankingId,
      trackingProps: {},
    };
  }

  const seed = rule?.seed || ranker;
  const { items, meta } = teamDraft(
    lists,
    getItemId,
    (round, index) => hash(seed, rankingId + ":" + round + ":" + index, 2) || 0,
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
  gb.logEvent(EVENT_INTERLEAVE_EXPOSURE, { ...exposure });

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
