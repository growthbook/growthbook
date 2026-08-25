import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import { skillDisplayName, type SkillItem } from "./extensions/skillCommand";

/** The lookup catalogue, routers included — an old `/feature-flags` token must resolve. */
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

/** The `/` menu: leaves only, since a router is two entries for one job. */
export function useSkillMenuItems(group?: string): SkillItem[] {
  const items = useSkillCommandItems(group);
  return useMemo(() => items.filter((i) => i.kind !== "domain"), [items]);
}
