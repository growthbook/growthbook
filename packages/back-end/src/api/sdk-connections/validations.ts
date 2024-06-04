import { getLatestSDKVersion, getSDKCapabilities } from "shared/sdk-versioning";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { ApiReqContext } from "../../../types/api";
import { sdkLanguages } from "../../util/constants";
import { getEnvironments } from "../../services/organizations";
import { IS_CLOUD } from "../../util/secrets";

const capabilityParams = [
  ["encryption", "encryptPayload"],
  ["remoteEval", "remoteEvalEnabled"],
  ["visualEditor", "includeVisualExperiments"],
  ["redirects", "includeRedirectExperiments"],
] as const;

type CababilitiesParamKey = typeof capabilityParams[number][1];
type CababilitiesParams = { [k in CababilitiesParamKey]?: boolean };

const premiumFeatures = [
  ["encrypt-features-endpoint", "encryptPayload"],
  ["visual-editor", "includeVisualExperiments"],
  ["hash-secure-attributes", "hashSecureAttributes"],
  ["remote-evaluation", "remoteEvalEnabled"],
  ["redirects", "includeRedirectExperiments"],
  ["cloud-proxy", "proxyEnabled"],
] as const;

type PremiumFeatureName = typeof premiumFeatures[number][0];
type PremiumFeatureParam = typeof premiumFeatures[number][1];
type PremiumFeatures = { [k in PremiumFeatureParam]?: boolean };

const premiumOverrides: {
  [k in PremiumFeatureName]?: boolean;
} = {
  "cloud-proxy": !IS_CLOUD,
} as const;

export const validatePayload = async (
  context: ApiReqContext,
  {
    name,
    environment,
    sdkVersion: reqSdkVersion,
    language: reqLanguage,
    projects = [],
    encryptPayload = false,
    includeVisualExperiments = false,
    includeDraftExperiments = false,
    includeExperimentNames = false,
    includeRedirectExperiments = false,
    proxyEnabled,
    proxyHost,
    hashSecureAttributes = false,
    ...otherParams
  }: {
    name: string;
    environment: string;
    sdkVersion?: string;
    language?: string;
    projects?: string[];
    encryptPayload?: boolean;
    includeVisualExperiments?: boolean;
    includeDraftExperiments?: boolean;
    includeExperimentNames?: boolean;
    includeRedirectExperiments?: boolean;
    proxyHost?: string;
    hashSecureAttributes?: boolean;
  } & CababilitiesParams &
    PremiumFeatures
) => {
  if (name && name.length < 3) {
    throw Error("Name length must be at least 3 characters");
  }

  if (
    !getEnvironments(context.org)
      .map(({ id }) => id)
      .includes(environment)
  )
    throw new Error(`Environment ${environment} does not exist!`);

  if (projects && projects.length) {
    const allProjects = await findAllProjectsByOrganization(context);
    const nonexistentProjects = projects.filter(
      (p) => !allProjects.some(({ id }) => p === id)
    );
    if (nonexistentProjects.length)
      throw new Error(
        `The following projects do not exist: ${nonexistentProjects.join(", ")}`
      );
  }

  if (!reqLanguage) throw new Error("SDK connection requires a language!");

  const language = sdkLanguages.find((l) => l === reqLanguage);
  if (!language) throw new Error(`Language ${reqLanguage} is not supported!`);
  const latestSdkVersion = getLatestSDKVersion(language);
  const sdkVersion = reqSdkVersion || latestSdkVersion;

  const latestCapabilities = getSDKCapabilities(language, latestSdkVersion);
  const capabilities = getSDKCapabilities(language, sdkVersion);

  const payload = {
    name,
    environment,
    sdkVersion,
    languages: [language],
    projects,
    encryptPayload,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    proxyEnabled,
    proxyHost,
    hashSecureAttributes,
    ...otherParams,
  };

  capabilityParams.forEach(([capability, param]) => {
    if (payload[param] && !capabilities.includes(capability))
      if (latestCapabilities.includes(capability))
        throw new Error(
          `You need to ugrade to version ${latestSdkVersion} to support ${capability}`
        );
      else
        throw new Error(
          `SDK version ${sdkVersion} doesn not support ${capability}`
        );
  });

  premiumFeatures.forEach(([feature, param]) => {
    if (!payload[param]) return;

    if (premiumOverrides[feature]) return;

    if (!context.hasPremiumFeature(feature))
      throw new Error(`Feature ${feature} requires premium subscription!`);
  });

  return payload;
};
