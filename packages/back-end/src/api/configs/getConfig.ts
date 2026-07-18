import { getConfigValidator } from "shared/validators";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getConfig = createApiRequestHandler(getConfigValidator)(async (
  req,
) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config with that key");
  }

  return {
    config: await resolveOwnerEmail(
      req.context.models.configs.toApiInterface(config),
      req.context,
    ),
  };
});
