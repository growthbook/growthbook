import { putApiKeyRolesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadApiKeys } from "back-end/src/services/apiKeyResponse";

export const putApiKeyRoles = createApiRequestHandler(putApiKeyRolesValidator)(
  async (req) => {
    const { dryRun, ...roles } = req.body;
    const { key, changed } =
      await req.context.models.apiKeys.replaceRolesForApi(
        req.params.id,
        roles,
        !!dryRun,
      );
    const [apiKey] = await loadApiKeys(req.context, [key]);
    return { apiKey, changed };
  },
);
