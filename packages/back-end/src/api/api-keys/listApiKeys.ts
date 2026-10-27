import { listApiKeysValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { toApiKeys } from "./toApiKey";

export const listApiKeys = createApiRequestHandler(listApiKeysValidator)(async (
  req,
) => {
  const { type, userId } = req.query;
  const keys = (await req.context.models.apiKeys.getSecretApiKeys())
    .filter(
      (key) =>
        (!type || (type === "personal") === !!key.userId) &&
        (!userId || key.userId === userId),
    )
    .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));

  const { filtered, returnFields } = applyPagination(keys, req.query);
  return {
    apiKeys: await toApiKeys(req.context, filtered),
    ...returnFields,
  };
});
