import Mention from "@tiptap/extension-mention";

export const SKILL_COMMAND_NAME = "skillCommand";

/** One selectable row in the `/` command menu. */
export interface SkillItem {
  /** The skill's name, which is also what the agent resolves it by. */
  id: string;
  label: string;
  description: string;
  /** Parent domain for leaf skills; equals `id` for domain routers. */
  group?: string;
}

/**
 * `/` commands for agent skills.
 *
 * Built on the Mention node because a slash command is the same interaction —
 * a trigger character, a filtered menu, and an atomic token — just with a
 * different trigger and a different payload.
 */
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
 * Matches on name first, then description, so typing "targeting" surfaces
 * `flag-targeting` above skills that merely mention targeting. Domain routers
 * outrank their leaves on an equal match, since they're the broader entry point.
 */
export function filterSkillItems(
  items: SkillItem[],
  query: string,
  limit = 8,
): SkillItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);

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
