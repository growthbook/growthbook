import Mention from "@tiptap/extension-mention";

export const SKILL_COMMAND_NAME = "skillCommand";

export interface SkillItem {
  id: string;
  /**
   * The token text, which must stay the skill's identifier: `renderText`
   * prefixes it with `/` to produce `/flag-create` in the sent message, and the
   * chat log restyles a command by looking for exactly that string. Use `title`
   * for anything a person reads.
   */
  label: string;
  /** Display name for the `/` menu, derived from `id` by `skillDisplayName`. */
  title: string;
  description: string;
  /** The directory the skill is filed under, for grouping. Absent for a top-level skill. */
  group?: string;
}

/**
 * Words a mechanical capitalization would get wrong. Only proper nouns the copy
 * guide pins a spelling for — "GrowthBook" is never "Growthbook".
 */
const SKILL_WORD_CASING: Record<string, string> = {
  growthbook: "GrowthBook",
};

/**
 * Menu label for a skill: its identifier with the hyphens opened up and the
 * first letter capitalized, so `flag-default-value` reads "Flag default value".
 * Sentence case per the repo copy guide — these are list labels, not headings.
 *
 * Derived rather than authored so a new skill needs no extra frontmatter to
 * show up readably; the trade-off is that the label tracks the identifier, so
 * an id that reads badly gives a label that reads badly.
 */
export function skillDisplayName(id: string): string {
  const words = id
    .split("-")
    .filter(Boolean)
    .map((w) => SKILL_WORD_CASING[w.toLowerCase()] ?? w);
  if (!words.length) return "";
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** Slash commands, built on Mention with a `/` trigger. */
export const SkillCommand = Mention.extend<
  Parameters<typeof Mention.configure>[0],
  { items: SkillItem[] }
>({
  name: SKILL_COMMAND_NAME,

  addStorage() {
    return { items: [] };
  },
});

/**
 * Title/id matches first, then description.
 *
 * An empty query keeps the server's order, which files each skill under its
 * directory. The limit is generous because that browse case is the whole menu
 * and the popup scrolls — truncating it would hide a directory entirely.
 */
export function filterSkillItems(
  items: SkillItem[],
  query: string,
  limit = 50,
): SkillItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return items.slice(0, limit);
  }

  const nameMatch: SkillItem[] = [];
  const descriptionMatch: SkillItem[] = [];
  for (const item of items) {
    // Match the title too: people search the words they can see ("/create
    // dashboard"), not the kebab-case id they can't.
    if (
      item.id.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q)
    ) {
      nameMatch.push(item);
    } else if (item.description.toLowerCase().includes(q)) {
      descriptionMatch.push(item);
    }
  }
  return [...nameMatch, ...descriptionMatch].slice(0, limit);
}
