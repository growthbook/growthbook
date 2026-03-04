import { ExpandedMember } from "shared/types/organization";

const userIdPattern = /^u_[a-z0-9]+$/i;

export function isLikelyUserId(value: string): boolean {
  return userIdPattern.test(value);
}

export function getOwnerDisplay({
  owner,
  users,
}: {
  owner: string;
  users: Map<string, ExpandedMember>;
}): string {
  const value = owner.trim();
  if (!value) return "";

  const user = users.get(value);
  if (user) {
    return user.name || user.email || "Unknown User";
  }

  if (isLikelyUserId(value)) {
    return "Unknown User";
  }

  return value;
}
