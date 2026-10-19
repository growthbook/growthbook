import { isEqual } from "lodash";
import { ApiKeyInterface } from "shared/types/apikey";
import type { Permissions } from "./permissionsClass";

// Whether toggling a PAT's `disabled` needs permission over members' tokens rather than the owner's own rights.
export function apiKeyToggleRequiresAdmin(
  key: Pick<ApiKeyInterface, "userId" | "disabled" | "disabledBy">,
  actorId: string,
): boolean {
  if (!key.userId) return false;
  // Another member's PAT, or one an admin disabled: the owner can't take over `disabledBy`.
  return (
    key.userId !== actorId ||
    (!!key.disabled && !!key.disabledBy && key.disabledBy !== actorId)
  );
}

// Who may set a secret key's `disabled`. Mirrors ApiKeyModel.canUpdate, so the UI
// and server agree. On an org key, disabling only takes access away, so it needs
// delete; enabling restores it, so it needs edit.
export function canSetApiKeyDisabled(
  permissions: Pick<
    Permissions,
    "canDeleteApiKey" | "canUpdateApiKey" | "canManagePersonalAccessTokens"
  >,
  key: Pick<ApiKeyInterface, "userId" | "disabled" | "disabledBy">,
  actorId: string,
  disabled: boolean,
): boolean {
  if (key.userId) {
    return (
      !apiKeyToggleRequiresAdmin(key, actorId) ||
      permissions.canManagePersonalAccessTokens()
    );
  }
  return disabled
    ? permissions.canDeleteApiKey()
    : permissions.canUpdateApiKey();
}

export function canApplyExpirationPolicy(
  permissions: Pick<
    Permissions,
    "canDeleteApiKey" | "canManagePersonalAccessTokens"
  >,
  kind: "pat" | "secret",
): boolean {
  return kind === "pat"
    ? permissions.canManagePersonalAccessTokens()
    : permissions.canDeleteApiKey();
}

export function requesterHeaderPolicy(
  key: Pick<ApiKeyInterface, "requesterHeader">,
): NonNullable<ApiKeyInterface["requesterHeader"]> {
  return key.requesterHeader ?? "optional";
}

export function assumesRequesterRole(
  key: Pick<ApiKeyInterface, "requesterPermissions">,
): boolean {
  return (key.requesterPermissions ?? "assume") === "assume";
}

type ApiKeyAuthority = Pick<
  ApiKeyInterface,
  | "role"
  | "limitAccessByEnvironment"
  | "environments"
  | "additionalRoles"
  | "projectRoles"
  | "requesterHeader"
  | "requesterPermissions"
  | "confirmRules"
>;

// What an org key can do, in a form where an edit that leaves it alone compares equal.
function authorityOf(key: ApiKeyAuthority) {
  return {
    role: key.role ?? null,
    environments: key.limitAccessByEnvironment
      ? [...(key.environments ?? [])].sort()
      : null,
    additionalRoles: key.additionalRoles ?? [],
    projectRoles: key.projectRoles ?? [],
    requesterHeader: requesterHeaderPolicy(key),
    assumesRequesterRole: assumesRequesterRole(key),
    confirmRules: key.confirmRules ?? null,
  };
}

// Whether an edit changes what an org key can do. Doing so can hand a key more
// than it had, so it takes permission to create keys, not just to edit them.
export function changesApiKeyAuthority(
  before: ApiKeyAuthority,
  after: ApiKeyAuthority,
): boolean {
  return !isEqual(authorityOf(before), authorityOf(after));
}

type AuditedKey = { userId?: unknown; scoped?: unknown; role?: unknown };

// Whether an apiKey audit is about a personal access token. Newer audits record
// the owner as `userId`; older ones `scoped`, or role `user`, which only a token
// has unless the org made a custom role by that name. Only the key's own fields
// count, never roles nested in its project or additional roles.
export function auditDescribesPersonalAccessToken(
  details: string,
  userIsCustomRole: boolean,
): boolean {
  let parsed: { pre?: AuditedKey; post?: AuditedKey };
  try {
    parsed = JSON.parse(details);
  } catch {
    return false;
  }
  const isToken = (key: AuditedKey | undefined) =>
    !!key &&
    (!!key.userId ||
      key.scoped === true ||
      (!userIsCustomRole && key.role === "user"));
  return isToken(parsed?.pre) || isToken(parsed?.post);
}
