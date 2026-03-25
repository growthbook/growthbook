import { FeatureDefinitionSDKPayload } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getPayloadParamsFromApiKey,
  getFeatureDefinitionsWithCache,
} from "back-end/src/controllers/features";

export const getSdkPayload = createApiRequestHandler()(async (
  req,
): Promise<FeatureDefinitionSDKPayload & { status: number }> => {
  const { key } = req.params;

  if (!key) {
    throw new Error("Missing API key in request");
  }

<<<<<<< HEAD
  const {
    capabilities,
    environment,
    encrypted,
    projects,
    encryptionKey,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    includeRuleIds,
    includeProjectPublicId,
    includeCustomFields,
    includeTags,
    hashSecureAttributes,
    savedGroupReferencesEnabled,
  } = await getPayloadParamsFromApiKey(key, req);
=======
  const params = await getPayloadParamsFromApiKey(key, req);
>>>>>>> origin/main

  const defs = await getFeatureDefinitionsWithCache({
    context: req.context,
<<<<<<< HEAD
    capabilities,
    environment,
    projects: filteredProjects,
    encryptionKey: encrypted ? encryptionKey : "",
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    includeRuleIds,
    includeProjectPublicId,
    includeCustomFields,
    includeTags,
    hashSecureAttributes,
    savedGroupReferencesEnabled,
=======
    params,
>>>>>>> origin/main
  });

  return {
    status: 200,
    ...defs,
  };
});
