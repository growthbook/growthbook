import { filterProjectsByEnvironmentWithNull } from "shared/util";
import {
  FeatureDefinitionSDKPayload,
  getFeatureDefinitions,
} from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getPayloadParamsFromApiKey } from "back-end/src/controllers/features";
import { getSDKPayloadCacheLocation } from "back-end/src/models/SdkConnectionCacheModel";
import { logger } from "back-end/src/util/logger";

export const getSdkPayload = createApiRequestHandler()(async (
  req,
): Promise<FeatureDefinitionSDKPayload & { status: number }> => {
  const { key } = req.params;

  if (!key) {
    throw new Error("Missing API key in request");
  }

  // Try to get cached payload from sdkConnectionCache
  const storageLocation = getSDKPayloadCacheLocation();
  if (storageLocation !== "none") {
    const cached = await req.context.models.sdkConnectionCache.getById(key);
    if (cached) {
      try {
        const defs: FeatureDefinitionSDKPayload = JSON.parse(cached.contents);
        return {
          status: 200,
          ...defs,
        };
      } catch (e) {
        // Corrupt cache data, treat as cache miss and fall through to JIT generation
        logger.warn(e, "Failed to parse cached SDK payload, regenerating");
      }
    }
  }

  // Fallback to JIT generation if cache miss or cache disabled
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
