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

// Team-draft interleaving (Airbnb tie rule). Each list is a "captain" with a
// ranked preference order; "top" is a captain's most-preferred item not yet
// placed.
//
// - While every captain's top is the same item, that item is placed ONCE,
//   marked non-competitive, and removed from all lists without consuming a
//   pick. Agreements carry no signal, and placing them this way keeps the
//   captains' lists in sync (no fallback picks, so later agreed-upon items
//   are never mislabeled competitive).
// - Otherwise a competitive round runs: draft order comes from
//   rng(step, captain), each captain places its top, and every pick is
//   credited to its captain. Competitive picks therefore always arrive in
//   adjacent groups with exactly one pick per captain.
// - A round where some captain's list is exhausted places the remaining
//   captains' tops as non-competitive.
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

  const place = (item: T, captain: number, competitive: boolean) => {
    taken.add(getItemId(item));
    items.push(item);
    meta.push({
      itemId: getItemId(item),
      variation: lists[captain].name,
      position: items.length - 1,
      competitive,
    });
  };

  // One rng step per placement (agreement or competitive round) so draft
  // orders stay distinct and the whole draft replays from the seed
  let step = 0;

  while (true) {
    const order = lists
      .map((_, i) => i)
      .sort((a, b) => rng(step, a) - rng(step, b));
    const desired = order.map((captain) => {
      const item = nextDesired(captain);
      return { captain, item, id: item === null ? null : getItemId(item) };
    });
    if (desired.every((d) => d.item === null)) break;

    const allPresent = desired.every((d) => d.item !== null);
    const agreement =
      allPresent && desired.every((d) => d.id === desired[0].id);

    if (agreement) {
      if (maxItems !== undefined && items.length + 1 > maxItems) break;
      // Shared top: placed once, no team. The label is only for display —
      // analysis excludes non-competitive items
      place(desired[0].item as T, desired[0].captain, false);
      step++;
      continue;
    }

    if (maxItems !== undefined && items.length + lists.length > maxItems) {
      // Only complete rounds keep competitive picks balanced across captains
      break;
    }

    // Competitive unless a captain ran dry. (With two captains, tops that
    // are not an agreement are distinct; a partial agreement among 3+
    // captains is resolved by re-drafting below and marked non-competitive.)
    const ids = desired.map((d) => d.id).filter((id) => id !== null);
    const competitive = allPresent && new Set(ids).size === ids.length;

    for (const d of desired) {
      // Re-resolve in draft order: an earlier captain may have taken this pick
      const item = nextDesired(d.captain);
      if (item === null) continue;
      place(item, d.captain, competitive);
    }
    step++;
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
