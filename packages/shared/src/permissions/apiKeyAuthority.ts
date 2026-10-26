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

// Who may reveal or rotate a key's secret: the owner for a PAT, key creators for an org key.
export function canManageApiKeySecret(
  permissions: Pick<Permissions, "canCreateApiKey">,
  key: Pick<ApiKeyInterface, "userId">,
  actorId: string,
): boolean {
  return key.userId ? key.userId === actorId : permissions.canCreateApiKey();
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

// A User key must name a member with X-GrowthBook-Requested-By and acts as
// them; a System key keeps its own role and only records who asked.
export function actsAsUser(key: Pick<ApiKeyInterface, "actAs">): boolean {
  return key.actAs === "user";
}

type ApiKeyAuthority = Pick<
  ApiKeyInterface,
  | "role"
  | "limitAccessByEnvironment"
  | "environments"
  | "additionalRoles"
  | "projectRoles"
  | "actAs"
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
    actAs: key.actAs ?? "system",
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
