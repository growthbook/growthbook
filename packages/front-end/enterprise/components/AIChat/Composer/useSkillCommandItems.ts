import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import type { SkillItem } from "./extensions/skillCommand";

export function useSkillCommandItems(): SkillItem[] {
  const { data } = useApi<{ skills: SkillSummary[] }>("/agent/skills");

  return useMemo(() => {
    const skills = data?.skills ?? [];
    const domains = skills.filter((s) => s.kind === "domain");
    const leaves = skills.filter((s) => s.kind === "leaf");

    const ordered: SkillSummary[] = [];
    for (const domain of domains) {
      ordered.push(domain);
      ordered.push(...leaves.filter((l) => l.group === domain.name));
    }
    ordered.push(...leaves.filter((l) => !ordered.includes(l)));

    return ordered.map(
      (s): SkillItem => ({
        id: s.name,
        label: s.name,
        description: s.description,
        kind: s.kind,
        ...(s.group !== undefined ? { group: s.group } : {}),
      }),
    );
  }, [data?.skills]);
}
