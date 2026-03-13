import {
  ExpandedMember,
  UserNameDisplayFormat,
} from "shared/types/organization";

export function getDisplayNameForUser(
  user: ExpandedMember | undefined,
  format: UserNameDisplayFormat = "fullName",
): string {
  if (!user) return "";

  const fullName = user.name?.trim() || "";
  if (!fullName) {
    return user.email || "Unknown User";
  }

  if (format === "givenName" && !fullName.includes("@")) {
    const [givenName] = fullName.split(/\s+/);
    return givenName || fullName;
  }

  return fullName;
}

export function getOwnerDisplay({
  owner,
  users,
  format = "fullName",
}: {
  owner: string | undefined;
  users: Map<string, ExpandedMember>;
  format?: UserNameDisplayFormat;
}): string {
  const value = owner?.trim();
  if (!value) return "";

  const user = users.get(value);
  if (user) {
    return getDisplayNameForUser(user, format);
  }

  if (value.startsWith("u_")) {
    return "Unknown User";
  }

  return value;
}
