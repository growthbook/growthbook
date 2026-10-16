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
