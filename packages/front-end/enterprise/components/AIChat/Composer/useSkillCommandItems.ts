import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import { skillDisplayName, type SkillItem } from "./extensions/skillCommand";

/**
 * Every skill the agent can load, routers included.
 *
 * This is the lookup catalogue, not the `/` menu: hovering a `/feature-flags`
 * token in an older message has to resolve its description even though the menu
 * never offered it. Use `useSkillMenuItems` for the menu.
 *
 * `group` restricts the set to one domain, for a chat whose agent is itself
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
        kind: s.kind,
        ...(s.group !== undefined ? { group: s.group } : {}),
      }),
    );
  }, [data?.skills, group]);
}

/**
 * Skills offered in the composer's `/` menu: leaves only.
 *
 * A domain router documents no workflow of its own — it exists so the agent can
 * find the leaf. Listing it beside its own children just gives the user two
 * entries for one job and a `/feature-flags` token that does nothing on its own.
 */
export function useSkillMenuItems(group?: string): SkillItem[] {
  const items = useSkillCommandItems(group);
  return useMemo(() => items.filter((i) => i.kind !== "domain"), [items]);
}
