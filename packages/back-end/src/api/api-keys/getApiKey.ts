import { getApiKeyValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadApiKeys } from "back-end/src/services/apiKeyResponse";

export const getApiKey = createApiRequestHandler(getApiKeyValidator)(async (
  req,
) => {
  const key = await req.context.models.apiKeys.getApiKeyForApi(req.params.id);
  const [apiKey] = await loadApiKeys(req.context, [key]);
  return { apiKey };
});
