import { listApiKeysValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { loadApiKeys } from "back-end/src/services/apiKeyResponse";

export const listApiKeys = createApiRequestHandler(listApiKeysValidator)(async (
  req,
) => {
  const { type, userId } = req.query;
  const keys = (await req.context.models.apiKeys.getApiKeysForApi())
    .filter(
      (key) =>
        (!type || (type === "personal") === !!key.userId) &&
        (!userId || key.userId === userId),
    )
    .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));

  const { filtered, returnFields } = applyPagination(keys, req.query);
  return {
    apiKeys: await loadApiKeys(req.context, filtered),
    ...returnFields,
  };
});
