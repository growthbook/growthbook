import { ApiKeyInterface } from "shared/types/apikey";
import { ApiApiKey } from "shared/validators";
import { ReqContext } from "back-end/types/request";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// Never includes the key's value or encryption key, so it's safe on a doc read
// without sanitization.
export function toApiKey(key: ApiKeyInterface, userEmail?: string): ApiApiKey {
  // An unscoped token inherits its owner's permissions, so it lists no role.
  const hasRole = !!key.role && (!key.userId || !!key.scoped);
  return {
    id: key.id ?? "",
    type: key.userId ? "personal" : "organization",
    description: key.description ?? "",
    ...(key.userId && {
      userId: key.userId,
      ...(userEmail && { userEmail }),
      scoped: !!key.scoped,
    }),
    ...(hasRole && { role: key.role }),
    limitAccessByEnvironment: key.limitAccessByEnvironment,
    environments: key.environments,
    // Always listed with a role, so the GET can be sent back to the roles PUT
    ...(hasRole && {
      additionalRoles: key.additionalRoles ?? [],
      projectRoles: (key.projectRoles ?? []).map(
        ({
          project,
          role,
          limitAccessByEnvironment,
          environments,
          additionalRoles,
        }) => ({
          project,
          role,
          limitAccessByEnvironment,
          environments,
          ...(additionalRoles && { additionalRoles }),
        }),
      ),
    }),
    ...(!key.userId && { actAs: key.actAs ?? "system" }),
    disabled: !!key.disabled,
    ...(key.disabledBy && { disabledBy: key.disabledBy }),
    dateCreated: key.dateCreated.toISOString(),
    dateUpdated: key.dateUpdated.toISOString(),
    lastUsed: iso(key.lastUsed),
    expiresAt: iso(key.expiresAt),
  };
}

// A token's owner email is only shown while they're still a member.
export function toApiKeys(
  keys: ApiKeyInterface[],
  memberIds: Set<string>,
  emails: Map<string, string>,
): ApiApiKey[] {
  return keys.map((key) =>
    toApiKey(
      key,
      key.userId && memberIds.has(key.userId)
        ? emails.get(key.userId)
        : undefined,
    ),
  );
}

export async function loadApiKeys(
  context: ReqContext,
  keys: ApiKeyInterface[],
): Promise<ApiApiKey[]> {
  const memberIds = new Set(context.org.members.map((m) => m.id));
  const ownerIds = [
    ...new Set(keys.flatMap((k) => (k.userId ? [k.userId] : []))),
  ].filter((id) => memberIds.has(id));
  const emails = new Map(
    ownerIds.length
      ? (await context.getUsersByIds(ownerIds)).map((u) => [u.id, u.email])
      : [],
  );
  return toApiKeys(keys, memberIds, emails);
}
