import { ExpandedMember } from "shared/types/organization";

export function getOwnerDisplay({
  owner,
  users,
}: {
  owner: string | undefined;
  users: Map<string, ExpandedMember>;
}): string {
  const value = owner?.trim();
  if (!value) return "";

  const user = users.get(value);
  if (user) {
    return user.name || user.email || "Unknown User";
  }

  if (value.startsWith("u_")) {
    return "Unknown User";
  }

  return value;
}
