import { ApiKeyInterface } from "shared/types/apikey";
import { ApiApiKey } from "shared/validators";
import { getUsersByIds } from "back-end/src/models/UserModel";
import { ReqContext } from "back-end/types/request";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// Never includes the key's value or encryption key, so it's safe on a doc read
// without sanitization.
export function toApiKey(key: ApiKeyInterface, userEmail?: string): ApiApiKey {
  return {
    id: key.id ?? "",
    type: key.userId ? "personal" : "organization",
    description: key.description ?? "",
    ...(key.userId && {
      userId: key.userId,
      ...(userEmail && { userEmail }),
      scoped: !!key.scoped,
    }),
    ...((!key.userId || key.scoped) && key.role && { role: key.role }),
    limitAccessByEnvironment: key.limitAccessByEnvironment,
    environments: key.environments,
    ...(key.additionalRoles && { additionalRoles: key.additionalRoles }),
    ...(key.projectRoles && {
      projectRoles: key.projectRoles.map(
        ({ project, role, limitAccessByEnvironment, environments, ...pr }) => ({
          project,
          role,
          limitAccessByEnvironment,
          environments,
          ...(pr.additionalRoles && { additionalRoles: pr.additionalRoles }),
        }),
      ),
    }),
    ...(!key.userId && { actAs: key.actAs ?? "system" }),
    disabled: !!key.disabled,
    ...(key.disabledBy && { disabledBy: key.disabledBy }),
    ...(key.dateCreated && { dateCreated: key.dateCreated.toISOString() }),
    ...(key.dateUpdated && { dateUpdated: key.dateUpdated.toISOString() }),
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
      ? (await getUsersByIds(ownerIds)).map((u) => [u.id, u.email])
      : [],
  );
  return toApiKeys(keys, memberIds, emails);
}
