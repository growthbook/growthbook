import MiniSearch from "minisearch";
import { fuzzyMatch } from "@nozbe/microfuzz";

/**
 * Splits text on non-alphanumeric boundaries AND camelCase/PascalCase boundaries so
 * that identifiers like "myFeatureFlag" or "my-feature-flag" are indexed and searched
 * as individual tokens: ["my", "feature", "flag"].
 */
export function tokenize(str: string): string[] {
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
  const searchText = tokenize(name).join(" ");
  const result = fuzzyMatch(searchText, query);
  return result ? result.score : null;
}

export interface SearchableItem {
  id: string;
  name: string;
  description: string;
  tags: string;
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
  const raw = index.search(query);
  const matchedIds = new Set(raw.map((r) => r.id));
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const results: T[] = raw
    .map((r) => itemMap.get(r.id))
    .filter((item) => item !== undefined);

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
}

/**
 * Builds a MiniSearch index with the CommandPalette configuration.
 */
export function buildCommandPaletteIndex<T extends SearchableItem>(
  items: T[],
): MiniSearch<T> {
  const ms = new MiniSearch<T>({
    fields: ["name", "description", "tags"],
    storeFields: ["name"],
    tokenize,
    searchOptions: {
      boost: { name: 3, description: 1 },
      // Scale allowed edits with term length
      fuzzy: (term) => {
        if (term.length <= 2) return 0;
        if (term.length <= 4) return 1;
        return 2;
      },
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
