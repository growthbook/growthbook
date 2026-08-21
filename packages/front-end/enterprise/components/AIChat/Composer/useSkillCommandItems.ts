import { useMemo } from "react";
import type { SkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import { skillDisplayName, type SkillItem } from "./extensions/skillCommand";

/**
 * The one skill domain the Product Analytics chat can load, mirroring
 * `PRODUCT_ANALYTICS_CHAT_SKILL_DOMAIN` on the back end. Kept in step with it:
 * a menu wider than the agent's resolver just offers dead ends.
 */
export const PRODUCT_ANALYTICS_CHAT_SKILL_DOMAIN = "dashboards";

/**
 * Every skill the agent can load, domain routers and leaves alike.
 *
 * This is the lookup catalogue, not the `/` menu — hovering a `/flag-create`
 * token in an older message resolves its description through here, so leaves
 * have to stay in it even though the menu no longer offers them. Use
 * `useSkillMenuItems` for the menu.
 *
 * `domain` restricts the set to one domain router and its leaves, for a chat
 * whose agent is itself scoped that way — offering a skill the agent cannot
 * load would just produce a dead end. Omit it for the site-wide agent, which
 * can load anything.
 */
export function useSkillCommandItems(domain?: string): SkillItem[] {
  const { data } = useApi<{ skills: SkillSummary[] }>("/agent/skills");

  return useMemo(() => {
    const all = data?.skills ?? [];
    const skills = domain
      ? all.filter((s) => s.name === domain || s.group === domain)
      : all;
    const domains = skills.filter((s) => s.kind === "domain");
    const leaves = skills.filter((s) => s.kind === "leaf");

    const ordered: SkillSummary[] = [];
    for (const router of domains) {
      ordered.push(router);
      ordered.push(...leaves.filter((l) => l.group === router.name));
    }
    ordered.push(...leaves.filter((l) => !ordered.includes(l)));

    return ordered.map(
      (s): SkillItem => ({
        id: s.name,
        label: s.name,
        title: skillDisplayName(s.name),
        description: s.description,
        kind: s.kind,
        ...(s.group !== undefined ? { group: s.group } : {}),
      }),
    );
  }, [data?.skills, domain]);
}

/**
 * Skills offered in the composer's `/` menu: domain routers only.
 *
 * Leaves are deliberately left out. A router's body carries the sub-skill table
 * and the agent is instructed to follow it — "if one is a domain router, still
 * loadSkill the leaf it points you to" — so picking `/feature-flags` and
 * describing the job still lands on the right leaf. Listing all 29 skills made
 * the menu a wall of near-duplicates to save one `loadSkill` call.
 */
export function useSkillMenuItems(domain?: string): SkillItem[] {
  const items = useSkillCommandItems(domain);
  return useMemo(() => items.filter((s) => s.kind === "domain"), [items]);
}
