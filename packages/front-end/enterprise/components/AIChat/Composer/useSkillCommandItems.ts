import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import type { SkillItem } from "./extensions/skillCommand";

/**
 * Workflows are named `<domain>/references/<workflow>` so the agent can load
 * them by an unambiguous id. The menu shows just the last segment; the
 * qualified name stays on `id`, which is what the composer sends back.
 */
function toLabel(name: string): string {
  return name.split("/").pop() || name;
}

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
        label: toLabel(s.name),
        description: s.description,
        kind: s.kind,
        ...(s.group !== undefined ? { group: s.group } : {}),
      }),
    );
  }, [data?.skills]);
}
