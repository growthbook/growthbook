import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import { skillDisplayName, type SkillItem } from "./extensions/skillCommand";

/**
 * Workflows are named `<domain>/references/<workflow>` so the agent can load
 * them by an unambiguous id. The token and the menu show just the last segment;
 * the qualified name stays on `id`, which is what the composer sends back.
 */
function toLabel(name: string): string {
  return name.split("/").pop() || name;
}

/** The lookup catalogue, routers included — an old `/feature-flags` token must resolve. */
export function useSkillCommandItems(): SkillItem[] {
  const { data } = useApi<{ skills: SkillSummary[] }>("/agent/skills");

  return useMemo(() => {
    const skills = data?.skills ?? [];

    return skills.map((s): SkillItem => {
      const label = toLabel(s.name);
      return {
        id: s.name,
        label,
        title: skillDisplayName(label),
        description: s.description,
        kind: s.kind,
        ...(s.group !== undefined ? { group: s.group } : {}),
      };
    });
  }, [data?.skills]);
}

/** The `/` menu: leaves only, since a router is two entries for one job. */
export function useSkillMenuItems(): SkillItem[] {
  const items = useSkillCommandItems();
  return useMemo(() => items.filter((i) => i.kind !== "domain"), [items]);
}
