import {
  FeatureDefinitionSDKPayload,
  getFeatureDefinitions,
} from "../features";

const organization = "org_24yyifrkf649iz6"; // GrowthBook Cloud org
const environment =
  process.env.NODE_ENV === "production" ? "production" : "dev";

// In-memory payload cache
const staleTTL = 60000; // 1 minute
let cachedPayload: FeatureDefinitionSDKPayload | null = null;
let staleDate = new Date(Date.now() + staleTTL);

export async function getGbCloudSdkPayload(): Promise<FeatureDefinitionSDKPayload> {
  if (!cachedPayload || staleDate < new Date()) {
    const defs = await getFeatureDefinitions({
      organization,
      environment,
      includeVisualExperiments: true,
      includeDraftExperiments: environment === "dev",
      includeExperimentNames: environment === "dev",
      hashSecureAttributes: true,
    });
    cachedPayload = defs;
    staleDate = new Date(Date.now() + staleTTL);
    return defs;
  }

  return cachedPayload;
}
