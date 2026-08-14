import { useMemo } from "react";
import useApi from "@/hooks/useApi";
import type { SkillItem } from "./extensions/skillCommand";

interface SkillSummary {
  name: string;
  description: string;
  kind: "domain" | "leaf";
  group?: string;
}

/**
 * Skills offered by the composer's `/` menu.
 *
 * The list is static per deploy — it describes the product, not the org's data
 * — so SWR's default caching is all the freshness it needs.
 *
 * Ordered so each domain router is followed by its own leaves, which is how the
 * menu reads best: the broad entry point first, then the specific workflows
 * under it.
 */
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
    // Any leaf whose group didn't match a domain still belongs in the menu.
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
