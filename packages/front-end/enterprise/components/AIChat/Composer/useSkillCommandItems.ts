import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import { skillDisplayName, type SkillItem } from "./extensions/skillCommand";

/**
 * Every skill the agent can load, routers included — the lookup catalogue, not
 * the `/` menu: a `/feature-flags` token in an older message still has to
 * resolve. `group` scopes it to one domain, for a chat whose agent is scoped
 * that way. See `useSkillMenuItems` for the menu.
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
 * Skills offered in the `/` menu: leaves only. A router documents no workflow of
 * its own, so listing it beside its children is two entries for one job.
 */
export function useSkillMenuItems(group?: string): SkillItem[] {
  const items = useSkillCommandItems(group);
  return useMemo(() => items.filter((i) => i.kind !== "domain"), [items]);
}
