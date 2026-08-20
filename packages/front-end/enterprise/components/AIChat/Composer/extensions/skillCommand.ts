import Mention from "@tiptap/extension-mention";
import type { SkillKind } from "shared/ai-chat";

export const SKILL_COMMAND_NAME = "skillCommand";

export interface SkillItem {
  id: string;
  label: string;
  description: string;
  kind: SkillKind;
  /** Parent domain for leaf skills; same as `id` for domain routers. */
  group?: string;
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

/** Name matches first, then description. With no query, domains before leaves. */
export function filterSkillItems(
  items: SkillItem[],
  query: string,
  limit = 20,
): SkillItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [
      ...items.filter((i) => i.kind === "domain"),
      ...items.filter((i) => i.kind !== "domain"),
    ].slice(0, limit);
  }

  const nameMatch: SkillItem[] = [];
  const descriptionMatch: SkillItem[] = [];
  for (const item of items) {
    if (item.id.toLowerCase().includes(q)) nameMatch.push(item);
    else if (item.description.toLowerCase().includes(q)) {
      descriptionMatch.push(item);
    }
  }
  return [...nameMatch, ...descriptionMatch].slice(0, limit);
}
