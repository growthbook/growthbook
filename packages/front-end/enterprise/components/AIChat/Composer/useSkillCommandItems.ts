import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import { skillDisplayName, type SkillItem } from "./extensions/skillCommand";

/**
 * The one skill group the Product Analytics chat can load, mirroring
 * `PRODUCT_ANALYTICS_CHAT_SKILL_GROUP` on the back end. Kept in step with it:
 * a menu wider than the agent's resolver just offers dead ends.
 */
export const PRODUCT_ANALYTICS_CHAT_SKILL_GROUP = "dashboards";

/**
 * Every skill the agent can load, in the order the server lists them.
 *
 * This is the lookup catalogue, not the `/` menu — hovering a `/flag-create`
 * token in an older message has to resolve its description even where the menu
 * is narrower than the catalogue. Use `useSkillMenuItems` for the menu.
 *
 * `group` restricts the set to one directory, for a chat whose agent is itself
 * scoped that way — offering a skill the agent cannot load would just produce a
 * dead end. Omit it for the site-wide agent, which can load anything.
 */
export function useSkillCommandItems(group?: string): SkillItem[] {
  const { data } = useApi<{ skills: SkillSummary[] }>("/agent/skills");

  return useMemo(() => {
    const all = data?.skills ?? [];
    const skills = group ? all.filter((s) => s.group === group) : all;

    return skills.map(
      (s): SkillItem => ({
        id: s.name,
        label: s.name,
        title: skillDisplayName(s.name),
        description: s.description,
        ...(s.group !== undefined ? { group: s.group } : {}),
      }),
    );
  }, [data?.skills, group]);
}

/**
 * Skills offered in the composer's `/` menu.
 *
 * Every skill, not one entry per directory: `/flag-create` is the thing a
 * person means, and listing only `/feature-flags` made them describe the job in
 * prose so the agent could route to the skill they could have picked. The
 * server orders them by directory, so related skills still sit together.
 *
 * Currently identical to the catalogue. It stays a separate function because
 * the two answer different questions — what a menu should offer here, and what
 * any token in the transcript can resolve to — and they have diverged before.
 */
export function useSkillMenuItems(group?: string): SkillItem[] {
  return useSkillCommandItems(group);
}
