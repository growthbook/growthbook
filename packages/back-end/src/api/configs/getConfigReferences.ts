import { getConfigReferencesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadConstantReferences } from "back-end/src/services/constants";

export const getConfigReferences = createApiRequestHandler(
  getConfigReferencesValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config with that key");
  }
  // References span both collections (constants + configs); the loader is keyed
  // by the shared internal id.
  const refs = await loadConstantReferences(req.context, config.id);
  if (!refs) {
    throw new NotFoundError("Could not find config with that key");
  }
  return { features: refs.features, constants: refs.constants };
});
