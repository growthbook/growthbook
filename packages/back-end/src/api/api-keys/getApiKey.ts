import { getApiKeyValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { assertCanViewApiKeys, toApiKeys } from "./toApiKey";

export const getApiKey = createApiRequestHandler(getApiKeyValidator)(async (
  req,
) => {
  assertCanViewApiKeys(req.context);
  const key = await req.context.models.apiKeys.getSecretApiKeyById(
    req.params.id,
  );
  if (!key) {
    throw new NotFoundError(
      "Could not find an API key or personal access token with that id",
    );
  }
  const [apiKey] = await toApiKeys(req.context, [key]);
  return { apiKey };
});
