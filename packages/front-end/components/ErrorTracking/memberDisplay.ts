import { ExpandedMember } from "shared/types/organization";

export function getMemberDisplayName(
  id: string | null | undefined,
  users: Map<string, ExpandedMember>,
  getUserDisplay?: (id: string, fallback?: boolean) => string,
): string {
  if (!id) return "—";

  const member = users.get(id);
  const name = member?.name?.trim() || getUserDisplay?.(id, false) || "Unknown";
  const email = member?.email?.trim() || "";
  return email ? `${name} (${email})` : name;
}
