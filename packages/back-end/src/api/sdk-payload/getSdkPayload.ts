import { filterProjectsByEnvironmentWithNull } from "shared/util";
import {
  FeatureDefinitionSDKPayload,
  getFeatureDefinitions,
} from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getPayloadParamsFromApiKey } from "back-end/src/controllers/features";

export const getSdkPayload = createApiRequestHandler()(async (
  req,
): Promise<FeatureDefinitionSDKPayload & { status: number }> => {
  const { key } = req.params;

  if (!key) {
    throw new Error("Missing API key in request");
  }

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
    hashSecureAttributes,
  } = await getPayloadParamsFromApiKey(key, req);

  const environmentDoc = req.context.org?.settings?.environments?.find(
    (e) => e.id === environment,
  );
  const filteredProjects = filterProjectsByEnvironmentWithNull(
    projects,
    environmentDoc,
    true,
  );

  const defs = await getFeatureDefinitions({
    context: req.context,
    capabilities,
    environment,
    projects: filteredProjects,
    encryptionKey: encrypted ? encryptionKey : "",
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    includeRuleIds,
    hashSecureAttributes,
  });

  return {
    status: 200,
    ...defs,
  };
});
