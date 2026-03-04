import { ExpandedMember } from "shared/types/organization";

function isLikelyUserId(value: string): boolean {
  return value.startsWith("u_");
}

export function getOwnerDisplay({
  owner,
  users,
}: {
  owner: string | undefined;
  users: Map<string, ExpandedMember>;
}): string {
  const value = owner?.trim();
  if (!value) return "None";

  const user = users.get(value);
  if (user) {
    return user.name || user.email || "Unknown User";
  }

  if (isLikelyUserId(value)) {
    return "Unknown User";
  }

  return value;
}
