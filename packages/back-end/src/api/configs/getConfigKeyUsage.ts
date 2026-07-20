import { getConfigKeyUsageValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { getConfigKeyImplementations } from "back-end/src/services/constants";

export const getConfigKeyUsage = createApiRequestHandler(
  getConfigKeyUsageValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config with that key");
  }
  const result = await getConfigKeyImplementations(req.context, config.id);
  if (!result) {
    throw new NotFoundError("Could not find config with that key");
  }
  return result;
});
