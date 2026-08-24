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
 * Every skill the agent can load, in the order the server lists them. Feeds the
 * composer's `/` menu and resolves a `/flag-create` token hovered in an older
 * message.
 *
 * Every skill, not one entry per directory: `/flag-create` is the thing a
 * person means, and listing only `/feature-flags` made them describe the job in
 * prose so the agent could route to the skill they could have picked. The
 * server orders them by directory, so related skills still sit together.
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
