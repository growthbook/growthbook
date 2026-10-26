import { getAuditedApiKeyKinds } from "back-end/src/models/AuditModel";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

type Context = ReqContext | ApiReqContext;

// API key history can expose roles, scope and descriptions, so it needs the
// same permission as listing the key.
export async function canReadApiKeyHistory(
  context: Context,
  id: string | undefined,
): Promise<boolean> {
  const { permissions } = context;
  if (!id) return permissions.canViewApiKeys();
  const key = await context.models.apiKeys.dangerousGetById(id);
  if (key) {
    return key.userId
      ? key.userId === context.userId ||
          permissions.canManagePersonalAccessTokens()
      : permissions.canViewApiKeys();
  }
  // A deleted key is known only by its audits. One they can't place needs both.
  const kinds = await getAuditedApiKeyKinds(context.org.id);
  if (kinds.tokens.has(id)) return permissions.canManagePersonalAccessTokens();
  if (kinds.orgKeys.has(id)) return permissions.canViewApiKeys();
  return (
    permissions.canViewApiKeys() && permissions.canManagePersonalAccessTokens()
  );
}

// Members' tokens, and deleted keys their audits can't place as org keys.
export async function getApiKeyIdsHiddenFromKeyViewers(
  context: Context,
): Promise<string[]> {
  const [keys, kinds] = await Promise.all([
    context.models.apiKeys.dangerousGetAllApiKeysInOrg(),
    getAuditedApiKeyKinds(context.org.id),
  ]);
  const live = new Map(keys.map((k) => [k.id, k]));
  return kinds.all.filter((id) => {
    // Org-wide entries, like applying the expiration policy, name no key.
    if (!id) return false;
    const key = live.get(id);
    return key ? !!key.userId : !kinds.orgKeys.has(id);
  });
}
