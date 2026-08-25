import Mention from "@tiptap/extension-mention";
import type { SkillKind } from "shared/ai-chat";

export const SKILL_COMMAND_NAME = "skillCommand";

export interface SkillItem {
  id: string;
  /** The token text — must stay the identifier; `renderText` sends `/<label>`. */
  label: string;
  /** Display name for the `/` menu. */
  title: string;
  description: string;
  kind: SkillKind;
  /** Parent domain for leaf skills; same as `id` for domain routers. */
  group?: string;
}

/** `flag-default-value` → "Flag default value". Sentence case, per the copy guide. */
export function skillDisplayName(id: string): string {
  const words = id
    .split("-")
    .filter(Boolean)
    // "GrowthBook" is never "Growthbook" — the one spelling the copy guide pins.
    .map((w) => (w.toLowerCase() === "growthbook" ? "GrowthBook" : w));
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

/** Title/id matches first, then description. An empty query keeps server order. */
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
    // People search the words they can see, not the kebab-case id.
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
