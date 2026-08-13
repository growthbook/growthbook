import {
  InterleaveExposureData,
  InterleaveExposureRow,
  InterleavedItemMeta,
} from "./types/growthbook";

export interface RealizedInterleaveList<T> {
  name: string;
  items: T[];
}

export interface TeamDraftResult<T> {
  items: T[];
  meta: InterleavedItemMeta[];
}

// Team-draft interleaving. Each list is a "captain" with a ranked preference
// order. Per round, captains draft in an order decided by rng(round, captain);
// each takes its most-preferred item not already drafted. A round is marked
// non-competitive when captains desire the same item or a captain's list is
// exhausted; competitive picks always come in groups with one pick per captain.
export function itemDraft<T>(
  lists: RealizedInterleaveList<T>[],
  getItemId: (item: T) => string,
  rng: (round: number, captain: number) => number,
  maxItems?: number,
): TeamDraftResult<T> {
  const items: T[] = [];
  const meta: InterleavedItemMeta[] = [];
  const taken = new Set<string>();
  // Per-captain cursor into their preference list
  const cursors = lists.map(() => 0);

  const nextDesired = (captain: number): T | null => {
    const list = lists[captain].items;
    let c = cursors[captain];
    while (c < list.length && taken.has(getItemId(list[c]))) {
      c++;
    }
    cursors[captain] = c;
    return c < list.length ? list[c] : null;
  };

  let round = 0;

  while (true) {
    if (maxItems !== undefined && items.length + lists.length > maxItems) {
      // Only complete rounds keep competitive picks balanced across captains
      break;
    }

    // Draft order for this round
    const order = lists
      .map((_, i) => i)
      .sort((a, b) => rng(round, a) - rng(round, b));

    // What each captain wants before anyone picks this round
    const desired = order.map((captain) => {
      const item = nextDesired(captain);
      return { captain, item, id: item === null ? null : getItemId(item) };
    });

    if (desired.every((d) => d.item === null)) break;

    // Non-competitive round: a captain ran dry, or two captains want the same item
    const ids = desired.map((d) => d.id).filter((id) => id !== null);
    const competitive =
      desired.every((d) => d.item !== null) && new Set(ids).size === ids.length;

    for (const d of desired) {
      // Re-resolve in draft order: an earlier captain may have taken this pick
      const item = nextDesired(d.captain);
      if (item === null) continue;
      const itemId = getItemId(item);
      taken.add(itemId);
      items.push(item);
      meta.push({
        itemId,
        variation: lists[d.captain].name,
        position: items.length - 1,
        competitive,
      });
    }

    round++;
  }

  return { items, meta };
}

// Convenience projection: one exposure -> flat rows (one per impression x item),
// for pipelines that can't carry nested payloads. The canonical contract is the
// nested impression event.
export function flattenInterleaveExposure(
  data: InterleaveExposureData,
): InterleaveExposureRow[] {
  return data.items.map((item) => ({
    timestamp: data.timestamp,
    user_id: data.hashValue,
    experiment_id: data.experimentId,
    interleave_id: data.interleaveId,
    item_id: item.itemId,
    variation: item.variation,
    position: item.position,
    competitive: item.competitive,
  }));
}
