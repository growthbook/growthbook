import { ApiKeyInterface } from "shared/types/apikey";

// Whether toggling `disabled` needs canDeleteApiKey rather than the generic key check.
// Mirrors ApiKeyModel.canUpdate, so the UI and server agree on who can re-enable a PAT.
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
