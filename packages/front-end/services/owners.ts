import { ExpandedMember } from "shared/types/organization";

const userIdPattern = /^u_[a-z0-9]+$/i;

export function isLikelyUserId(value: string): boolean {
  return userIdPattern.test(value);
}

export function normalizeOwnerForInternalApi({
  owner,
  users,
  fallbackUserId = "",
}: {
  owner: string;
  users: Map<string, ExpandedMember>;
  fallbackUserId?: string;
}): string {
  const value = owner.trim();
  if (!value) return "";

  if (users.has(value)) {
    return value;
  }

  const matchingUser = Array.from(users.values()).find(
    (user) => user.name === value || user.email === value,
  );
  if (matchingUser) {
    return matchingUser.id;
  }

  if (isLikelyUserId(value)) {
    return value;
  }

  return fallbackUserId;
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
