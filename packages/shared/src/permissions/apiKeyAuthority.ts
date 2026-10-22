import { isEqual } from "lodash";
import { ApiKeyInterface } from "shared/types/apikey";
import type { Permissions } from "./permissionsClass";
import { DEFAULT_ROLES } from "./permissions.constants";
import { isApiKeyOnlyRole } from "./permissions.utils";

type ApiKeyScope = Pick<
  ApiKeyInterface,
  | "role"
  | "userId"
  | "limitAccessByEnvironment"
  | "environments"
  | "additionalRoles"
  | "projectRoles"
>;

function roleName(role: string): string {
  return DEFAULT_ROLES[role as keyof typeof DEFAULT_ROLES]?.displayName ?? role;
}

// Why a key with an API-key-only role (e.g. trace ingest), or one changing to
// or from such a role, can't be saved; null otherwise. Such a key is pasted
// into many service configs and is the only kind the license server shares
// with the ingestor, so converting one would widen a widely-distributed key
// or start sharing a broad one. Rotate instead.
export function apiKeyOnlyRoleProblem(
  doc: ApiKeyScope,
  previousDoc?: ApiKeyScope,
): string | null {
  if (
    previousDoc &&
    isApiKeyOnlyRole(previousDoc.role || "") !==
      isApiKeyOnlyRole(doc.role || "")
  ) {
    return "This key's role can't be changed to or from that role. Create a new key instead.";
  }
  if (!doc.role || !isApiKeyOnlyRole(doc.role)) return null;
  if (doc.userId) {
    return `The ${roleName(doc.role)} role can only be used for organization API keys.`;
  }
  if (
    doc.limitAccessByEnvironment ||
    doc.environments?.length ||
    doc.additionalRoles?.length ||
    doc.projectRoles?.length
  ) {
    return `The ${roleName(doc.role)} role can't have environment limits, additional roles, or project roles.`;
  }
  return null;
}

// The role in a secret key's cosmetic `secret_<role>_` prefix.
export function apiKeyPrefixRole(role: string): string {
  return (
    isApiKeyOnlyRole(role) ? role.replace(/^gbDefault_/, "") : role
  ).slice(0, 20);
}

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
