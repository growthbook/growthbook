import MiniSearch from "minisearch";
import { fuzzyMatch } from "@nozbe/microfuzz";

/**
 * Splits text on non-alphanumeric boundaries AND camelCase/PascalCase boundaries so
 * that identifiers like "myFeatureFlag" or "my-feature-flag" are indexed and searched
 * as individual tokens: ["my", "feature", "flag"].
 */
export function tokenize(str: string): string[] {
  if (!str) return [];
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Runs microfuzz on the tokenized+joined form of an item name.
 * Returns a numeric score (lower = better match) or null if no match.
 *
 * Tokenizing before matching ensures word-boundary bonuses apply to
 * camelCase/kebab/snake separators, e.g. "abc" scoring well against
 * "alpha bravo charlie" (from "alpha_bravo_charlie").
 */
export function fuzzyMatchName(query: string, name: string): number | null {
  try {
    const searchText = tokenize(name).join(" ");
    const result = fuzzyMatch(searchText, query);
    return result ? result.score : null;
  } catch (e) {
    console.error("CommandPalette: error in fuzzyMatchName", e);
    return null;
  }
}

export interface SearchableItem {
  id: string;
  name: string;
  description: string;
  tags: string;
}

/** Palette row types that use strict MiniSearch only (no typo fuzzy, no microfuzz). */
const STRICT_COMMAND_PALETTE_TYPES = new Set([
  "navigation",
  "documentation",
  "apiReference",
]);

export function isStrictCommandPaletteSearchType(type: string): boolean {
  return STRICT_COMMAND_PALETTE_TYPES.has(type);
}

export function partitionItemsForCommandPaletteSearch<
  T extends SearchableItem & { type: string },
>(items: T[]): { strictItems: T[]; fuzzyItems: T[] } {
  const strictItems: T[] = [];
  const fuzzyItems: T[] = [];
  for (const item of items) {
    if (isStrictCommandPaletteSearchType(item.type)) {
      strictItems.push(item);
    } else {
      fuzzyItems.push(item);
    }
  }
  return { strictItems, fuzzyItems };
}

/**
 * MiniSearch matches only, in score order — no microfuzz tier.
 */
export function miniSearchOrderedResults<T extends SearchableItem>(
  index: MiniSearch<T>,
  items: T[],
  query: string,
): T[] {
  try {
    const raw = index.search(query);
    const itemMap = new Map(items.map((i) => [i.id, i]));
    return raw
      .map((r) => itemMap.get(r.id))
      .filter((item): item is T => item !== undefined);
  } catch (e) {
    console.error("CommandPalette: error in miniSearchOrderedResults", e);
    return [];
  }
}

/**
 * Two-tier search: MiniSearch (prefix + fuzzy per token) followed by a
 * microfuzz fallback for cross-token subsequence abbreviations like
 * "albrcha" → "alpha_bravo_charlie".
 *
 * Returns items in priority order: MiniSearch matches first (exact/prefix/typo),
 * then microfuzz matches sorted ascending by score (lower = better).
 */
export function combinedSearch<T extends SearchableItem>(
  index: MiniSearch<T>,
  items: T[],
  query: string,
): T[] {
  try {
    const results = miniSearchOrderedResults(index, items, query);
    const matchedIds = new Set(results.map((r) => r.id));

    items
      .filter((item) => !matchedIds.has(item.id))
      .map((item) => {
        const score = fuzzyMatchName(query, item.name);
        return score !== null ? { item, score } : null;
      })
      .filter((m) => m !== null)
      .sort((a, b) => a.score - b.score)
      .forEach(({ item }) => results.push(item));

    return results;
  } catch (e) {
    console.error("CommandPalette: error in combinedSearch", e);
    return [];
  }
}

/**
 * Command palette search: strict-type rows (pages, docs, REST API) use MiniSearch
 * with fuzzy disabled and no microfuzz; entity rows keep combinedSearch.
 * Merge order: all strict matches first (MiniSearch order), then all fuzzy matches.
 */
export function searchCommandPalette<
  T extends SearchableItem & { type: string },
>(
  strictIndex: MiniSearch<T>,
  strictItems: T[],
  fuzzyIndex: MiniSearch<T>,
  fuzzyItems: T[],
  query: string,
): T[] {
  const q = query.trim();
  const strictOrdered = miniSearchOrderedResults(strictIndex, strictItems, q);
  const fuzzyOrdered = combinedSearch(fuzzyIndex, fuzzyItems, q);
  return [...strictOrdered, ...fuzzyOrdered];
}

export type BuildCommandPaletteIndexOptions = {
  /** When false, MiniSearch typo tolerance is off (strict token/prefix matching only). */
  fuzzy?: boolean;
};

/**
 * Builds a MiniSearch index with the CommandPalette configuration.
 */
export function buildCommandPaletteIndex<T extends SearchableItem>(
  items: T[],
  options?: BuildCommandPaletteIndexOptions,
): MiniSearch<T> {
  const fuzzySearch =
    options?.fuzzy === false
      ? 0
      : (term: string) => {
          if (term.length <= 2) return 0;
          if (term.length <= 4) return 1;
          return 2;
        };

  const ms = new MiniSearch<T>({
    fields: ["name", "description", "tags"],
    storeFields: ["name"],
    tokenize,
    searchOptions: {
      boost: { name: 3, description: 1 },
      fuzzy: fuzzySearch,
      prefix: true,
      tokenize,
    },
  });
  try {
    ms.addAll(items);
  } catch (e) {
    console.error("CommandPalette: error building search index", e);
  }
  return ms;
}
